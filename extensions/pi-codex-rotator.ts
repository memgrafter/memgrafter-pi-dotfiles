import type { ExtensionAPI, ExtensionContext, MessageEndEvent } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROVIDER_ID = "openai-codex";
const AUDIT_CUSTOM_TYPE = "pi-codex-rotator-audit";

const SHARED_AGENT_DIR = join(homedir(), ".pi", "agent");
const ROTATOR_DIR = join(SHARED_AGENT_DIR, "pi-codex-rotator");
const SETTINGS_PATH = join(ROTATOR_DIR, "settings.json");
const ACCOUNTS_PATH = join(ROTATOR_DIR, "codex.accounts.json");
const LOCK_PATH = join(ROTATOR_DIR, "codex.accounts.lock");

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const ACCOUNT_META_KEYS = new Set([
	"exhaustedInPiAt",
	"exhausted5hUntil",
	"exhaustedWeeklyUntil",
	"minutesUntil5hRefresh",
	"minutesUntilWeeklyRefresh",
	"lastRotatedInAt",
	"lastExhaustedMessage",
	"name",
]);

interface RotatorSettings {
	autoRotate: boolean;
}

interface ApiKeyCredential {
	type: "api_key";
	key: string;
}

interface OAuthCredential {
	type: "oauth";
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	[key: string]: unknown;
}

type ProviderCredential = ApiKeyCredential | OAuthCredential;

type CodexAccount = ProviderCredential & {
	name?: string;
	exhaustedInPiAt?: string;
	exhausted5hUntil?: string;
	exhaustedWeeklyUntil?: string;
	minutesUntil5hRefresh?: number;
	minutesUntilWeeklyRefresh?: number;
	lastRotatedInAt?: string;
	lastExhaustedMessage?: string;
};

interface QuotaDetection {
	isQuota: boolean;
	has5hWindow: boolean;
	hasWeeklyWindow: boolean;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureRotatorFiles(): void {
	if (!existsSync(ROTATOR_DIR)) {
		mkdirSync(ROTATOR_DIR, { recursive: true, mode: 0o700 });
	}
	if (!existsSync(SETTINGS_PATH)) {
		writeFileSync(SETTINGS_PATH, JSON.stringify({ autoRotate: false }, null, 2), {
			encoding: "utf-8",
			mode: 0o600,
		});
	}
	if (!existsSync(ACCOUNTS_PATH)) {
		writeFileSync(ACCOUNTS_PATH, JSON.stringify([], null, 2), { encoding: "utf-8", mode: 0o600 });
	}
}

async function withAccountsLock<T>(fn: () => Promise<T> | T): Promise<T> {
	ensureRotatorFiles();
	let acquired = false;

	for (let attempt = 0; attempt < 120; attempt++) {
		try {
			writeFileSync(LOCK_PATH, `${process.pid}`, { encoding: "utf-8", flag: "wx", mode: 0o600 });
			acquired = true;
			break;
		} catch (error: any) {
			if (error?.code !== "EEXIST") throw error;
			await sleep(25);
		}
	}

	if (!acquired) {
		throw new Error(`Could not acquire lock: ${LOCK_PATH}`);
	}

	try {
		return await fn();
	} finally {
		try {
			unlinkSync(LOCK_PATH);
		} catch {
			// Best effort unlock.
		}
	}
}

function readSettings(): RotatorSettings {
	try {
		const raw = readFileSync(SETTINGS_PATH, "utf-8");
		const parsed = JSON.parse(raw) as Partial<RotatorSettings>;
		return {
			autoRotate: typeof parsed.autoRotate === "boolean" ? parsed.autoRotate : false,
		};
	} catch {
		return { autoRotate: false };
	}
}

function isApiKeyCredential(value: unknown): value is ApiKeyCredential {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return candidate.type === "api_key" && typeof candidate.key === "string";
}

function isOAuthCredential(value: unknown): value is OAuthCredential {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		candidate.type === "oauth" &&
		typeof candidate.access === "string" &&
		typeof candidate.refresh === "string" &&
		typeof candidate.expires === "number"
	);
}

function isProviderCredential(value: unknown): value is ProviderCredential {
	return isApiKeyCredential(value) || isOAuthCredential(value);
}

