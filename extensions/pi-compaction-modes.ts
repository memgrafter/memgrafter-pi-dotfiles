import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import { generateSummary } from "@earendil-works/pi-coding-agent";

const KEEP_NO_PRE_COMPACTION_MESSAGES_ID = "__pi_compaction_modes_keep_none__";
const SETTINGS_SECTION = "pi-compaction-modes";
const COMPACTION_MODES = ["programmatic", "agentic", "full", "cached", "cached-programmatic", "vanilla"] as const;
const DEFAULT_COMPACTION_MODE: CompactionMode = "vanilla";

type CompactionMode = (typeof COMPACTION_MODES)[number];

const DEFAULT_COMPACTION_OPTIONS = {
	retention: {
		mode: "none" as RetentionMode,
		keepRecentMessages: 0,
		missingFirstKeptEntryId: KEEP_NO_PRE_COMPACTION_MESSAGES_ID,
	},
	agentic: {
		enabled: true,
		useModelSummary: true,
	},
	nonAgentic: {
		enabled: true,
		maxArgumentCharacters: 300,
		maxUnknownToolCallCharacters: 300,
		maxBashCommandCharacters: 1200,
	},
} as const;

type RetentionMode = "none" | "builtin" | "last-turn" | "last-n-messages";

type CompactionModeSettings = {
	mode?: CompactionMode;
};

type CommandIntent =
	| { action: "compact"; mode?: CompactionMode; customInstructions?: string }
	| { action: "set"; mode: CompactionMode }
	| { action: "help" }
	| { action: "invalid"; message: string };

type AutocompleteItemLike = {
	value: string;
	label: string;
	description?: string;
};

type AutocompleteProviderLike = {
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: { signal: AbortSignal; force?: boolean },
	): Promise<{ items: AutocompleteItemLike[]; prefix: string } | null>;
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItemLike,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number };
	shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean;
};

type ToolMessageLike = {
	role?: unknown;
	content?: unknown;
};

type ToolCallBlockLike = {
	type?: unknown;
	name?: unknown;
	arguments?: unknown;
};

type CompactionOptions = typeof DEFAULT_COMPACTION_OPTIONS;

type RetentionPlan = {
	mode: RetentionMode;
	firstKeptEntryId: string;
	compactedMessages: AgentMessage[];
	keptMessages: AgentMessage[];
	compactedEntryCount: number;
	keptEntryCount: number;
	reliesOnMissingFirstKeptEntryId: boolean;
};

type AgenticCompactionInput = {
	messages: AgentMessage[];
	ctx: ExtensionContext;
	customInstructions?: string;
	signal: AbortSignal;
	reserveTokens: number;
	pathDisplayPolicy: PathDisplayPolicy;
};

type NonAgenticCompactionInput = {
	messages: AgentMessage[];
	options: CompactionOptions["nonAgentic"];
	pathDisplayPolicy: PathDisplayPolicy;
};

type PathDisplayPolicy = {
	workingDirectory: string;
	homeDirectory: string;
};

type CompactionSection = {
	title: string;
	body: string;
};

type CompactionComponent = {
	sections: CompactionSection[];
	details: Record<string, unknown>;
};

export type ExtractedToolCall = {
	name: string;
	arguments: unknown;
};

function isMessageEntry(entry: SessionEntry): entry is SessionEntry & { type: "message"; message: AgentMessage } {
	return entry.type === "message";
}

function isTurnStart(message: AgentMessage): boolean {
	return message.role === "user" || message.role === "bashExecution";
}

function getLatestCompactionIndex(entries: SessionEntry[]): number {
	for (let index = entries.length - 1; index >= 0; index--) {
		if (entries[index].type === "compaction") return index;
	}
	return -1;
}

function getCurrentSegmentEntries(entries: SessionEntry[]): SessionEntry[] {
	const latestCompactionIndex = getLatestCompactionIndex(entries);
	return entries.slice(latestCompactionIndex + 1);
}

function getMessageEntries(entries: SessionEntry[]): Array<SessionEntry & { type: "message"; message: AgentMessage }> {
	return entries.filter(isMessageEntry);
}

