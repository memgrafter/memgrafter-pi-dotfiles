import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	DEFAULT_COMPACTION_SETTINGS,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionBeforeCompactEvent,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

const KEEP_NO_PRE_COMPACTION_MESSAGES_ID = "__pi_compaction_modes_keep_none__";
const SETTINGS_SECTION = "pi-compaction-modes";
const COMPACTION_MODES = [
	"programmatic",
	"cached",
	"cached-agentic",
	"cached-agentic-tooltraces",
	"cached-handoff",
	"cached-handoff-tooltraces",
	"cached-summary-tooltraces",
	"vanilla",
] as const;
const DEFAULT_COMPACTION_MODE: CompactionMode = "vanilla";

type CompactionMode = (typeof COMPACTION_MODES)[number];

const DEFAULT_COMPACTION_OPTIONS = {
	retention: {
		mode: "none" as RetentionMode,
		keepRecentMessages: 0,
		missingFirstKeptEntryId: KEEP_NO_PRE_COMPACTION_MESSAGES_ID,
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
			return { action: "invalid", message: "Usage: /compact [set] programmatic|cached|cached-agentic|cached-agentic-tooltraces|cached-handoff|cached-handoff-tooltraces|cached-summary-tooltraces|vanilla" };
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
	return `/compact [set] programmatic|cached|cached-agentic|cached-agentic-tooltraces|cached-handoff|cached-handoff-tooltraces|cached-summary-tooltraces|vanilla`;
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
		"- cached: summary via chat turn (reuses prompt cache), no tool trace",
		"- cached-agentic: agentic summary via chat turn (reuses prompt cache), no tool trace",
		"- cached-agentic-tooltraces: agentic summary via chat turn plus ordered tool trace",
		"- cached-summary-tooltraces: summary via chat turn plus ordered tool trace",
		"- cached-handoff: handoff doc via chat turn, no tool trace",
		"- cached-handoff-tooltraces: handoff doc via chat turn plus ordered tool trace",
		"- vanilla: Pi default compaction",
		"- set <mode>: save the configured mode in settings.json",
	].join("\n");
}