function normalizeAccount(item: unknown): CodexAccount | undefined {
	if (!item || typeof item !== "object") return undefined;
	const candidate = item as Record<string, unknown>;

	let base: ProviderCredential | undefined;
	if (isApiKeyCredential(candidate)) {
		base = { type: "api_key", key: candidate.key };
	} else if (isOAuthCredential(candidate)) {
		base = { ...candidate } as OAuthCredential;
	} else {
		return undefined;
	}

	return {
		...base,
		name: typeof candidate.name === "string" ? candidate.name : undefined,
		exhaustedInPiAt: typeof candidate.exhaustedInPiAt === "string" ? candidate.exhaustedInPiAt : undefined,
		exhausted5hUntil: typeof candidate.exhausted5hUntil === "string" ? candidate.exhausted5hUntil : undefined,
		exhaustedWeeklyUntil:
			typeof candidate.exhaustedWeeklyUntil === "string" ? candidate.exhaustedWeeklyUntil : undefined,
		minutesUntil5hRefresh:
			typeof candidate.minutesUntil5hRefresh === "number" ? candidate.minutesUntil5hRefresh : undefined,
		minutesUntilWeeklyRefresh:
			typeof candidate.minutesUntilWeeklyRefresh === "number" ? candidate.minutesUntilWeeklyRefresh : undefined,
		lastRotatedInAt: typeof candidate.lastRotatedInAt === "string" ? candidate.lastRotatedInAt : undefined,
		lastExhaustedMessage:
			typeof candidate.lastExhaustedMessage === "string" ? candidate.lastExhaustedMessage : undefined,
	};
}

function readAccounts(): CodexAccount[] {
	try {
		const raw = readFileSync(ACCOUNTS_PATH, "utf-8");
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: CodexAccount[] = [];
		for (const item of parsed) {
			const normalized = normalizeAccount(item);
			if (normalized) out.push(normalized);
		}
		return out;
	} catch {
		return [];
	}
}

function writeAccounts(accounts: CodexAccount[]): void {
	writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2), { encoding: "utf-8", mode: 0o600 });
}

function credentialIdentity(credential: ProviderCredential): string {
	if (credential.type === "api_key") return `api_key:${credential.key}`;
	if (credential.accountId && credential.accountId.length > 0) {
		return `oauth:${credential.accountId}:${credential.refresh}`;
	}
	return `oauth:${credential.refresh}`;
}