function splitForLastTurn(entries: SessionEntry[]): {
	compactedEntries: Array<SessionEntry & { type: "message"; message: AgentMessage }>;
	keptEntries: Array<SessionEntry & { type: "message"; message: AgentMessage }>;
} {
	const messageEntries = getMessageEntries(entries);
	let keepStartIndex = messageEntries.length;

	for (let index = messageEntries.length - 1; index >= 0; index--) {
		if (isTurnStart(messageEntries[index].message)) {
			keepStartIndex = index;
			break;
		}
	}

	return {
		compactedEntries: messageEntries.slice(0, keepStartIndex),
		keptEntries: messageEntries.slice(keepStartIndex),
	};
}

function splitForLastNMessages(
	entries: SessionEntry[],
	keepRecentMessages: number,
): {
	compactedEntries: Array<SessionEntry & { type: "message"; message: AgentMessage }>;
	keptEntries: Array<SessionEntry & { type: "message"; message: AgentMessage }>;
} {
	const messageEntries = getMessageEntries(entries);
	const keepCount = Math.max(0, keepRecentMessages);
	if (keepCount === 0) return { compactedEntries: messageEntries, keptEntries: [] };

	return {
		compactedEntries: messageEntries.slice(0, Math.max(0, messageEntries.length - keepCount)),
		keptEntries: messageEntries.slice(Math.max(0, messageEntries.length - keepCount)),
	};
}

function buildRetentionPlan(
	entries: SessionEntry[],
	preparation: {
		firstKeptEntryId: string;
		messagesToSummarize: AgentMessage[];
		turnPrefixMessages: AgentMessage[];
	},
	options: CompactionOptions["retention"],
): RetentionPlan {
	if (options.mode === "builtin") {
		const compactedMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
		return {
			mode: options.mode,
			firstKeptEntryId: preparation.firstKeptEntryId,
			compactedMessages,
			keptMessages: [],
			compactedEntryCount: compactedMessages.length,
			keptEntryCount: -1,
			reliesOnMissingFirstKeptEntryId: false,
		};
	}

	const currentSegmentEntries = getCurrentSegmentEntries(entries);
	const split =
		options.mode === "last-turn"
			? splitForLastTurn(currentSegmentEntries)
			: splitForLastNMessages(currentSegmentEntries, options.keepRecentMessages);
	const keptMessages = split.keptEntries.map((entry) => entry.message);
	const compactedMessages = split.compactedEntries.map((entry) => entry.message);
	const firstKeptEntryId = split.keptEntries[0]?.id ?? options.missingFirstKeptEntryId;

	return {
		mode: options.mode,
		firstKeptEntryId,
		compactedMessages,
		keptMessages,
		compactedEntryCount: split.compactedEntries.length,
		keptEntryCount: split.keptEntries.length,
		reliesOnMissingFirstKeptEntryId: split.keptEntries.length === 0,
	};
}

function getToolCallBlocks(message: unknown): ToolCallBlockLike[] {
	const candidate = message as ToolMessageLike;
	if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return [];

	return candidate.content.filter((block): block is ToolCallBlockLike => {
		return Boolean(block && typeof block === "object" && (block as ToolCallBlockLike).type === "toolCall");
	});
}

export function extractToolCalls(messages: unknown[]): ExtractedToolCall[] {
	const toolCalls: ExtractedToolCall[] = [];

	for (const message of messages) {
		for (const block of getToolCallBlocks(message)) {
			if (typeof block.name !== "string") continue;
			toolCalls.push({
				name: block.name,
				arguments: block.arguments ?? {},
			});
		}
	}

	return toolCalls;
}

function cleanPathCandidate(value: string): string | undefined {
	const candidate = value.trim().replace(/^@(?=\S)/, "");

	if (!candidate || candidate.includes("\0") || candidate.includes("\n") || candidate.includes("\r")) return;
	if (candidate.endsWith("/")) return;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return;

	return candidate;
}

function createPathDisplayPolicy(): PathDisplayPolicy {
	return {
		workingDirectory: path.resolve(process.cwd()),
		homeDirectory: path.resolve(homedir()),
	};
}

function isCompactionMode(value: string): value is CompactionMode {
	return (COMPACTION_MODES as readonly string[]).includes(value);
}

function normalizeMode(value: unknown): CompactionMode | undefined {
	if (typeof value !== "string") return;
	const normalized = value.trim().toLowerCase();
	return isCompactionMode(normalized) ? normalized : undefined;
}