function getCompactArgumentCompletions(prefix: string): AutocompleteItemLike[] | null {
	const items: AutocompleteItemLike[] = [
		{ value: "programmatic", label: "programmatic", description: "ordered markdown tool traces only" },
		{ value: "cached", label: "cached", description: "summary via chat turn (reuses prompt cache), no tool trace" },
		{ value: "cached-agentic", label: "cached-agentic", description: "agentic summary via chat turn (reuses prompt cache), no tool trace" },
		{ value: "cached-agentic-tooltraces", label: "cached-agentic-tooltraces", description: "agentic summary via chat turn plus ordered tool trace" },
		{ value: "cached-summary-tooltraces", label: "cached-summary-tooltraces", description: "summary via chat turn plus ordered tool trace" },
		{ value: "cached-handoff", label: "cached-handoff", description: "handoff doc via chat turn, no tool trace" },
		{ value: "cached-handoff-tooltraces", label: "cached-handoff-tooltraces", description: "handoff doc via chat turn plus ordered tool trace" },
		{ value: "vanilla", label: "vanilla", description: "Pi default compaction" },
		{ value: "set programmatic", label: "set programmatic", description: "save programmatic as the configured mode" },
		{ value: "set cached", label: "set cached", description: "save cached as the configured mode" },
		{ value: "set cached-agentic", label: "set cached-agentic", description: "save cached-agentic as the configured mode" },
		{ value: "set cached-agentic-tooltraces", label: "set cached-agentic-tooltraces", description: "save cached-agentic-tooltraces as the configured mode" },
		{ value: "set cached-summary-tooltraces", label: "set cached-summary-tooltraces", description: "save cached-summary-tooltraces as the configured mode" },
		{ value: "set cached-handoff", label: "set cached-handoff", description: "save cached-handoff as the configured mode" },
		{ value: "set cached-handoff-tooltraces", label: "set cached-handoff-tooltraces", description: "save cached-handoff-tooltraces as the configured mode" },
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

// ============================================================================
// Dance modes - compaction summary via a normal chat turn
// ============================================================================
// The summary is produced by an ordinary agent turn: the request is a byte-exact
// superset of the last main request (same system prompt, same messages, same
// tools, same session cache key) with only the instruction message appended, so
// the provider prompt cache is reused instead of reprocessing the conversation.

type DanceMode =
	| "cached"
	| "cached-agentic"
	| "cached-agentic-tooltraces"
	| "cached-handoff"
	| "cached-handoff-tooltraces"
	| "cached-summary-tooltraces";

const DANCE_MODES: readonly DanceMode[] = [
	"cached",
	"cached-agentic",
	"cached-agentic-tooltraces",
	"cached-handoff",
	"cached-handoff-tooltraces",
	"cached-summary-tooltraces",
];

const DANCE_MODE_SET = new Set<string>(DANCE_MODES);

function isDanceMode(mode: CompactionMode): mode is DanceMode {
	return DANCE_MODE_SET.has(mode);
}

const DANCE_SUMMARY_MESSAGE = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages. do not use tools, do not do any work.`;
const DANCE_AGENTIC_MESSAGE =
	"Produce only the agentic state needed to continue this coding session. Focus on goals, constraints, decisions, progress, blockers, next steps, and critical context. Do not include ordered tool-call traces; those are provided separately in the programmatic section. do not use tools, do not do any work.";
const DANCE_HANDOFF_MESSAGE =
	"Write a handoff doc for a new agent to continue the session. Ensure the handoff is standalone and contains all details necessary to continue where we left off. do not use tools, do not do any work.";

function buildDanceMessage(mode: DanceMode, customInstructions: string | undefined): string {
	const prompt = mode.startsWith("cached-handoff")
		? DANCE_HANDOFF_MESSAGE
		: mode.startsWith("cached-agentic")
			? DANCE_AGENTIC_MESSAGE
			: DANCE_SUMMARY_MESSAGE;
	const parts = [prompt];
	if (customInstructions?.trim()) parts.push(customInstructions.trim());
	return parts.join("\n\n");
}

function extractAssistantText(message: AgentMessage): string {
	if (message.role !== "assistant") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => {
			return Boolean(
				block &&
					typeof block === "object" &&
					(block as { type?: unknown }).type === "text" &&
					typeof (block as { text?: unknown }).text === "string",
			);
		})
		.map((block) => (block as { text: string }).text)
		.join("");
}

type DanceState =
	| { status: "pending"; mode: DanceMode }
	| { status: "captured"; mode: DanceMode; summary: string };

function exceedsToolBatchCompactionThreshold(ctx: ExtensionContext): boolean {
	const usage = ctx.getContextUsage();
	if (usage?.tokens == null) return false;

	return usage.tokens > usage.contextWindow - DEFAULT_COMPACTION_SETTINGS.reserveTokens;
}

let danceState: DanceState | undefined;
let compactAfterAgentSettles = false;

export default function (pi: ExtensionAPI) {
	pi.on("message_end", (event) => {
		if (!danceState || danceState.status !== "pending") return;
		const text = extractAssistantText(event.message);
		if (!text) return;
		danceState = { status: "captured", mode: danceState.mode, summary: text };
	});

	pi.on("turn_end", (event, ctx) => {
		if (danceState) {
			// A user abort ends the summary turn; do not auto-retry or compact.
			if (event.message.role === "assistant" && (event.message as { stopReason?: string }).stopReason === "aborted") {
				ctx.ui.notify("Compaction summary cancelled. No compaction performed.", "info");
				danceState = undefined;
				return;
			}
			if (danceState.status === "captured") {
				setTimeout(() => {
					if (danceState?.status !== "captured") return;
					// Keep the captured state: phase 3 consumes it when session_before_compact
					// fires inside compact(). Clearing it here would restart phase 1 in a loop.
					ctx.compact();
				}, 0);
				return;
			}
			// The summary turn ended without a usable reply; fail without retrying.
			ctx.ui.notify("Compaction summary failed. No compaction performed. Try /compact again or use another mode.", "warning");
			danceState = undefined;
			return;
		}

		if (event.toolResults.length === 0) return;
		if (compactAfterAgentSettles) return;
		if (!exceedsToolBatchCompactionThreshold(ctx)) return;

		compactAfterAgentSettles = true;
		ctx.ui.notify("Compaction threshold reached after tool execution. Stopping the current turn...", "info");
		ctx.abort();
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!compactAfterAgentSettles) return;

		compactAfterAgentSettles = false;
		ctx.compact();
	});

	pi.on("session_start", async (_event, ctx) => {
		danceState = undefined;
		compactAfterAgentSettles = false;
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

		// Dance modes: the summary comes from a normal chat turn (provider prompt
		// cache reused), not from a standalone summarization request.
		// Prefer the in-flight dance's mode: phase 3 (the internal ctx.compact() after
		// the summary turn) carries no customInstructions/compactionMode, so `mode`
		// would resolve to the configured mode. Using the dance's own mode lets a dance
		// started via `/compact <dance-mode>` complete with the requested mode even
		// when the configured mode differs.
		const danceMode = danceState ? danceState.mode : isDanceMode(mode) ? mode : undefined;
		if (danceMode) {
			// Overflow cannot use the dance: cancelling breaks pi's compact-and-retry loop.
			if (event.reason === "overflow") {
				danceState = undefined;
				ctx.ui.notify(
					"Context overflow: compaction cancelled. Rewind the tree to before the overflow, compact there, then have the compacted session analyze the end of the old session.",
					"warning",
				);
				return { cancel: true };
			}

			// Phase 3: the model replied with the summary; use it as the compaction content.
			if (danceState?.status === "captured") {
				const captured = danceState;
				danceState = undefined;
				const options = DEFAULT_COMPACTION_OPTIONS;
				const retention = buildRetentionPlan(event.branchEntries, event.preparation, options.retention);
				const { readFiles, modifiedFiles } = computeCachedFileLists(event.preparation.fileOps);
				let summaryContent = `${captured.summary}${formatCachedFileOperations(readFiles, modifiedFiles)}`;
				if (danceMode.endsWith("-tooltraces")) {
					const pathDisplayPolicy = createPathDisplayPolicy();
					const toolTrace = buildNonAgenticCompaction({
						messages: retention.compactedMessages,
						options: options.nonAgentic,
						pathDisplayPolicy,
					});
					summaryContent += `\n\n${formatComponent("Programmatic", toolTrace)}`;
				}
				ctx.ui.notify(`Compaction complete (mode: ${danceMode}).`, "info");
				return {
					compaction: {
						summary: summaryContent,
						firstKeptEntryId: retention.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
						details: { mode: danceMode, readFiles, modifiedFiles },
					},
				};
			}

			// A summary turn is already in flight; do not request another one.
			if (danceState?.status === "pending") {
				return { cancel: true };
			}

			// Phase 1: request the summary as a plain user message, then cancel so the
			// turn can run; compaction completes via phase 3.
			const customInstructions = commandIntent.action === "compact" ? commandIntent.customInstructions : undefined;
			danceState = { status: "pending", mode: danceMode };
			ctx.ui.notify(`Compaction mode '${danceMode}': requesting summary in chat...`, "info");
			const injectedText = buildDanceMessage(danceMode, customInstructions);
			setTimeout(() => {
				if (danceState?.status !== "pending") return;
				void (async () => {
					try {
						await pi.sendUserMessage(injectedText);
					} catch {
						ctx.ui.notify("Could not request the compaction summary. No compaction performed.", "warning");
						danceState = undefined;
					}
				})();
			}, 0);
			return { cancel: true };
		}

		if (mode === "vanilla") return;

		const options = DEFAULT_COMPACTION_OPTIONS;
		const { tokensBefore } = event.preparation;

		const pathDisplayPolicy = createPathDisplayPolicy();
		const retention = buildRetentionPlan(event.branchEntries, event.preparation, options.retention);
		const retentionComponent = buildRetentionCompaction(retention);
		const nonAgentic = buildNonAgenticCompaction({
			messages: retention.compactedMessages,
			options: options.nonAgentic,
			pathDisplayPolicy,
		});
		const summary = formatHybridSummary([
			["Retention", retentionComponent],
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
					programmatic: nonAgentic.details,
					options,
				},
			},
		};
	});
}
