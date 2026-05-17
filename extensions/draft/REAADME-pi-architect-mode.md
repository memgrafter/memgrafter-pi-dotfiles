# pi-architect-mode-extension

Software architect mode for **pi**.

## Features

- `/architect` toggle
- `/architect on|off|status`
- `/architect <text>` enables architect mode and immediately sends `<text>`
- Optional startup flag:
  - `--architect`

## Local usage

From this folder:

```bash
cd /Users/user/code/pi-architect-mode-extension
pi -e ./extensions/pi-architect-mode.ts
```

Or by absolute extension path:

```bash
pi -e /Users/user/code/pi-architect-mode-extension/extensions/pi-architect-mode.ts
```

Then in pi:

```text
/architect
```

## Install as a package

```bash
pi install git:github.com/memgrafter/pi-architect-mode-extension
# pinned
pi install git:github.com/memgrafter/pi-architect-mode-extension@v0.1.0
```

Project-local install:

```bash
pi install -l git:github.com/memgrafter/pi-architect-mode-extension
```