function parseCommandIntent(customInstructions: string | undefined): CommandIntent {
	const trimmed = customInstructions?.trim() ?? "";
	if (!trimmed) return { action: "compact" };

	const [command, argument, ...extra] = trimmed.split(/\s+/);
	const normalizedCommand = command.toLowerCase();
	const normalizedArgument = argument?.toLowerCase();

	if (normalizedCommand === "help" || normalizedCommand === "?") return { action: "help" };

	if (normalizedCommand === "set") {
		if (!normalizedArgument || extra.length > 0) {
			return { action: "invalid", message: "Usage: /compact [set] programmatic|agentic|full|cached|cached-programmatic|vanilla" };
		}
		const mode = normalizeMode(normalizedArgument);
		return mode
			? { action: "set", mode }
			: { action: "invalid", message: `Unknown compaction mode: ${argument}` };
	}

	const mode = normalizeMode(normalizedCommand);
	if (mode && !argument) return { action: "compact", mode };

	return { action: "compact", customInstructions: trimmed };
}

function getProjectSettingsPath(cwd: string): string {
	return path.join(cwd, ".pi", "settings.json");
}

function getGlobalSettingsPath(): string {
	return path.join(homedir(), ".pi", "agent", "settings.json");
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) return;
	const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
	return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

function readModeFromSettingsFile(filePath: string): CompactionMode | undefined {
	const settings = readJsonObject(filePath);
	const section = settings?.[SETTINGS_SECTION];
	if (!section || typeof section !== "object" || Array.isArray(section)) return;
	return normalizeMode((section as CompactionModeSettings).mode);
}

function resolveConfiguredMode(cwd: string): CompactionMode {
	return readModeFromSettingsFile(getProjectSettingsPath(cwd)) ?? readModeFromSettingsFile(getGlobalSettingsPath()) ?? DEFAULT_COMPACTION_MODE;
}

function getSettingsPathToUpdate(cwd: string): string {
	const projectSettingsPath = getProjectSettingsPath(cwd);
	const projectSettings = readJsonObject(projectSettingsPath);
	return projectSettings?.[SETTINGS_SECTION] !== undefined ? projectSettingsPath : getGlobalSettingsPath();
}

function writeConfiguredMode(cwd: string, mode: CompactionMode): string {
	const settingsPath = getSettingsPathToUpdate(cwd);
	const settings = readJsonObject(settingsPath) ?? {};
	const section = settings[SETTINGS_SECTION];
	const nextSection = section && typeof section === "object" && !Array.isArray(section) ? section : {};

	settings[SETTINGS_SECTION] = {
		...nextSection,
		mode,
	};

	mkdirSync(path.dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
	return settingsPath;
}

function buildCompactUsageLine(): string {
	return `/compact [set] programmatic|agentic|full|cached|cached-programmatic|vanilla`;
}

function buildCompactUsageLineWithCurrent(currentMode: CompactionMode): string {
	return `${buildCompactUsageLine()} — current: ${currentMode}`;
}

function buildHelpText(currentMode: CompactionMode): string {
	return [
		"Compaction modes:",
		`Usage: ${buildCompactUsageLineWithCurrent(currentMode)}`,
		"- no mode: compact with the configured mode; defaults to vanilla when unset",
		"- programmatic: ordered markdown tool traces only",
		"- agentic: agentic summary only",
		"- full: agentic summary plus programmatic trace",
		"- cached: Pi default compaction via extension (same summary, no built-in compaction)",
		"- cached-programmatic: cached summary plus ordered tool trace",
		"- vanilla: Pi default compaction",
		"- set <mode>: save the configured mode in settings.json",
	].join("\n");
}

function getCompactArgumentCompletions(prefix: string): AutocompleteItemLike[] | null {
	const items: AutocompleteItemLike[] = [
		{ value: "programmatic", label: "programmatic", description: "ordered markdown tool traces only" },
		{ value: "agentic", label: "agentic", description: "agentic summary only" },
		{ value: "full", label: "full", description: "agentic summary plus programmatic trace" },
		{ value: "cached", label: "cached", description: "Pi default compaction via extension (same summary, no built-in compaction)" },
		{ value: "cached-programmatic", label: "cached-programmatic", description: "cached summary plus ordered tool trace" },
		{ value: "vanilla", label: "vanilla", description: "Pi default compaction" },
		{ value: "set programmatic", label: "set programmatic", description: "save programmatic as the configured mode" },
		{ value: "set agentic", label: "set agentic", description: "save agentic as the configured mode" },
		{ value: "set full", label: "set full", description: "save full as the configured mode" },
		{ value: "set cached", label: "set cached", description: "save cached as the configured mode" },
		{ value: "set cached-programmatic", label: "set cached-programmatic", description: "save cached-programmatic as the configured mode" },
		{ value: "set vanilla", label: "set vanilla", description: "save vanilla as the configured mode" },
		{ value: "help", label: "help", description: "show compaction mode help" },
	];
	const normalizedPrefix = prefix.trim().toLowerCase();
	if (!normalizedPrefix) return items;
	const filtered = items.filter((item) => `${item.value} ${item.description ?? ""}`.toLowerCase().includes(normalizedPrefix));
	return filtered.length > 0 ? filtered : null;
}

function replaceCompactCommandDescription(
	suggestions: { items: AutocompleteItemLike[]; prefix: string } | null,
	cwd: string,
): { items: AutocompleteItemLike[]; prefix: string } | null {
	if (!suggestions) return null;
	const description = buildCompactUsageLineWithCurrent(resolveConfiguredMode(cwd));
	return {
		...suggestions,
		items: suggestions.items.map((item) =>
			item.value === "compact" || item.label === "compact" ? { ...item, description } : item,
		),
	};
}

function createCompactAutocompleteProvider(current: AutocompleteProviderLike, cwd: string): AutocompleteProviderLike {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const currentLine = lines[cursorLine] ?? "";
			const textBeforeCursor = currentLine.slice(0, cursorCol);
			if (textBeforeCursor.startsWith("/compact ")) {
				const prefix = textBeforeCursor.slice("/compact ".length);
				const items = getCompactArgumentCompletions(prefix);
				if (items) return { items, prefix };
			}

			const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			const isSlashCommandNameCompletion = textBeforeCursor.startsWith("/") && !textBeforeCursor.includes(" ");
			return isSlashCommandNameCompletion ? replaceCompactCommandDescription(suggestions, cwd) : suggestions;
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
		},
	};
}