function redact(value: string): string {
	if (value.length <= 8) return value;
	return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function credentialLabel(account: CodexAccount): string {
	if (account.type === "api_key") {
		return `api_key ${redact(account.key)}`;
	}
	if (typeof account.accountId === "string" && account.accountId.length > 0) {
		return `oauth ${redact(account.accountId)}`;
	}
	return `oauth ${redact(account.refresh)}`;
}

function accountDisplayName(account: CodexAccount, index: number): string {
	if (typeof account.name === "string" && account.name.trim().length > 0) {
		return account.name.trim();
	}
	return `acct-${index}`;
}

function oauthEmailFromAccess(access: string): string | undefined {
	const parts = access.split(".");
	if (parts.length < 2) return undefined;
	try {
		const payloadRaw = Buffer.from(parts[1], "base64url").toString("utf-8");
		const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
		if (typeof payload.email === "string") return payload.email;
		const profile = payload["https://api.openai.com/profile"];
		if (profile && typeof profile === "object") {
			const email = (profile as Record<string, unknown>).email;
			if (typeof email === "string") return email;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function oauthEmail(account: CodexAccount): string | undefined {
	if (account.type !== "oauth") return undefined;
	return oauthEmailFromAccess(account.access);
}

function accountTitle(account: CodexAccount, index: number): string {
	const email = oauthEmail(account);
	const name = accountDisplayName(account, index);
	if (email && name.startsWith("acct-")) return email;
	if (email) return `${email} (${name})`;
	return name;
}

function buildStatusMessage(accounts: CodexAccount[], activeCredential?: ProviderCredential): string {
	const summary = summarizeAccounts(accounts);
	const lines = [`codex quota: ${summary.sortedQuota} (${summary.fresh}/${summary.total} available)`];
	if (accounts.length === 0) {
		lines.push("No accounts in pool");
		return lines.join("\n");
	}

	const activeId = activeCredential ? credentialIdentity(activeCredential) : undefined;
	const rows = accounts.map((account, index) => ({
		account,
		index,
		isActive: activeId ? credentialIdentity(accountToCredential(account)) === activeId : false,
	}));

	rows.sort((a, b) => {
		if (a.isActive === b.isActive) return a.index - b.index;
		return a.isActive ? -1 : 1;
	});

	rows.forEach(({ account, index, isActive }) => {
		const bit = isFresh(account) ? "■" : "□";
		const title = accountTitle(account, index + 1);
		const activeMarker = isActive ? "▶" : " ";
		lines.push(`${activeMarker} ${bit} ${title}`);
	});

	return lines.join("\n");
}

function accountToCredential(account: CodexAccount): ProviderCredential {
	const copy: Record<string, unknown> = { ...account };
	for (const key of ACCOUNT_META_KEYS) {
		delete copy[key];
	}
	return copy as ProviderCredential;
}

function minutesUntil(isoTimestamp: string | undefined, nowMs: number): number {
	if (!isoTimestamp) return 0;
	const untilMs = Date.parse(isoTimestamp);
	if (!Number.isFinite(untilMs)) return 0;
	const delta = untilMs - nowMs;
	if (delta <= 0) return 0;
	return Math.ceil(delta / 60000);
}

function refreshCooldowns(accounts: CodexAccount[], nowMs: number): CodexAccount[] {
	return accounts.map((account) => {
		const minutes5 = minutesUntil(account.exhausted5hUntil, nowMs);
		const minutes7 = minutesUntil(account.exhaustedWeeklyUntil, nowMs);
		return {
			...account,
			exhausted5hUntil: minutes5 > 0 ? account.exhausted5hUntil : undefined,
			exhaustedWeeklyUntil: minutes7 > 0 ? account.exhaustedWeeklyUntil : undefined,
			minutesUntil5hRefresh: minutes5,
			minutesUntilWeeklyRefresh: minutes7,
		};
	});
}

function isFresh(account: CodexAccount): boolean {
	return (account.minutesUntil5hRefresh ?? 0) === 0 && (account.minutesUntilWeeklyRefresh ?? 0) === 0;
}

function upsertOrReplaceCurrentAccount(accounts: CodexAccount[], credential: ProviderCredential): CodexAccount[] {
	if (credential.type === "api_key") {
		const id = credentialIdentity(credential);
		const existing = accounts.find((a) => credentialIdentity(accountToCredential(a)) === id);
		if (existing) return accounts;
		return [...accounts, { ...(credential as any), minutesUntil5hRefresh: 0, minutesUntilWeeklyRefresh: 0 }];
	}

	const currentEmail = oauthEmailFromAccess(credential.access)?.toLowerCase();
	const matchesCurrent = (account: CodexAccount): boolean => {
		if (account.type !== "oauth") return false;

		// Primary identity: email from access token.
		// Do NOT merge on accountId because different logins can share accountId.
		const existingEmail = oauthEmail(account)?.toLowerCase();
		if (currentEmail && existingEmail) {
			return existingEmail === currentEmail;
		}

		// Fallback identity when email is unavailable.
		return account.refresh === credential.refresh;
	};

	const updated: CodexAccount[] = [];
	let inserted = false;
	for (const account of accounts) {
		if (!matchesCurrent(account)) {
			updated.push(account);
			continue;
		}
		if (inserted) {
			continue;
		}
		inserted = true;
		updated.push({
			...credential,
			name: account.name,
			minutesUntil5hRefresh: 0,
			minutesUntilWeeklyRefresh: 0,
		});
	}

	if (!inserted) {
		updated.push({ ...(credential as any), minutesUntil5hRefresh: 0, minutesUntilWeeklyRefresh: 0 });
	}

	return updated;
}

function detectQuotaWindow(errorMessage: string): QuotaDetection {
	const isQuota =
		/\bquota\b|limit reached|usage limit|exhausted|5\s*[- ]?hour|7\s*[- ]?day|weekly\s+limit|weekly\s+quota/i.test(
			errorMessage,
		);
	if (!isQuota) {
		return { isQuota: false, has5hWindow: false, hasWeeklyWindow: false };
	}

	const has5hWindow = /5\s*[- ]?hour|5h|per\s*5\s*hours?/i.test(errorMessage);
	const hasWeeklyWindow = /7\s*[- ]?day|7d|weekly|per\s*week/i.test(errorMessage);

	return { isQuota: true, has5hWindow, hasWeeklyWindow };
}

function markExhausted(
	accounts: CodexAccount[],
	currentCredential: ProviderCredential,
	errorMessage: string,
	nowMs: number,
): CodexAccount[] {
	const detection = detectQuotaWindow(errorMessage);
	const nowIso = new Date(nowMs).toISOString();
	const currentId = credentialIdentity(currentCredential);
	const withCurrent = upsertOrReplaceCurrentAccount(accounts, currentCredential);

	return withCurrent.map((account) => {
		if (credentialIdentity(accountToCredential(account)) !== currentId) return account;

		const mark5h = detection.has5hWindow || (!detection.has5hWindow && !detection.hasWeeklyWindow);
		const markWeekly = detection.hasWeeklyWindow;

		return {
			...account,
			exhaustedInPiAt: nowIso,
			exhausted5hUntil: mark5h ? new Date(nowMs + FIVE_HOURS_MS).toISOString() : account.exhausted5hUntil,
			exhaustedWeeklyUntil: markWeekly
				? new Date(nowMs + SEVEN_DAYS_MS).toISOString()
				: account.exhaustedWeeklyUntil,
			lastExhaustedMessage: errorMessage,
		};
	});
}

function quotaBarString(accounts: CodexAccount[], sortForDisplay: boolean): string {
	const bits = accounts.map((account) => (isFresh(account) ? "■" : "□"));
	if (sortForDisplay) {
		bits.sort((a, b) => {
			if (a === b) return 0;
			return a === "■" ? -1 : 1;
		});
	}
	return bits.join("");
}

function pickNextFreshAccount(
	accounts: CodexAccount[],
	currentId: string,
): { picked: CodexAccount; reordered: CodexAccount[] } | null {
	const freshIndexes = accounts
		.map((account, index) => ({ account, index }))
		.filter(({ account }) => isFresh(account));

	if (freshIndexes.length === 0) return null;

	const preferred =
		freshIndexes.find(({ account }) => credentialIdentity(accountToCredential(account)) !== currentId) ?? freshIndexes[0];
	const picked = preferred.account;
	const reordered = accounts.filter((_account, index) => index !== preferred.index);
	reordered.push({ ...picked });
	return { picked, reordered };
}

function summarizeAccounts(accounts: CodexAccount[]): { total: number; fresh: number; used: number; sortedQuota: string } {
	const fresh = accounts.filter((account) => isFresh(account)).length;
	const total = accounts.length;
	return {
		total,
		fresh,
		used: total - fresh,
		sortedQuota: quotaBarString(accounts, true),
	};
}

function getAssistantErrorMessage(event: MessageEndEvent): string | undefined {
	const message = event.message as Record<string, unknown>;
	if (message.role !== "assistant") return undefined;
	if (message.stopReason !== "error") return undefined;
	if (typeof message.errorMessage !== "string" || message.errorMessage.length === 0) return undefined;
	return message.errorMessage;
}

function sendAudit(pi: ExtensionAPI, message: string, details: Record<string, unknown>): void {
	pi.sendMessage({
		customType: AUDIT_CUSTOM_TYPE,
		content: message,
		display: true,
		details,
	});
}

async function showRotateConfirm(
	ctx: ExtensionContext,
	accounts: CodexAccount[],
	picked: CodexAccount,
	errorMessage: string,
): Promise<boolean> {
	if (!ctx.hasUI) return false;

	const summary = summarizeAccounts(accounts);
	const pickedId = credentialIdentity(accountToCredential(picked));
	const pickedIndex = accounts.findIndex((account) => credentialIdentity(accountToCredential(account)) === pickedId);
	const pickedTitle = accountTitle(picked, pickedIndex >= 0 ? pickedIndex + 1 : 1);

	return ctx.ui.custom<boolean>(
		(tui, theme, _kb, done) => {
			let selected = 0; // 0 = Yes, 1 = No
			let cachedLines: string[] | undefined;

			const request = () => {
				cachedLines = undefined;
				tui.requestRender();
			};

			const render = (width: number): string[] => {
				if (cachedLines) return cachedLines;
				const innerWidth = Math.max(30, width - 2);
				const content: string[] = [];
				const add = (line: string) => content.push(truncateToWidth(line, innerWidth));

				add(theme.fg("warning", theme.bold(" Codex Quota Rotation")));
				content.push("");
				add(theme.fg("warning", ` Quota: ${summary.sortedQuota}`));
				add(theme.fg("warning", ` Available: ${summary.fresh} / ${summary.total}`));
				add(theme.fg("warning", ` Next account: ${pickedTitle}`));
				content.push("");
				add(theme.fg("warning", ` Error: ${errorMessage}`));
				content.push("");
				add(theme.fg("warning", " Rotate now?"));
				const yes = selected === 0 ? theme.bg("selectedBg", theme.fg("text", " Yes ")) : theme.fg("warning", " Yes ");
				const no = selected === 1 ? theme.bg("selectedBg", theme.fg("text", " No ")) : theme.fg("warning", " No ");
				add(` ${yes}   ${no}`);
				content.push("");
				add(theme.fg("dim", " ←→ choose • Enter confirm • Esc cancel"));

				const lines: string[] = [];
				const border = theme.fg("warning", `╭${"─".repeat(innerWidth)}╮`);
				lines.push(border);
				for (const line of content) {
					const clipped = truncateToWidth(line, innerWidth);
					const pad = Math.max(0, innerWidth - visibleWidth(clipped));
					lines.push(`${theme.fg("warning", "│")}${clipped}${" ".repeat(pad)}${theme.fg("warning", "│")}`);
				}
				lines.push(theme.fg("warning", `╰${"─".repeat(innerWidth)}╯`));
				cachedLines = lines;
				return lines;
			};

			const handleInput = (data: string) => {
				if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
					done(false);
					return;
				}
				if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
					selected = 0;
					request();
					return;
				}
				if (matchesKey(data, Key.right) || matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
					selected = 1;
					request();
					return;
				}
				if (data === "y" || data === "Y") {
					selected = 0;
					done(true);
					return;
				}
				if (data === "n" || data === "N") {
					selected = 1;
					done(false);
					return;
				}
				if (matchesKey(data, Key.enter)) {
					done(selected === 0);
				}
			};

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
				},
				handleInput,
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "78%",
				maxHeight: "60%",
			},
		},
	);
}

