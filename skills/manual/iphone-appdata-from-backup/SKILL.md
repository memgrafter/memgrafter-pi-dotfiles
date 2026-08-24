---
name: iphone-appdata-from-backup
description: Extract a single iOS app's private data (browser tabs, bookmarks, history, localStorage, IndexedDB, etc.) from an iPhone over USB using a host-side-filtered pymobiledevice3 backup2 — no computer access to the phone, no iMazing, no full 100GB+ backup. Use when the user wants data OUT of an installed iOS app (e.g. "get my Brave tabs", "export Safari/Chrome history from my iPhone", "pull an app's local storage") and the app has no sync/export feature. Covers the two required source patches for low-disk Macs, the data-container-UUID regex gotcha, and parsing the Core Data / WebKit SQLite databases.
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins:
        - python3
        - sqlite3
    notes: >
      Requires a paired/trusted iPhone over USB, pymobiledevice3 (installed to an
      isolated target dir), and enough host disk for the ONE app's data (not the
      whole backup). Two source patches to pymobiledevice3 are mandatory on a
      low-disk Mac.
---

# iPhone App Data from a Filtered Backup

Pull a single app's private on-disk data off an iPhone over USB by running a
**host-side-filtered** `pymobiledevice3 backup2` and then parsing the app's
SQLite / Core Data / WebKit databases out of the result.

This is the route to use when:

- The app has **no sync** and **no export** (e.g. Brave iOS has neither).
- You want the app's **private container** (`Library/`, `Documents/`, WebKit
  storage) — which is **not** reachable via house-arrest `VendDocuments`
  (that only exposes `Documents/`) and **not** via `VendContainer` (full
  house-arrest is **globally blocked on iOS 17+/26** — `InstallationLookupFailed`).
- A **full** backup won't fit on the host (a full iPhone backup is often 100–200 GB;
  the host may have only a few GB free). The `--only-regex` filter means the host
  only **writes** the one app's data (~1–3 GB); everything else is streamed and
  drained.

The full worked session that produced this skill (Brave tabs + bookmarks off an
iPhone 17 Pro / iOS 26.6) is the latest file in:

```
~/.pi/agent/sessions/--Users-trentrobbins-code-loreblendr-gcp-llm-meter-proxy--/
```

(pick the newest by mtime). Read it if you need the exact reasoning, the failed
attempts, or the precise tool trace.

---

## Why a backup is the only route (and why the obvious ones fail)

Established empirically — do not re-derive, but verify on your device if behavior
differs:

| Method | Result | Why |
|--------|--------|-----|
| House-arrest `VendDocuments` (`apps afc --documents-only`) | ✅ works, but **only `Documents/`** | Brave's `Documents/` had just `.Trash` + `Downloads` — no tab data. Tabs live in `Library/`. |
| House-arrest `VendContainer` (full) | ❌ `InstallationLookupFailed` | Full house-arrest is **globally blocked on iOS 17+/26**. Tested on Calculator AND Brave — both fail. Not app-specific. |
| iCloud backup download | ❌ not via pymobiledevice3 | Would need iMazing/3uTools. (User's iCloud backup was 5.2 GB and did contain the data, but no free tool pulls it.) |
| **Filtered `backup2`** | ✅ **works** | The device sends the whole backup; the host keeps only the matching app's files. This is the route. |

The app's browser/session data is in its **private data container**:
`/var/mobile/Containers/Data/Application/<UUID>/Data/...`. A backup is the only
way to read that path without jailbreak.

---

## Step 0 — Recon (do this first, ~2 min)

You need three facts before you can run the backup:

1. **The app's bundle id** (e.g. `com.brave.ios.browser`).
2. **The app's data-container UUID** (e.g. `8D32801E-E116-4E88-8F64-53A7FA5599FF`) —
   **this is what the regex must match** (see the Gotcha below).
3. **The device UDID/serial** (e.g. `00008140-001109080CDB001C`).

Confirm the phone is connected, paired, and trusted over USB:

```bash
# pymobiledevice3 must be importable (see Step 1 for the isolated install)
env PYTHONPATH=/tmp/pmd3-pkgs <PY> -m pymobiledevice3 usbmux list 2>&1 | head
```

Get the bundle id + data-container UUID in one shot via the installation proxy.
pymobiledevice3 10.x is **async** — run it as a one-shot script (or in a persistent
REPL kernel with a single event loop; `asyncio.run()` per-call breaks sockets):

```python
import asyncio
from pymobiledevice3.remote.userspace_tunnel import establish_userspace_rsd
from pymobiledevice3.services.installation_proxy import InstallationProxyService

SERIAL = "00008140-001109080CDB001C"   # from `usbmux list`
BID    = "com.brave.ios.browser"       # the app you want

async def main():
    rsd = await establish_userspace_rsd(serial=SERIAL, autopair=True)
    ip  = InstallationProxyService(lockdown=rsd)
    apps = await ip.get_apps(bundle_identifiers=[BID], calculate_sizes=True)
    a = apps[0]
    print("bundle id      :", a.get("CFBundleIdentifier"))
    print("version        :", a.get("CFBundleShortVersionString"))
    print("data container :", a.get("Container"))          # /private/var/mobile/Containers/Data/Application/<UUID>
    print("group container:", a.get("GroupContainer"))
    print("size (bytes)   :", a.get("StaticDiskUsage"), "+", a.get("DynamicDiskUsage"))

asyncio.run(main())
```

Extract the UUID from the `Container` path:

```bash
# e.g. /private/var/mobile/Containers/Data/Application/8D32801E-E116-4E88-8F64-53A7FA5599FF
UUID=$(<container path> | sed -E 's#.*/Application/##')
```

> **Note:** the data-container UUID is **per-install**. If the app is reinstalled,
> the UUID changes. Re-run this recon after any reinstall.

---

## Step 1 — Install pymobiledevice3 to an isolated dir

Install to a target dir (not a venv) so you can `PYTHONPATH` it and patch the
source in place. Use a known-good Python (3.12 in the reference session):

```bash
PY=/Users/trentrobbins/.pyenv/versions/3.12.9/bin/python3   # any 3.10+ works
$PY -m pip install --quiet --target /tmp/pmd3-pkgs pymobiledevice3
env PYTHONPATH=/tmp/pmd3-pkgs $PY -m pymobiledevice3 version
```

From now on, every CLI call is:

```bash
env PYTHONPATH=/tmp/pmd3-pkgs $PY -m pymobiledevice3 <cmd>
```

---

## Step 2 — Apply the TWO mandatory source patches (low-disk Mac)

**Why:** the device checks the *host's* free disk against the size of the **full**
backup (~125 GB in the reference case) before it starts streaming. A Mac with only
~6 GB free fails that check and the backup aborts — even though the host will only
*write* the filtered ~1.3 GB (the rest is drained, never stored). Two functions in
`pymobiledevice3/services/device_link.py` enforce this. Patch both.

> ⚠️ **If you reinstall pymobiledevice3, you MUST re-apply both patches.** They are
> not in any release.

File: `/tmp/pmd3-pkgs/pymobiledevice3/services/device_link.py`

### Patch 1 — `get_free_disk_space` (report a large value)

**Before** (original):
```python
    async def get_free_disk_space(self, _message: DLMessage) -> None:
        freespace = shutil.disk_usage(self.root_path).free
        if sys.platform == "darwin":
            # statvfs excludes APFS purgeable space; report the capacity macOS will
            # actually satisfy (matches Finder), so the device doesn't refuse a
            # backup that fits. See https://github.com/doronz88/pymobiledevice3/...
            important = _darwin_important_available_capacity(self.root_path)
            if important is not None:
                freespace = max(freespace, important)
        await self.status_response(0, status_dict=freespace)
```

**After** (patched):
```python
    async def get_free_disk_space(self, _message: DLMessage) -> None:
        # Report a large free-space value so the device proceeds with the full backup.
        # The host only WRITES the filtered payloads (the rest are drained, not stored),
        # so real disk usage is far below this. Workaround for host-side --only-regex.
        freespace = 256 * 1024 ** 3
        await self.status_response(0, status_dict=freespace)
```

### Patch 2 — `purge_disk_space` (acknowledge instead of raising)

**Before** (original — a stub that always fails):
```python
    async def purge_disk_space(self, _message: DLMessage) -> None:
        raise NotEnoughDiskSpaceError()
```

**After** (patched):
```python
    async def purge_disk_space(self, _message: DLMessage) -> None:
        # Host has enough free space for the filtered (host-side) backup; acknowledge
        # the device's purge request instead of failing. (pymobiledevice3 stub fix.)
        await self.status_response(0)
```

After editing, clear the stale bytecode cache so the patch takes effect:

```bash
find /tmp/pmd3-pkgs/pymobiledevice3/services/__pycache__ -name "device_link*" -delete
```

**Safety note:** faking 256 GB free is only safe because `--only-regex` means the
host writes a tiny fraction. If you ever run an *unfiltered* backup with these
patches, you WILL fill the disk — the device will happily stream 125 GB.

---

## Step 3 — Run the filtered backup

**THE GOTCHA (the #1 reason this fails):** `--only-regex` matches the **device
path** (a UUID path like `/var/mobile/Containers/Data/Application/<UUID>/Data/...`),
**NOT** the bundle id. `should_preserve_backup_file()` builds
`BackupFile(file_name=..., device_name=...)` with `domain`/`relative_path = None`,
so a bundle-id regex like `com.brave.ios.browser` matches **nothing** and every
file is silently drained — the backup dir stays ~19 MB and you get an empty result.
**Match the data-container UUID instead.**

```bash
UUID=8D32801E-E116-4E88-8F64-53A7FA5599FF     # from Step 0
UDID=00008140-001109080CDB001C                # from Step 0
DEST=$HOME/iphone-backup-brave
mkdir -p "$DEST"
rm -rf "$DEST/$UDID"                          # clean any prior partial backup

cd "$DEST"
nohup env PYTHONPATH=/tmp/pmd3-pkgs $PY -m pymobiledevice3 backup2 backup "$DEST" \
  --only-regex "$UUID" \
  --patch-manifest \
  --udid "$UDID" \
  > "$DEST/backup.log" 2>&1 &
echo "backup pid $!"
```

Flag notes:
- `--only-regex "$UUID"` — keep only files whose device path contains the UUID.
- `--patch-manifest` — rewrite `Manifest.db`/`Manifest.plist` at the end to contain
  **only** the kept files, so `backup2 extract` reconstructs just this app.
- `--udid` — target the specific device (required if more than one is attached).
- Run under `nohup ... &` so it survives the shell; it takes **30–60 min** because
  the device still *transfers* the whole backup (the host just drains most of it).

> **Keep the phone plugged in and awake-ish.** Screen *lock* is fine (the userspace
> tunnel survives lock). Full sleep or USB disconnect kills it.

### Monitor (bounded polling — no unbounded loops)

The progress bar is a single very long line of tqdm output, so `tail` a byte range
and grep the last `N/100` token:

```bash
B=$DEST/$UDID
prog() { tail -c 4000 "$DEST/backup.log" | grep -aoE '[0-9]+\.[0-9]+/100' | tail -1 | cut -d/ -f1; }

for i in $(seq 1 20); do
  p=$(prog); dir=$(du -sm "$B" 2>/dev/null | cut -f1)
  run=$(pgrep -f "backup2 backup" >/dev/null && echo Y || echo N)
  echo "[$i] $(date +%H:%M:%S)  ${p}%  dir=${dir}MB  run=$run"
  [ "$run" = "N" ] && { echo "=== DONE (dir=${dir}MB) ==="; break; }
  sleep 30
done
```

- Progress % is of the **full** backup transfer, not the kept data.
- **Success signal:** `dir` grows to the app's real size (Brave ≈ 650 MB–1.3 GB)
  and the process exits (`run=N`).
- **Filter-failed signal:** `dir` stays ~19 MB at 100% → you used the bundle id,
  not the UUID. Kill it and re-run with the UUID.

You can **stop early** once the app's data is written (the big SQLite files appear
well before 100%) — `pkill -f "backup2 backup"`. The data already on disk is usable
even if `Manifest.db` was never finalized (see Step 4: you can find files by magic
bytes without the manifest).

---

## Step 4 — Locate the app's files in the backup

The backup stores file *contents* by **SHA-1 hash** under `Snapshot/<2 hex>/<40 hex>`
(no extensions, no paths). The file→path map lives in `Manifest.db` (SQLite) /
`Manifest.plist`, **written at the very end**. If you stopped the backup early,
`Manifest.db` may be absent/incomplete — that's fine, use the magic-byte scan below.

```bash
B=$DEST/$UDID
ls -la "$B"/*.plist "$B"/*.db 2>/dev/null
echo "non-empty files: $(find "$B/Snapshot" -type f -size +0c | wc -l)"
```

### If `Manifest.db` exists (backup finished) — query it for the app's paths

```bash
sqlite3 "$B/Manifest.db" \
  "SELECT file FROM Files WHERE file LIKE '%$UUID%';" | head
```

### If you stopped early (no manifest) — find the databases by magic bytes

The app's real data is almost always a handful of **SQLite** databases. Find them:

```bash
B=$DEST/$UDID
find "$B/Snapshot" -type f -size +0c 2>/dev/null | while read f; do
  if head -c 16 "$f" 2>/dev/null | xxd -p | grep -q "^53514c697465"; then
    echo "$(du -k "$f" | cut -f1) KB  $f"
  fi
done | sort -rn | head -30
```

The **largest** SQLite file is almost always the app's main Core Data store
(Brave's was 312 MB). Copy it to `/tmp` and open read-only:

```bash
cp "$B/Snapshot/34/34873e4db5bce44db48598faee32a235b58c4dc5" /tmp/app.db
sqlite3 "file:/tmp/app.db?mode=ro&immutable=1" ".tables"
```

> `?mode=ro&immutable=1` is needed because the snapshot path can be read-only /
> the file may lack a writable sibling for the journal. Copying to `/tmp` sidesteps
> both.

Other file types you'll see (decode by first 16 bytes):
- `53514c69746520666f726d6174203300` → SQLite 3
- `1000000006000000017265636f726424` → Core Data `.sqlite` (Z_ tables)
- `1801220b08ffffffffffffffffff012a` → Core Data binary store
- `62706c6973743030d301020304050656` → binary plist
- `89504e470d0a1a0a` → PNG, `ffd8ffe0` → JPEG, `3c737667` → SVG
- `2166756e6374696f6e28297b7472797b` / `2275736520737472696374` → JavaScript
- `7b2246696c654d657472696373` → JSON (FileMetrics)

---

## Step 5 — Parse the databases (Brave iOS reference schema)

Brave iOS is WebKit-based. Its main Core Data store (the big SQLite) has these
tables (prefix `Z`, Core Data convention):

| Table | What it holds |
|-------|---------------|
| `ZSESSIONTAB` | **All browser tabs** — `ZTITLE`, `ZURL`, `ZISPRIVATE`, `ZINDEX`, `ZLASTUPDATED`, `ZSESSIONWINDOW` |
| `ZSESSIONWINDOW` | Open windows (1 row = current window) |
| `ZSESSIONTABGROUP` | Tab groups |
| `ZBOOKMARK` | Bookmarks — `ZTITLE`, `ZURL`, `ZISFAVORITE`, `ZVISITS`, `ZORDER` |
| `ZRECENTLYCLOSED` | Recently closed tabs — `ZTITLE`, `ZURL` |
| `ZRECENTSEARCH` | Search history — `ZTEXT`, `ZWEBSITEURL`, `ZDATEADDED` |
| `ZDOMAIN` | Per-site Shield/adblock settings + `ZVISITS` |
| `ZBLOCKEDRESOURCE` | Ad/tracker block log (not user data) |
| `ZWALLETUSERASSET` / `...BALANCE` / `...GROUP` | Brave Wallet crypto assets |
| `ZRSSFEEDSOURCE`, `ZPLAYLISTITEM`, `ZDATASAVED` | RSS / playlists / data-saved (often empty) |

The **other** SQLite files in the container are WebKit per-site storage:
- `ItemTable` (key/value) = **localStorage** (often just A/B-test telemetry)
- `IDBDatabaseInfo` / `ObjectStoreInfo` / `Records` / `BlobRecords` = **IndexedDB**

### Extract tabs (URL + title), most-recently-updated first

```bash
DB="file:/tmp/app.db?mode=ro&immutable=1"
sqlite3 -separator $'\t' "$DB" \
  "SELECT ZTITLE, ZURL, ZLASTUPDATED FROM ZSESSIONTAB ORDER BY ZLASTUPDATED DESC;" \
  > /tmp/tabs.tsv
```

> **Timestamp caveat:** `ZLASTUPDATED`/`ZDATEADDED` are **Core Data reference dates**
> (seconds since 2001-01-01), so `datetime(x,'unixepoch')` shows nonsense years
> (e.g. 1995). **Only the relative ordering is meaningful** — "most recently
> updated" = the currently-open tabs. Don't try to convert them to wall-clock.

Render to markdown:

```python
rows = [l.rstrip('\n').split('\t') for l in open('/tmp/tabs.tsv') if l.strip()]
with open('~/brave-tabs/brave-tabs.md','w') as out:
    out.write(f"# Tabs\n\nTotal: {len(rows)} (most recent first)\n\n")
    for i,(t,u,*_) in enumerate(rows,1):
        out.write(f"{i}. **{t}**\n   {u}\n")
```

### Extract bookmarks

```bash
sqlite3 -header "$DB" \
  "SELECT ZTITLE, ZURL, ZISFAVORITE, ZVISITS FROM ZBOOKMARK ORDER BY ZORDER;"
```

### Extract search history / recently-closed

```bash
sqlite3 -header "$DB" "SELECT ZTEXT, ZWEBSITEURL FROM ZRECENTSEARCH;"
sqlite3 -header "$DB" "SELECT ZTITLE, ZURL FROM ZRECENTLYCLOSED;"
```

### (Optional) Reconstruct the full on-disk tree

If the backup finished and you used `--patch-manifest`, you can unpack the whole
app container with paths restored:

```bash
env PYTHONPATH=/tmp/pmd3-pkgs $PY -m pymobiledevice3 backup2 extract "$DEST"
```

This uses `pyiosbackup` and writes the app's files back out under their real
`.../Containers/Data/Application/<UUID>/Data/...` paths. Only needed if you want
the raw `Library/` tree (caches, WebKit dirs) rather than the parsed DB values.

---

## Cleanup

```bash
pkill -f "backup2 backup" 2>/dev/null          # if still running
rm -rf ~/iphone-backup-brave                    # the 650MB+ backup (keep ~/brave-tabs!)
rm -f /tmp/app.db /tmp/tabs.tsv /tmp/probe.db   # working copies
```

Keep the extracted outputs (`~/brave-tabs/` or wherever you wrote them). The backup
dir is disposable once you've parsed what you need.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Backup dir stays ~19 MB, reaches 100%, empty result | `--only-regex` used the **bundle id** | Re-run with the **data-container UUID** (Step 0). |
| Backup aborts early with `NotEnoughDiskSpaceError` | Patches not applied / stale `.pyc` | Re-apply both patches (Step 2), delete `__pycache__/device_link*`, re-run. |
| `InstallationLookupFailed` on house-arrest | iOS 17+/26 blocks `VendContainer` | Don't use house-arrest for `Library/`; use the backup. |
| `usbmux` / tunnel errors, sockets break between calls | Calling `asyncio.run()` per call | Use one persistent event loop (REPL kernel) or a single script. |
| `sqlite3: unable to open database file` on the snapshot path | Read-only / no journal sibling | `cp` to `/tmp` and open with `?mode=ro&immutable=1`. |
| Tab dates show 1995/2001 | Core Data reference dates | Ignore absolute values; use ordering only. |
| Backup dies mid-run | Phone slept or USB dropped | Keep phone plugged in; screen lock is OK. Re-run from scratch (rm the UDID dir first). |
| Reinstalled pymobiledevice3 and backup fails again | Patches lost | Re-apply Step 2. |

## Key facts (Brave iOS, for reference)

- Bundle id: `com.brave.ios.browser` (v1.93 in the reference session)
- Data container: `/private/var/mobile/Containers/Data/Application/<UUID>`
- App group: `F2219A1F-3E77-4EB4-B3C0-BBF9A24861B7`
- **No sync** — the local container is the only copy.
- `Documents/` = `.Trash` + `Downloads` only (no tabs). Tabs are in the Core Data
  store under `Library/`.
- Main store ≈ 312 MB SQLite; `ZSESSIONTAB` had 3118 rows (all non-private).