function isSubmitKey(data: string): boolean {
	return data === "\r" || data === "\n" || data === "\r\n";
}

function parseCompactEditorText(text: string): CommandIntent | undefined {
	const trimmed = text.trim();
	if (trimmed !== "/compact" && !trimmed.startsWith("/compact ")) return;
	return parseCommandIntent(trimmed.startsWith("/compact ") ? trimmed.slice(9).trim() : undefined);
}

function handleCompactCommandWithoutCompacting(ctx: ExtensionContext, intent: CommandIntent): boolean {
	if (intent.action === "help") {
		ctx.ui.notify(buildHelpText(resolveConfiguredMode(ctx.cwd)), "info");
		ctx.ui.setEditorText("");
		return true;
	}

	if (intent.action === "set") {
		const settingsPath = writeConfiguredMode(ctx.cwd, intent.mode);
		ctx.ui.notify(`Compaction mode set to ${intent.mode} in ${formatPathForSummary(settingsPath, createPathDisplayPolicy())}.`, "info");
		ctx.ui.setEditorText("");
		return true;
	}

	if (intent.action === "invalid") {
		ctx.ui.notify(`${intent.message}\n${buildHelpText(resolveConfiguredMode(ctx.cwd))}`, "warning");
		ctx.ui.setEditorText("");
		return true;
	}

	return false;
}

function toDisplaySeparators(value: string): string {
	return value.split(path.sep).join("/");
}

function isWithinDirectory(candidate: string, directory: string): boolean {
	const relativePath = path.relative(directory, candidate);
	return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function expandHomePath(candidate: string, policy: PathDisplayPolicy): string {
	if (candidate === "~") return policy.homeDirectory;
	if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
		return path.join(policy.homeDirectory, candidate.slice(2));
	}

	return candidate;
}

function resolvePathCandidate(candidate: string, policy: PathDisplayPolicy): string {
	const expanded = expandHomePath(candidate, policy);
	return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(policy.workingDirectory, expanded);
}