async function syncCurrentCredentialIntoPool(ctx: ExtensionContext): Promise<void> {
	await withAccountsLock(async () => {
		const current = ctx.modelRegistry.authStorage.get(PROVIDER_ID);
		if (!isProviderCredential(current)) return;
		const nowMs = Date.now();
		const accounts = refreshCooldowns(upsertOrReplaceCurrentAccount(readAccounts(), current), nowMs);
		writeAccounts(accounts);
	});
}

function updateFooterStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus("pi-codex-rotator", undefined);
}

export default function codexRotator(pi: ExtensionAPI) {
	let rotationInFlight = false;

	pi.on("context", (event) => {
		const filtered = event.messages.filter((message: any) => {
			return !(message.role === "custom" && message.customType === AUDIT_CUSTOM_TYPE);
		});
		if (filtered.length === event.messages.length) return;
		return { messages: filtered };
	});

	pi.on("session_start", async (_event, ctx) => {
		ensureRotatorFiles();
		await syncCurrentCredentialIntoPool(ctx);
		updateFooterStatus(ctx);
	});

	const rotateNow = async (ctx: ExtensionContext): Promise<boolean> => {
		let rotated = false;
		await withAccountsLock(async () => {
			const current = ctx.modelRegistry.authStorage.get(PROVIDER_ID);
			if (!isProviderCredential(current)) {
				ctx.ui.notify(`pi-codex-rotator: ${PROVIDER_ID} credential is missing/unsupported`, "warning");
				return;
			}

			const accounts = refreshCooldowns(upsertOrReplaceCurrentAccount(readAccounts(), current), Date.now());
			const currentId = credentialIdentity(current);
			const pick = pickNextFreshAccount(accounts, currentId);
			if (!pick) {
				writeAccounts(accounts);
				ctx.ui.notify("pi-codex-rotator: no fresh account to rotate to", "warning");
				return;
			}

			const nowIso = new Date().toISOString();
			const pickedId = credentialIdentity(accountToCredential(pick.picked));
			const reusedCurrentAccount = pickedId === currentId;
			const reordered = refreshCooldowns(
				pick.reordered.map((account) =>
					credentialIdentity(accountToCredential(account)) === pickedId
						? { ...account, lastRotatedInAt: nowIso }
						: account,
				),
				Date.now(),
			);
			writeAccounts(reordered);
			const activeCredential = accountToCredential(pick.picked);
			const statusText = buildStatusMessage(reordered, activeCredential);
			ctx.modelRegistry.authStorage.set(PROVIDER_ID, activeCredential as any);
			ctx.ui.notify(statusText, "info");
			sendAudit(pi, statusText, {
				provider: PROVIDER_ID,
				kind: "status_after_manual_rotate",
				quota: quotaBarString(reordered, true),
			});
			if (reusedCurrentAccount) {
				sendAudit(pi, "Codex account unchanged (only available account)", {
					provider: PROVIDER_ID,
					unchanged: true,
					active: credentialLabel(pick.picked),
					quota: quotaBarString(reordered, true),
				});
			} else {
				sendAudit(pi, "Codex account rotated manually", {
					provider: PROVIDER_ID,
					rotatedTo: credentialLabel(pick.picked),
					quota: quotaBarString(reordered, true),
				});
			}
			rotated = true;
		});
		if (rotated) {
			updateFooterStatus(ctx);
		}
		return rotated;
	};

	pi.on("message_end", async (event, ctx) => {
		const errorMessage = getAssistantErrorMessage(event);
		if (!errorMessage) return;

		const detection = detectQuotaWindow(errorMessage);
		if (!detection.isQuota) return;
		if (rotationInFlight) return;

		rotationInFlight = true;
		try {
			await withAccountsLock(async () => {
				const settings = readSettings();
				const current = ctx.modelRegistry.authStorage.get(PROVIDER_ID);
				if (!isProviderCredential(current)) {
					ctx.ui.notify(`pi-codex-rotator: ${PROVIDER_ID} credential is missing/unsupported`, "warning");
					return;
				}

				let accounts = refreshCooldowns(upsertOrReplaceCurrentAccount(readAccounts(), current), Date.now());
				accounts = markExhausted(accounts, current, errorMessage, Date.now());
				accounts = refreshCooldowns(accounts, Date.now());

				const currentId = credentialIdentity(current);
				const pick = pickNextFreshAccount(accounts, currentId);
				if (!pick) {
					writeAccounts(accounts);
					const summary = summarizeAccounts(accounts);
					ctx.ui.notify(`pi-codex-rotator: no fresh accounts available (quota ${summary.sortedQuota})`, "warning");
					sendAudit(pi, "Codex rotation skipped: no fresh accounts available", {
						provider: PROVIDER_ID,
						quota: summary.sortedQuota,
						fresh: summary.fresh,
						total: summary.total,
						errorMessage,
					});
					return;
				}

				const shouldRotate =
					settings.autoRotate || !ctx.hasUI ? true : await showRotateConfirm(ctx, accounts, pick.picked, errorMessage);

				if (!shouldRotate) {
					writeAccounts(accounts);
					ctx.ui.notify("pi-codex-rotator: rotation declined", "info");
					sendAudit(pi, "Codex rotation declined", {
						provider: PROVIDER_ID,
						errorMessage,
						quota: quotaBarString(accounts, true),
					});
					return;
				}

				const nowIso = new Date().toISOString();
				const reordered = pick.reordered.map((account) =>
					credentialIdentity(accountToCredential(account)) === credentialIdentity(accountToCredential(pick.picked))
						? { ...account, lastRotatedInAt: nowIso }
						: account,
				);
				const refreshed = refreshCooldowns(reordered, Date.now());
				writeAccounts(refreshed);

				ctx.modelRegistry.authStorage.set(PROVIDER_ID, accountToCredential(pick.picked) as any);

				const summary = summarizeAccounts(refreshed);
				ctx.ui.notify(`pi-codex-rotator: rotated ${PROVIDER_ID} (quota ${summary.sortedQuota})`, "warning");
				sendAudit(pi, "Codex account rotated", {
					provider: PROVIDER_ID,
					autoRotate: settings.autoRotate,
					rotatedTo: credentialLabel(pick.picked),
					quota: summary.sortedQuota,
					fresh: summary.fresh,
					total: summary.total,
					errorMessage,
				});
			});
		} catch (error: any) {
			ctx.ui.notify(`pi-codex-rotator error: ${error?.message ?? String(error)}`, "warning");
		} finally {
			rotationInFlight = false;
			updateFooterStatus(ctx);
		}
	});

	pi.registerCommand("codex-rotator", {
		description: "status|rotate",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "") {
				await rotateNow(ctx);
				return;
			}

			if (action === "status") {
				await syncCurrentCredentialIntoPool(ctx);
				const accounts = refreshCooldowns(readAccounts(), Date.now());
				const activeCredential = ctx.modelRegistry.authStorage.get(PROVIDER_ID);
				ctx.ui.notify(
					buildStatusMessage(accounts, isProviderCredential(activeCredential) ? activeCredential : undefined),
					"info",
				);
				updateFooterStatus(ctx);
				return;
			}

			if (action === "rotate") {
				await rotateNow(ctx);
				return;
			}

			ctx.ui.notify("Usage: /codex-rotator status|rotate", "info");
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("pi-codex-rotator", undefined);
	});
}