function formatPathForSummary(value: string, policy: PathDisplayPolicy): string {
	const candidate = cleanPathCandidate(value) ?? value.trim();
	if (!candidate) return value;

	const absolutePath = resolvePathCandidate(candidate, policy);
	if (isWithinDirectory(absolutePath, policy.workingDirectory)) {
		const relativePath = path.relative(policy.workingDirectory, absolutePath);
		return relativePath === "" ? "." : toDisplaySeparators(relativePath);
	}

	if (isWithinDirectory(absolutePath, policy.homeDirectory)) {
		const relativePath = path.relative(policy.homeDirectory, absolutePath);
		return relativePath === "" ? "~" : `~/${toDisplaySeparators(relativePath)}`;
	}

	return toDisplaySeparators(absolutePath);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAbsolutePathPrefix(text: string, absolutePrefix: string, nestedReplacement: string, exactReplacement: string): string {
	const normalizedPrefix = toDisplaySeparators(path.resolve(absolutePrefix)).replace(/\/+$/, "");
	const escapedPrefix = escapeRegex(normalizedPrefix);
	const delimiterPattern = "(?=$|[\\s\\\"'`);,]|&&|\\|\\|)";

	return text
		.replace(new RegExp(`${escapedPrefix}/`, "g"), nestedReplacement)
		.replace(new RegExp(`${escapedPrefix}${delimiterPattern}`, "g"), exactReplacement);
}

function formatPathsInTextForSummary(value: string, policy: PathDisplayPolicy): string {
	const slashNormalized = value.replace(/\\/g, "/");
	const cwdFormatted = replaceAbsolutePathPrefix(slashNormalized, policy.workingDirectory, "", ".");
	return replaceAbsolutePathPrefix(cwdFormatted, policy.homeDirectory, "~/", "~");
}

function describePathDisplayPolicy(policy: PathDisplayPolicy): string {
	return `Display files under the current working directory as relative paths (${formatPathForSummary(policy.workingDirectory, policy)}), files elsewhere under the home directory as ~/..., and files outside the home directory as absolute paths.`;
}

function getArgumentObject(toolCall: ExtractedToolCall): Record<string, unknown> {
	if (!toolCall.arguments || typeof toolCall.arguments !== "object" || Array.isArray(toolCall.arguments)) return {};
	return toolCall.arguments as Record<string, unknown>;
}

function truncate(value: string, maxCharacters: number): string {
	if (value.length <= maxCharacters) return value;
	return `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

type ToolTraceLine = string;

function compactPathArgument(value: unknown, policy: PathDisplayPolicy): unknown {
	return typeof value === "string" ? formatPathForSummary(value, policy) : value;
}

function compactUnknownValue(value: unknown, maxCharacters: number): unknown {
	if (typeof value === "string") return truncate(value, maxCharacters);
	if (Array.isArray(value)) return value.map((item) => compactUnknownValue(item, maxCharacters));
	if (!value || typeof value !== "object") return value;

	return Object.fromEntries(
		Object.entries(value).map(([key, nestedValue]) => [key, compactUnknownValue(nestedValue, maxCharacters)]),
	);
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

type TraceText = {
	text: string;
	truncated: boolean;
};

function truncateForTrace(value: string, maxCharacters: number): TraceText {
	return {
		text: truncate(value, maxCharacters),
		truncated: value.length > maxCharacters,
	};
}

function escapeTraceText(value: string): string {
	return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function toTraceText(value: unknown): string | undefined {
	if (value === undefined || value === null) return;
	if (typeof value === "string") return escapeTraceText(value);
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return safeStringify(value);
}

function tracePath(value: unknown, policy: PathDisplayPolicy, fallback: string): TraceText {
	return {
		text: toTraceText(compactPathArgument(value, policy)) ?? fallback,
		truncated: false,
	};
}

function traceText(value: unknown, maxCharacters: number, fallback: string): TraceText {
	if (typeof value !== "string") return { text: toTraceText(value) ?? fallback, truncated: false };
	const truncated = truncateForTrace(value, maxCharacters);
	return { text: escapeTraceText(truncated.text), truncated: truncated.truncated };
}

function traceBashCommand(value: unknown, policy: PathDisplayPolicy, maxCharacters: number): TraceText {
	if (typeof value !== "string") return { text: toTraceText(value) ?? "<unknown command>", truncated: false };
	const normalizedCommand = formatPathsInTextForSummary(value, policy);
	const truncated = truncateForTrace(normalizedCommand, maxCharacters);
	return { text: escapeTraceText(truncated.text), truncated: truncated.truncated };
}

function formatTraceDetails(details: Array<string | undefined>): string {
	return details.filter(Boolean).join(", ");
}

function formatTraceLine(
	tool: string,
	params: Array<string | undefined>,
	content: string | undefined,
	truncated = false,
): ToolTraceLine {
	return [tool, truncated ? "(truncated)" : undefined, formatTraceDetails(params), content].filter(Boolean).join(" ");
}

function traceDetail(name: string, value: unknown): string | undefined {
	const text = toTraceText(value);
	return text === undefined ? undefined : `${name} ${text}`;
}

function traceBooleanDetail(name: string, value: unknown): string | undefined {
	return value === true ? name : undefined;
}

function compactUnknownToolCall(toolCall: ExtractedToolCall, maxCharacters: number): ToolTraceLine {
	const rawValue = safeStringify({ tool: toolCall.name, arguments: compactUnknownValue(toolCall.arguments, maxCharacters) });
	const raw = truncateForTrace(rawValue, maxCharacters);
	return formatTraceLine(toolCall.name, [], raw.text, raw.truncated);
}

function compactToolCall(
	toolCall: ExtractedToolCall,
	options: CompactionOptions["nonAgentic"],
	policy: PathDisplayPolicy,
): ToolTraceLine {
	const args = getArgumentObject(toolCall);

	switch (toolCall.name) {
		case "read": {
			const pathText = tracePath(args.path, policy, "<unknown path>");
			return formatTraceLine("read", [traceDetail("offset", args.offset), traceDetail("limit", args.limit)], pathText.text);
		}
		case "write": {
			const pathText = tracePath(args.path, policy, "<unknown path>");
			const contentLength = typeof args.content === "string" ? `${args.content.length} chars` : undefined;
			return formatTraceLine("write", [traceDetail("content", contentLength)], pathText.text);
		}
		case "edit": {
			const pathText = tracePath(args.path, policy, "<unknown path>");
			const editCount = Array.isArray(args.edits) ? args.edits.length : undefined;
			const toolName = editCount && editCount > 1 ? `${editCount}x edit` : "edit";
			return formatTraceLine(toolName, [], pathText.text);
		}
		case "bash": {
			const commandText = traceBashCommand(args.command, policy, options.maxBashCommandCharacters);
			return formatTraceLine("bash", [traceDetail("timeout", args.timeout)], commandText.text, commandText.truncated);
		}
		case "ls": {
			const pathText = tracePath(args.path ?? ".", policy, ".");
			return formatTraceLine("ls", [traceDetail("limit", args.limit)], pathText.text);
		}
		case "grep": {
			const patternText = traceText(args.pattern, options.maxArgumentCharacters, "<unknown pattern>");
			const pathText = tracePath(args.path ?? ".", policy, ".");
			const globText = traceText(args.glob, options.maxArgumentCharacters, "");
			return formatTraceLine(
				"grep",
				[
					traceDetail("glob", globText.text || undefined),
					traceBooleanDetail("ignore-case", args.ignoreCase),
					traceBooleanDetail("literal", args.literal),
					traceDetail("context", args.context),
					traceDetail("limit", args.limit),
				],
				`${patternText.text} in ${pathText.text}`,
				patternText.truncated || globText.truncated,
			);
		}
		case "find": {
			const patternText = traceText(args.pattern, options.maxArgumentCharacters, "<unknown pattern>");
			const pathText = tracePath(args.path ?? ".", policy, ".");
			return formatTraceLine("find", [traceDetail("limit", args.limit)], `${patternText.text} in ${pathText.text}`, patternText.truncated);
		}
		default:
			return compactUnknownToolCall(toolCall, options.maxUnknownToolCallCharacters);
	}
}

function compactToolCalls(
	toolCalls: ExtractedToolCall[],
	options: CompactionOptions["nonAgentic"],
	policy: PathDisplayPolicy,
): ToolTraceLine[] {
	return toolCalls.map((toolCall) => compactToolCall(toolCall, options, policy));
}

function buildRetentionSection(retentionPlan: RetentionPlan): CompactionSection {
	return {
		title: "Policy",
		body: [
			`- Mode: \`${retentionPlan.mode}\``,
			`- Compacted pre-compaction messages: ${retentionPlan.compactedMessages.length}`,
			`- Kept pre-compaction messages: ${retentionPlan.keptMessages.length}`,
			`- firstKeptEntryId: \`${retentionPlan.firstKeptEntryId}\``,
			`- Missing-id keep-none behavior: ${retentionPlan.reliesOnMissingFirstKeptEntryId ? "yes" : "no"}`,
		].join("\n"),
	};
}

function buildRetentionCompaction(retentionPlan: RetentionPlan): CompactionComponent {
	return {
		sections: [buildRetentionSection(retentionPlan)],
		details: {
			mode: retentionPlan.mode,
			firstKeptEntryId: retentionPlan.firstKeptEntryId,
			compactedMessageCount: retentionPlan.compactedMessages.length,
			keptMessageCount: retentionPlan.keptMessages.length,
			compactedEntryCount: retentionPlan.compactedEntryCount,
			keptEntryCount: retentionPlan.keptEntryCount,
			reliesOnMissingFirstKeptEntryId: retentionPlan.reliesOnMissingFirstKeptEntryId,
		},
	};
}

async function generateAgenticSummary(input: AgenticCompactionInput): Promise<string> {
	if (input.messages.length === 0) return "- No compacted messages were available for agentic summarization.";
	if (!input.ctx.model) return "- Agentic model summary unavailable: no current model.";

	const auth = await input.ctx.modelRegistry.getApiKeyAndHeaders(input.ctx.model);
	if (!auth.ok || !auth.apiKey) return "- Agentic model summary unavailable: no API key for current model.";

	return generateSummary(
		input.messages,
		input.ctx.model,
		input.reserveTokens,
		auth.apiKey,
		auth.headers,
		input.signal,
		[
			"Produce only the agentic state needed to continue this coding session.",
			"Focus on goals, constraints, decisions, progress, blockers, next steps, and critical context.",
			describePathDisplayPolicy(input.pathDisplayPolicy),
			"Do not include ordered tool-call traces; those are provided separately in the programmatic section.",
			input.customInstructions,
		]
			.filter(Boolean)
			.join("\n"),
		undefined,
	);
}

async function buildAgenticCompaction(input: AgenticCompactionInput): Promise<CompactionComponent> {
	try {
		const summary = await generateAgenticSummary(input);
		return {
			sections: [{ title: "Model Summary", body: summary }],
			details: {
				method: "generateSummary",
				messageCount: input.messages.length,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			sections: [{ title: "Model Summary", body: `- Agentic model summary failed: ${message}` }],
			details: {
				method: "generateSummary",
				messageCount: input.messages.length,
				error: message,
			},
		};
	}
}

function formatToolTraceLine(toolCall: ToolTraceLine): string {
	return `- ${toolCall}`;
}

function buildOrderedToolTraceSection(toolCalls: ToolTraceLine[]): CompactionSection {
	return {
		title: "Ordered Tool Trace",
		body: toolCalls.length > 0 ? toolCalls.map(formatToolTraceLine).join("\n") : "- none detected",
	};
}

function buildNonAgenticCompaction(input: NonAgenticCompactionInput): CompactionComponent {
	const toolCalls = compactToolCalls(extractToolCalls(input.messages), input.options, input.pathDisplayPolicy);

	return {
		sections: [buildOrderedToolTraceSection(toolCalls)],
		details: {
			toolCalls,
		},
	};
}

function formatSection(section: CompactionSection): string {
	return `## ${section.title}\n${section.body}`;
}

function formatComponent(title: string, component: CompactionComponent): string {
	return [`# ${title}`, ...component.sections.map(formatSection)].join("\n\n");
}

function formatHybridSummary(components: Array<[string, CompactionComponent | undefined]>): string {
	return components
		.flatMap(([title, component]) => (component ? [formatComponent(title, component)] : []))
		.join("\n\n");
}

// Cached mode helpers — mirror Pi's built-in file ops logic
function computeCachedFileLists(fileOps: { read: Set<string>; written: Set<string>; edited: Set<string> }): {
	readFiles: string[];
	modifiedFiles: string[];
} {
	const modified = new Set([...fileOps.edited, ...fileOps.written]);
	const readOnly = [...fileOps.read].filter((f) => !modified.has(f)).sort();
	const modifiedFiles = [...modified].sort();
	return { readFiles: readOnly, modifiedFiles: modifiedFiles };
}

function formatCachedFileOperations(readFiles: string[], modifiedFiles: string[]): string {
	const sections: string[] = [];
	if (readFiles.length > 0) {
		sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
	}
	if (modifiedFiles.length > 0) {
		sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
	}
	if (sections.length === 0) return "";
	return `\n\n${sections.join("\n\n")}`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.addAutocompleteProvider((current) => createCompactAutocompleteProvider(current as AutocompleteProviderLike, ctx.cwd) as typeof current);
		ctx.ui.onTerminalInput((data) => {
			if (!isSubmitKey(data)) return;

			const intent = parseCompactEditorText(ctx.ui.getEditorText());
			if (!intent || !handleCompactCommandWithoutCompacting(ctx, intent)) return;

			return { consume: true };
		});
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const commandIntent = parseCommandIntent(event.customInstructions);
		const configuredMode = resolveConfiguredMode(ctx.cwd);

		if (commandIntent.action === "set") {
			const settingsPath = writeConfiguredMode(ctx.cwd, commandIntent.mode);
			ctx.ui.notify(`Compaction mode set to ${commandIntent.mode} in ${formatPathForSummary(settingsPath, createPathDisplayPolicy())}.`, "info");
			return { cancel: true };
		}

		if (commandIntent.action === "help") {
			ctx.ui.notify(buildHelpText(configuredMode), "info");
			return { cancel: true };
		}

		if (commandIntent.action === "invalid") {
			ctx.ui.notify(`${commandIntent.message}\n${buildHelpText(configuredMode)}`, "warning");
			return { cancel: true };
		}

		const requestedMode = normalizeMode((event as SessionBeforeCompactEvent & { compactionMode?: unknown }).compactionMode);
		const mode = requestedMode ?? commandIntent.mode ?? configuredMode;

		// Cached: generate same summary as Pi's built-in compaction, truncate via firstKeptEntryId
		if (mode === "cached" || mode === "cached-programmatic") {
			const { firstKeptEntryId, tokensBefore, previousSummary, fileOps, settings } = event.preparation;
			if (!ctx.model) {
				ctx.ui.notify("Cached compaction unavailable: no current model.", "warning");
				return { cancel: true };
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
			if (!auth.ok || !auth.apiKey) {
				ctx.ui.notify("Cached compaction unavailable: no API key for current model.", "warning");
				return { cancel: true };
			}

			const options = DEFAULT_COMPACTION_OPTIONS;
			const retention = buildRetentionPlan(event.branchEntries, event.preparation, options.retention);

			const baseSummary = await generateSummary(
				retention.compactedMessages,
				ctx.model,
				settings.reserveTokens,
				auth.apiKey,
				auth.headers,
				event.signal,
				commandIntent.customInstructions,
				previousSummary,
			);

			// Append file operations (same as Pi's built-in compaction)
			const { readFiles, modifiedFiles } = computeCachedFileLists(fileOps);
			let summaryContent = baseSummary + formatCachedFileOperations(readFiles, modifiedFiles);

			// Add programmatic tool trace for cached-programmatic mode
			if (mode === "cached-programmatic") {
				const pathDisplayPolicy = createPathDisplayPolicy();
				const toolTrace = buildNonAgenticCompaction({
					messages: retention.compactedMessages,
					options: options.nonAgentic,
					pathDisplayPolicy,
				});
				summaryContent += "\n\n" + formatComponent("Programmatic", toolTrace);
			}

			ctx.ui.notify(`Cached compaction captured context (mode: ${mode}).`, "info");

			return {
				compaction: {
					summary: summaryContent,
					firstKeptEntryId,
					tokensBefore,
					details: { mode, readFiles, modifiedFiles },
				},
			};
		}

		if (mode === "vanilla") return;

		const options = DEFAULT_COMPACTION_OPTIONS;
		const { firstKeptEntryId: _ignoredFirstKeptEntryId, tokensBefore, settings } = event.preparation;
		void _ignoredFirstKeptEntryId;

		const pathDisplayPolicy = createPathDisplayPolicy();
		const retention = buildRetentionPlan(event.branchEntries, event.preparation, options.retention);
		const retentionComponent = buildRetentionCompaction(retention);
		const includeAgentic = mode === "agentic" || mode === "full";
		const includeNonAgentic = mode === "programmatic" || mode === "full";
		const agentic = includeAgentic
			? await buildAgenticCompaction({
					messages: retention.compactedMessages,
					ctx,
					customInstructions: commandIntent.customInstructions,
					signal: event.signal,
					reserveTokens: settings.reserveTokens,
					pathDisplayPolicy,
				})
			: undefined;
		const nonAgentic = includeNonAgentic
			? buildNonAgenticCompaction({
					messages: retention.compactedMessages,
					options: options.nonAgentic,
					pathDisplayPolicy,
				})
			: undefined;
		const summary = formatHybridSummary([
			["Retention", retentionComponent],
			["Agentic", agentic],
			["Programmatic", nonAgentic],
		]);

		ctx.ui.notify(`Compaction mode '${mode}' captured context with extension-controlled retention.`, "info");

		return {
			compaction: {
				summary,
				firstKeptEntryId: retention.firstKeptEntryId,
				tokensBefore,
				details: {
					mode,
					configuredMode,
					retention: retentionComponent.details,
					agentic: agentic?.details,
					programmatic: nonAgentic?.details,
					options,
				},
			},
		};
	});
}
