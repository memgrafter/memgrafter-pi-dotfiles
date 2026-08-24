/**
 * Pi Flexible Role Agent Extension
 *
 * Two independent, persistent switches:
 *
 *   frag — role mode. When enabled, the system prompt's pi role sentence is
 *          replaced by a stable "context builder" that frames the agent as
 *          role-flexible, and the active role is delivered as a post-history
 *          custom message: content carries a `[role: <id>]` header plus
 *          `System: <role content>`, and a registered TUI renderer displays a
 *          single `[role: <id>]` header line. Role changes never touch the
 *          system prompt, so they never bust the provider cache.
 *   trim — prompt trimming. When enabled, the "Guidelines:" and
 *          "Pi documentation" sections are stripped from the system prompt
 *          (the pi role sentence is kept — trim removes pi-specific prose, it
 *          does not rebrand). Generally intended for new sessions.
 *
 * The switches are decoupled: trim off + frag on frames the prompt for role
 * delivery without stripping the pi-specific sections. Both toggles change the
 * system prompt, so both warn with Continue | Fork | Cancel when toggled
 * mid-session. Tool definitions still reach the model via the provider payload.
 *
 * Usage:
 *   pi -e ./extensions/flexible-role-agent.ts
 *   --frag                 start with frag mode enabled (default role)
 *   --coding               start in the coding-agent role
 *   --pkm                  start in the pkm role
 *   --cbt                  start in the cbt role
 *   --dp                   start in the dp role
 *   --socratic-tutor       start in the socratic-tutor role
 *   /frag                  show current mode, role, and trim state
 *   /frag on | off         enable/disable frag mode (warns if the system prompt
 *                          will change: Continue | Fork | Cancel) and persists
 *                          to the optional "frag" key in settings.json
 *   /frag set <role>       switch role (requires frag mode enabled; errors if off)
 *   /frag trim on | off    enable/disable prompt trimming (strips the
 *                          "Guidelines" and "Pi documentation" sections;
 *                          generally intended for new sessions)
 *   /frag status           show current mode, role, and trim state
 *   /frag show             display the current system prompt (ephemeral, not stored in session)
 *
 * Both switches default off. Opt in via the optional "frag" settings key
 * (project .pi/settings.json → global ~/.pi/agent/settings.json):
 * "frag": { "enabled": true } and/or "frag": { "trim": true }. /frag on|off
 * and /frag trim on|off persist there. Session entries carry
 * { enabled, role, trim }; a missing trim field means not trimmed.
 *
 * Typing `/frag ` in the editor shows autocomplete options for roles and
 * subcommands, mirroring the compaction extension's `/compact` autocomplete.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";

// ============================================================================
// Roles (global TypeScript strings)
// ============================================================================

/** Default role: extracted from the original pi system prompt, rebranded. */
const CODING_AGENT_ROLE = `You are an expert coding assistant inside a coding harness. You help users by reading files, executing commands, editing code, and writing new files.`;

/** Analyst/researcher role for agentic computer use. Adjust as needed. */
const ANALYST_ROLE = `You are an expert analyst and researcher. You help users by investigating questions, gathering evidence, and reporting findings. You may use tools to read files, search code and data, and run commands to collect evidence. Be concise, cite what you find, and separate observation from interpretation.`;

/** Personal Knowledge Management role. */
const PKM_ROLE = `You are an expert personal knowledge manager.
Your goal is to help me organize my thoughts, ideas, and knowledge into a structured set of files.
You will be creating and editing markdown files.
When I share ideas with you, you should help me clarify them and then save them to the appropriate files.
You can ask me questions to better understand where to save the information or how to structure it.
Focus on creating a well-organized and easy-to-navigate knowledge base.
Do not write code unless I explicitly ask you to.`;

/** Cognitive Behavioral Therapy role. */
const CBT_ROLE = `You are an expert in Cognitive Behavioral Therapy (CBT).
Your goal is to help me with my mental well-being by using CBT techniques.
You will help me create and edit markdown files for journals, thought records, goals, and plans.
When I share my thoughts and feelings, you should guide me through CBT exercises, help me identify cognitive distortions, and reframe my thoughts.
You can ask me questions to help me reflect and gain insights.
Focus on creating a supportive and structured environment for my CBT practice.
Do not write code unless I explicitly ask you to.`;

/** Deliberate practice coach role. */
const DP_ROLE = `You are an expert deliberate practice coach.
Your goal is to help me improve skills through focused, high-quality deliberate practice.
You will help me define target skills, break them into sub-skills, and design short practice drills.
When I share goals or performance issues, you should identify bottlenecks, propose feedback loops, and calibrate challenge level.
You can ask me questions to clarify constraints, evaluate outcomes, and adapt the next practice block.
Focus on specificity, repetition with feedback, and measurable progress over time.
Do not write code unless I explicitly ask you to.`;

/** Socratic tutor role. */
const SOCRATIC_TUTOR_ROLE = `You are an expert Socratic tutor.
Your goal is to help me learn by guiding me through questions and reflection.
You will ask targeted, incremental questions that help me discover answers myself.
When I share confusion, you should identify assumptions, probe understanding, and adapt question difficulty.
You can offer brief hints, but prioritize question-led learning over direct answers unless I explicitly ask for one.
Focus on building understanding, reasoning, and metacognition through dialogue.
Do not write code unless I explicitly ask you to.`;

const DEFAULT_ROLE_ID = "coding-agent";

interface RoleDefinition {
	id: string;
	label: string;
	description: string;
	prompt: string;
}

const ROLES: RoleDefinition[] = [
	{
		id: "coding-agent",
		label: "coding-agent",
		description: "Default: expert coding assistant",
		prompt: CODING_AGENT_ROLE,
	},
	{
		id: "analyst",
		label: "analyst",
		description: "Analyst/researcher for agentic computer use",
		prompt: ANALYST_ROLE,
	},
	{
		id: "pkm",
		label: "pkm",
		description: "Personal Knowledge Management",
		prompt: PKM_ROLE,
	},
	{
		id: "cbt",
		label: "cbt",
		description: "Cognitive Behavioral Therapy coach",
		prompt: CBT_ROLE,
	},
	{
		id: "dp",
		label: "dp",
		description: "Deliberate practice coach",
		prompt: DP_ROLE,
	},
	{
		id: "socratic-tutor",
		label: "socratic-tutor",
		description: "Socratic tutor",
		prompt: SOCRATIC_TUTOR_ROLE,
	},
];

function getRole(id: string): RoleDefinition | undefined {
	const normalized = id.trim().toLowerCase();
	return ROLES.find((role) => role.id === normalized);
}

function roleLabel(id: string): string {
	return getRole(id)?.label ?? id;
}

/** Launch flags that start frag mode with a specific role. */
const ROLE_LAUNCH_FLAGS: { flag: string; roleId: string }[] = [
	{ flag: "coding", roleId: "coding-agent" },
	{ flag: "pkm", roleId: "pkm" },
	{ flag: "cbt", roleId: "cbt" },
	{ flag: "dp", roleId: "dp" },
	{ flag: "socratic-tutor", roleId: "socratic-tutor" },
];

/** First role launch flag that is set, if any. */
function resolveLaunchRole(pi: ExtensionAPI): string | undefined {
	for (const { flag, roleId } of ROLE_LAUNCH_FLAGS) {
		if (pi.getFlag(flag) === true) {
			return roleId;
		}
	}
	return undefined;
}

// ============================================================================
// Context builder (system prompt)
// ============================================================================

/** Flexible-role framing replaces the original pi role sentence. */
const CONTEXT_BUILDER_FRAMING = `You are a flexible-role agent. Your authoritative, active role is defined by the most recent role message in the conversation; adopt it fully and follow all of its instructions and restrictions. Until a role message arrives, act as a general-purpose assistant.`;

const PI_ROLE_SENTENCE = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.`;

const FRAG_MARKER = "flexible-role agent";
const ROLE_HEADER_PATTERN = /\[role: ([a-z0-9-]+)\]/;

function roleHeader(roleId: string): string {
	return `[role: ${roleId}]`;
}

/**
 * Remove a prompt section that starts at `header` and runs to the next blank
 * line. Returns the prompt unchanged when the header is not found. Sections are
 * delimited by blank lines in buildSystemPrompt's output, so the first "\n\n"
 * after the header is the section boundary.
 */
function stripPromptSection(prompt: string, header: string): string {
	const start = prompt.indexOf(header);
	if (start === -1) {
		return prompt;
	}
	const lineStart = prompt.lastIndexOf("\n", start) + 1;
	const end = prompt.indexOf("\n\n", start);
	if (end === -1) {
		return prompt.slice(0, lineStart);
	}
	return prompt.slice(0, lineStart) + prompt.slice(end + 2);
}

/**
 * Replace the pi role sentence with the context builder framing; if the current
 * prompt is not the pi default (custom --system-prompt), prepend the framing
 * and keep the custom content. The output is role-neutral and stable across
 * turns, so the cache is preserved once frag mode is active. Stripping the
 * "Guidelines" and "Pi documentation" sections is controlled separately by
 * trim mode (see buildTrimmedSystemPrompt).
 */
function buildFragSystemPrompt(current: string): string {
	if (current.includes(FRAG_MARKER)) {
		return current;
	}

	let prompt = current.startsWith(PI_ROLE_SENTENCE)
		? CONTEXT_BUILDER_FRAMING + current.slice(PI_ROLE_SENTENCE.length)
		: `${CONTEXT_BUILDER_FRAMING}\n\n${current}`;

	return prompt;
}

/**
 * Strip the "Guidelines" and "Pi documentation" sections from the system
 * prompt. Everything else — the pi role sentence and pi branding — is kept.
 * Idempotent: sections already absent (e.g. a custom --system-prompt) are left
 * alone, so this is safe to apply on every turn.
 */
function buildTrimmedSystemPrompt(current: string): string {
	let prompt = stripPromptSection(current, "Guidelines:");
	prompt = stripPromptSection(prompt, "Pi documentation");

	return prompt;
}

/**
 * Compose the system prompt this extension returns. The result is handed back
 * to pi as a wholesale replace (pi uses the returned systemPrompt verbatim),
 * so this is the single place that decides what the model sees. Frag frames the
 * prompt for role delivery; trim strips the pi-specific prose sections. Both
 * are no-ops when their switch is off, so with both off this returns pi's
 * prompt unchanged.
 */
function buildOurSystemPrompt(base: string): string {
	let prompt = base;
	if (state.enabled) {
		prompt = buildFragSystemPrompt(prompt);
	}
	if (state.trim) {
		prompt = buildTrimmedSystemPrompt(prompt);
	}
	return prompt;
}

// ============================================================================
// State
// ============================================================================

const FRAG_ENTRY_TYPE = "frag-mode";
const FRAG_ROLE_MESSAGE_TYPE = "frag-role";

interface FragState {
	enabled: boolean;
	role: string;
	trim: boolean;
	/** Applied on next session_start (used by the Fork flow). */
	pendingApply?: { enabled?: boolean; role?: string; trim?: boolean };
}

const state: FragState = {
	enabled: false,
	role: DEFAULT_ROLE_ID,
	trim: false,
};

/** In-memory tracker so the role message is injected only on role change. */
let lastInjectedRole: string | undefined;

// ============================================================================
// Settings persistence (optional "frag" key in settings.json)
// ============================================================================

const SETTINGS_SECTION = "frag";

function getProjectSettingsPath(cwd: string): string {
	return join(cwd, ".pi", "settings.json");
}

function getGlobalSettingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}
	const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: undefined;
}

function readFragSettings(filePath: string): { enabled?: boolean; trim?: boolean } | undefined {
	const settings = readJsonObject(filePath);
	const section = settings?.[SETTINGS_SECTION];
	if (!section || typeof section !== "object" || Array.isArray(section)) {
		return undefined;
	}
	const enabled = (section as { enabled?: unknown }).enabled;
	const trim = (section as { trim?: unknown }).trim;
	return {
		enabled: typeof enabled === "boolean" ? enabled : undefined,
		trim: typeof trim === "boolean" ? trim : undefined,
	};
}

/** Default when the "enabled" setting is absent: off (frag is opt-in via settings). */
const DEFAULT_SETTINGS_ENABLED = false;

/** Default when the "trim" setting is absent: off. */
const DEFAULT_SETTINGS_TRIM = false;

function resolveConfiguredFrag(cwd: string): { enabled: boolean; trim: boolean } {
	const project = readFragSettings(getProjectSettingsPath(cwd));
	const globalSettings = readFragSettings(getGlobalSettingsPath());
	return {
		enabled: project?.enabled ?? globalSettings?.enabled ?? DEFAULT_SETTINGS_ENABLED,
		trim: project?.trim ?? globalSettings?.trim ?? DEFAULT_SETTINGS_TRIM,
	};
}

function getSettingsPathToUpdate(cwd: string): string {
	const projectSettings = readJsonObject(getProjectSettingsPath(cwd));
	return projectSettings?.[SETTINGS_SECTION] !== undefined
		? getProjectSettingsPath(cwd)
		: getGlobalSettingsPath();
}

function writeConfiguredFrag(cwd: string, patch: { enabled?: boolean; trim?: boolean }): void {
	const settingsPath = getSettingsPathToUpdate(cwd);
	const settings = readJsonObject(settingsPath) ?? {};
	const section = settings[SETTINGS_SECTION];
	const nextSection =
		section && typeof section === "object" && !Array.isArray(section)
			? section
			: {};

	settings[SETTINGS_SECTION] = { ...nextSection, ...patch };

	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

function parseFragEntry(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): { enabled: boolean; role?: string; trim?: boolean } | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== FRAG_ENTRY_TYPE) {
			continue;
		}

		const data = entry.data;
		if (!data || typeof data !== "object") {
			return undefined;
		}
		const enabled = (data as { enabled?: unknown }).enabled;
		const role = (data as { role?: unknown }).role;
		const trim = (data as { trim?: unknown }).trim;
		if (typeof enabled === "boolean") {
			return {
				enabled,
				role: typeof role === "string" ? role : undefined,
				trim: typeof trim === "boolean" ? trim : undefined,
			};
		}
		return undefined;
	}

	return undefined;
}

/**
 * Find the most recently injected frag role message in session history so we do
 * not re-inject the same role after a restart or fork. Parses the
 * `[role: <id>]` header; falls back to the legacy `System:\n<role.prompt>`
 * body match for sessions created before the header format.
 */
function scanLastInjectedRole(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; content?: unknown };
		if (entry.type !== "custom_message" || entry.customType !== FRAG_ROLE_MESSAGE_TYPE) {
			continue;
		}

		const content = entry.content;
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text?: unknown }).text ?? "") : ""))
							.join("")
					: "";
		const headerMatch = text.match(ROLE_HEADER_PATTERN);
		if (headerMatch && getRole(headerMatch[1]!)) {
			return headerMatch[1]!;
		}
		for (const role of ROLES) {
			if (text.includes(`System:\n${role.prompt}`)) {
				return role.id;
			}
		}
	}

	return undefined;
}

function updateStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) {
		return;
	}
	const statusText = `frag: ${state.enabled ? state.role : "off"}, trim: ${state.trim ? "on" : "off"}`;
	ctx.ui.setStatus("frag", state.enabled ? ctx.ui.theme.fg("accent", statusText) : statusText);
}

// ============================================================================
// Autocomplete (mirrors the compaction extension's /compact pattern)
// ============================================================================

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

function getFragArgumentCompletions(prefix: string): AutocompleteItemLike[] | null {
	const roleItems: AutocompleteItemLike[] = ROLES.flatMap((role) => [
		{ value: role.id, label: role.id, description: role.description },
		{ value: `set ${role.id}`, label: `set ${role.id}`, description: `Switch role to ${role.label}` },
	]);
	const items: AutocompleteItemLike[] = [
		...roleItems,
		{ value: "on", label: "on", description: "Enable frag mode" },
		{ value: "off", label: "off", description: "Disable frag mode" },
		{ value: "trim", label: "trim", description: "Show trim state" },
		{ value: "trim on", label: "trim on", description: "Enable prompt trimming (new sessions)" },
		{ value: "trim off", label: "trim off", description: "Disable prompt trimming" },
		{ value: "status", label: "status", description: "Show current mode, role, and trim state" },
		{ value: "show", label: "show", description: "Display the current system prompt (ephemeral, not stored)" },
		{ value: "help", label: "help", description: "Show usage" },
	];
	const normalizedPrefix = prefix.trim().toLowerCase();
	if (!normalizedPrefix) {
		return items;
	}
	const filtered = items.filter((item) => `${item.value} ${item.description ?? ""}`.toLowerCase().includes(normalizedPrefix));
	return filtered.length > 0 ? filtered : null;
}

function buildFragUsageLine(): string {
	return `flexible role agent mode (current: frag: ${state.enabled ? roleLabel(state.role) : "off"}, trim: ${state.trim ? "on" : "off"}) — /frag on|off|status|show, /frag trim on|off (new sessions), /frag set ${ROLES.map((r) => r.id).join("|")}`;
}

function replaceFragCommandDescription(
	suggestions: { items: AutocompleteItemLike[]; prefix: string } | null,
): { items: AutocompleteItemLike[]; prefix: string } | null {
	if (!suggestions) {
		return null;
	}
	const description = buildFragUsageLine();
	return {
		...suggestions,
		items: suggestions.items.map((item) =>
			item.value === "frag" || item.label === "frag" ? { ...item, description } : item,
		),
	};
}

function createFragAutocompleteProvider(current: AutocompleteProviderLike): AutocompleteProviderLike {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const currentLine = lines[cursorLine] ?? "";
			const textBeforeCursor = currentLine.slice(0, cursorCol);
			if (textBeforeCursor.startsWith("/frag ")) {
				const prefix = textBeforeCursor.slice("/frag ".length);
				const items = getFragArgumentCompletions(prefix);
				if (items) {
					return { items, prefix };
				}
			}

			const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			const isSlashCommandNameCompletion = textBeforeCursor.startsWith("/") && !textBeforeCursor.includes(" ");
			return isSlashCommandNameCompletion ? replaceFragCommandDescription(suggestions) : suggestions;
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
		},
	};
}

// ============================================================================
// Warning dialog (cache-bust confirmation)
// ============================================================================

type WarningChoice = "continue" | "fork" | "cancel";

async function confirmSystemPromptChange(ctx: ExtensionContext, from: string, to: string): Promise<WarningChoice> {
	if (!ctx.hasUI) {
		return "continue";
	}
	const choice = await ctx.ui.select(
		`Warning: mode change ${from} -> ${to} will bust any existing cache on next prompt submission.`,
		["Continue", "Fork", "Cancel"],
	);
	if (choice === "Fork") {
		return "fork";
	}
	// undefined (Esc / ctrl+c) and "Cancel" both abort — never default to Continue.
	if (choice !== "Continue") {
		return "cancel";
	}
	return "continue";
}

// ============================================================================
// Extension
// ============================================================================

export default function piFlexibleRoleAgentExtension(pi: ExtensionAPI): void {
	// Replace the default custom-message rendering (which shows a generic
	// `[frag-role]` label above the content, duplicating the header) with the
	// same box and colors, using a single `[role: <id>]` header line.
	pi.registerMessageRenderer(FRAG_ROLE_MESSAGE_TYPE, (message, options, theme) => {
		const details = message.details as { role?: unknown } | undefined;
		const content = typeof message.content === "string" ? message.content : "";
		const headerMatch = content.match(/^\[role: ([a-z0-9-]+)\]\n\n/);
		const roleId =
			(typeof details?.role === "string" ? details.role : undefined) ??
			headerMatch?.[1] ??
			ROLES.find((role) => content.includes(`System:\n${role.prompt}`))?.id;
		const body = headerMatch ? content.slice(headerMatch[0].length) : content;
		const header = roleId ? roleHeader(roleId) : `[${FRAG_ROLE_MESSAGE_TYPE}]`;

		// Replicate the default custom-message styling: purple background box,
		// bold label color, markdown body in customMessageText.
		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(theme.fg("customMessageLabel", `\x1b[1m${header}\x1b[22m`), 0, 0));
		box.addChild(new Spacer(1));
		box.addChild(new Markdown(body, 0, 0, getMarkdownTheme(), {
			color: (text) => theme.fg("customMessageText", text),
		}));
		return box;
	});

	pi.registerFlag("frag", {
		description: "Start in flexible role agent mode",
		type: "boolean",
		default: false,
	});

	for (const { flag, roleId } of ROLE_LAUNCH_FLAGS) {
		const role = getRole(roleId);
		pi.registerFlag(flag, {
			description: `Start in flexible role agent mode with the ${role?.label ?? roleId} role`,
			type: "boolean",
			default: false,
		});
	}

	const persistState = (): void => {
		pi.appendEntry(FRAG_ENTRY_TYPE, { enabled: state.enabled, role: state.role, trim: state.trim });
	};

	pi.registerCommand("frag", {
		description: "Flexible role agent mode (use: /frag, /frag on|off|status|show, /frag set <role>)",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const lower = trimmed.toLowerCase();

			if (trimmed === "" || lower === "status") {
				if (ctx.hasUI) {
					ctx.ui.notify(
						state.enabled
							? `frag mode enabled. Role: ${roleLabel(state.role)}. trim: ${state.trim ? "on" : "off"}`
							: `frag mode disabled. trim: ${state.trim ? "on" : "off"}`,
						"info",
					);
				}
				updateStatus(ctx);
				return;
			}

			if (lower === "show") {
				if (ctx.hasUI) {
					const current = ctx.getSystemPrompt();
					let prompt = current;
					if (state.enabled) {
						prompt = buildFragSystemPrompt(prompt);
					}
					if (state.trim) {
						prompt = buildTrimmedSystemPrompt(prompt);
					}
					ctx.ui.notify(prompt, "info");
				}
				return;
			}

			if (lower === "help") {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`${buildFragUsageLine()}\nRole updates are delivered as a post-history message and never touch the system prompt.\n/frag trim on|off strips the Guidelines and Pi documentation sections from the system prompt; it is generally intended for new sessions.`,
						"info",
					);
				}
				return;
			}

			if (lower === "on" || lower === "enable" || lower === "enabled") {
				await setEnabled(ctx, true);
				return;
			}

			if (lower === "off" || lower === "disable" || lower === "disabled") {
				await setEnabled(ctx, false);
				return;
			}

			if (lower === "trim") {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`trim mode ${state.trim ? "enabled" : "disabled"} — system prompt is ${state.trim ? "trimmed" : "not trimmed"}.`,
						"info",
					);
				}
				return;
			}

			if (lower === "trim on" || lower === "trim enable" || lower === "trim enabled") {
				await setTrim(ctx, true);
				return;
			}

			if (lower === "trim off" || lower === "trim disable" || lower === "trim disabled") {
				await setTrim(ctx, false);
				return;
			}

			if (lower === "set") {
				// No role given: show a picker with current + available roles.
				if (!ctx.hasUI) {
					ctx.ui.notify(`Usage: /frag set <role>. Available: ${ROLES.map((r) => r.id).join(", ")}`, "info");
					return;
				}
				const picked = await ctx.ui.select("Select role", ROLES.map((role) => `${role.label} — ${role.description}`));
				if (!picked) {
					return;
				}
				const roleId = picked.split(" — ")[0]!.trim();
				await applyRole(ctx, roleId);
				return;
			}

			if (lower.startsWith("set ")) {
				await applyRole(ctx, lower.slice(4).trim());
				return;
			}

			if (ctx.hasUI) {
				ctx.ui.notify(`Unknown: /frag ${trimmed}. ${buildFragUsageLine()}`, "warning");
			}
		},
	});

	/**
	 * Apply a role. Requires frag mode to be on: enabling frag changes the system
	 * prompt and may bust a warm cache, so we do not do it implicitly here — the
	 * user must enable frag explicitly via /frag on (which warns).
	 */
	async function applyRole(ctx: ExtensionCommandContext, roleId: string): Promise<void> {
		const role = getRole(roleId);
		if (!role) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Unknown role '${roleId}'. Available: ${ROLES.map((r) => r.id).join(", ")}`, "warning");
			}
			return;
		}

		if (!state.enabled) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`frag mode is off — role not applied. Enable it with /frag on first (changes the system prompt; may bust a warm cache).`,
					"warning",
				);
			}
			return;
		}

		state.role = role.id;
		persistState();
		updateStatus(ctx);
		if (ctx.hasUI) {
			ctx.ui.notify(`Role set to ${role.label} — applied on next prompt submission.`, "info");
		}
	}

	async function setEnabled(ctx: ExtensionCommandContext, target: boolean): Promise<void> {
		if (state.enabled === target) {
			if (ctx.hasUI) {
				ctx.ui.notify(`frag mode already ${target ? "enabled" : "disabled"}.`, "info");
			}
			return;
		}

		// Content-based cache-bust detection. The session file does not store the
		// system prompt, but ctx.getSystemPrompt() returns the effective prompt of
		// the last request; after any frag turn it contains the context-builder
		// marker. Warn iff this toggle actually changes the system prompt.
		const currentlyFrag = ctx.getSystemPrompt().includes(FRAG_MARKER);
		if (currentlyFrag !== target) {
			const from = currentlyFrag ? "frag" : "default";
			const to = target ? "frag" : "default";
			const choice = await confirmSystemPromptChange(ctx, from, to);
			if (choice === "cancel") {
				return;
			}
			if (choice === "fork") {
				// Fork the session so the old conversation keeps its warm cache.
				// session_start("fork") applies pendingApply and persists to the fork.
				const leaf = ctx.sessionManager.getLeafEntry();
				if (!leaf) {
					if (ctx.hasUI) {
						ctx.ui.notify("Cannot fork: no session entry to fork from.", "warning");
					}
					return;
				}
				state.enabled = target;
				state.pendingApply = { enabled: target, role: state.role };
				// The toggle is the user's intent — persist it for new sessions too.
				writeConfiguredFrag(ctx.cwd, { enabled: target });
				await ctx.fork(leaf.id, { position: "at" });
				return;
			}
		}

		state.enabled = target;
		state.pendingApply = undefined;
		persistState();
		writeConfiguredFrag(ctx.cwd, { enabled: target });
		updateStatus(ctx);
		if (ctx.hasUI) {
			ctx.ui.notify(
				target ? `frag mode enabled. Role: ${roleLabel(state.role)}` : "frag mode disabled",
				"info",
			);
		}
	}

	/**
	 * Toggle prompt trimming. Changing trim changes the system prompt, so it may
	 * bust a warm cache — warn (Continue | Fork | Cancel), mirroring the warning
	 * /frag on|off has. Generally intended for new sessions.
	 */
	async function setTrim(ctx: ExtensionCommandContext, target: boolean): Promise<void> {
		if (state.trim === target) {
			if (ctx.hasUI) {
				ctx.ui.notify(`trim mode already ${target ? "enabled" : "disabled"}.`, "info");
			}
			return;
		}

		// Content-based cache-bust detection. The session file does not store the
		// system prompt, but ctx.getSystemPrompt() returns the effective prompt of
		// the last request; a trimmed prompt lacks the "Guidelines:" section.
		// Warn iff this toggle actually changes the system prompt.
		const currentlyTrimmed = !ctx.getSystemPrompt().includes("Guidelines:");
		if (currentlyTrimmed !== target) {
			const from = currentlyTrimmed ? "trimmed" : "untrimmed";
			const to = target ? "trimmed" : "untrimmed";
			const choice = await confirmSystemPromptChange(ctx, from, to);
			if (choice === "cancel") {
				return;
			}
			if (choice === "fork") {
				// Fork the session so the old conversation keeps its warm cache.
				// session_start("fork") applies pendingApply and persists to the fork.
				const leaf = ctx.sessionManager.getLeafEntry();
				if (!leaf) {
					if (ctx.hasUI) {
						ctx.ui.notify("Cannot fork: no session entry to fork from.", "warning");
					}
					return;
				}
				state.trim = target;
				state.pendingApply = { trim: target };
				// The toggle is the user's intent — persist it for new sessions too.
				writeConfiguredFrag(ctx.cwd, { trim: target });
				await ctx.fork(leaf.id, { position: "at" });
				return;
			}
		}

		state.trim = target;
		state.pendingApply = undefined;
		persistState();
		writeConfiguredFrag(ctx.cwd, { trim: target });
		updateStatus(ctx);
		if (ctx.hasUI) {
			ctx.ui.notify(
				target
					? "trim mode enabled — the Guidelines and Pi documentation sections will be stripped from the system prompt. Note: generally intended for new sessions."
					: "trim mode disabled",
				"info",
			);
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		// Fork flow: apply the pending change to the forked session.
		if (state.pendingApply) {
			if (state.pendingApply.enabled !== undefined) {
				state.enabled = state.pendingApply.enabled;
			}
			if (state.pendingApply.role !== undefined) {
				state.role = state.pendingApply.role;
			}
			if (state.pendingApply.trim !== undefined) {
				state.trim = state.pendingApply.trim;
			}
			state.pendingApply = undefined;
			persistState();
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Forked session — frag: ${state.enabled ? `enabled, role ${roleLabel(state.role)}` : "disabled"}, trim: ${state.trim ? "on" : "off"}`,
					"info",
				);
			}
			lastInjectedRole = scanLastInjectedRole(ctx.sessionManager.getEntries());
			updateStatus(ctx);
			return;
		}

		// Startup flag / persisted state restore.
		const launchRole = resolveLaunchRole(pi);
		const persisted = parseFragEntry(ctx.sessionManager.getEntries());
		if (persisted !== undefined) {
			state.enabled = persisted.enabled;
			if (persisted.role && getRole(persisted.role)) {
				state.role = persisted.role;
			}
			if (persisted.trim !== undefined) {
				// Absent trim in the entry means not trimmed (session default off).
				state.trim = persisted.trim;
			}
		} else if (pi.getFlag("frag") === true || launchRole !== undefined) {
			state.enabled = true;
			state.role = launchRole ?? DEFAULT_ROLE_ID;
			// trim still comes from settings when starting via the flag.
			state.trim = resolveConfiguredFrag(ctx.cwd).trim;
			// Persist so a resumed session restores frag mode without the flag.
			persistState();
		} else {
			// New session: both switches default off; opt in via the optional
			// "frag" settings key (project .pi/settings.json →
			// global ~/.pi/agent/settings.json).
			const configured = resolveConfiguredFrag(ctx.cwd);
			state.enabled = configured.enabled;
			state.trim = configured.trim;
			state.role = DEFAULT_ROLE_ID;
		}

		lastInjectedRole = scanLastInjectedRole(ctx.sessionManager.getEntries());
		updateStatus(ctx);

		// Autocomplete for /frag, mirroring the compaction extension.
		ctx.ui.addAutocompleteProvider((current) =>
			createFragAutocompleteProvider(current as AutocompleteProviderLike) as typeof current,
		);
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.enabled && !state.trim) {
			return undefined;
		}

		// Build our system prompt and return it as a wholesale replace. pi uses the
		// returned systemPrompt verbatim (agent-session sets agent.state.systemPrompt
		// to it), so this never mutates pi's prompt in place. Trim and frag are
		// decoupled: frag frames the prompt for role delivery, trim strips the
		// pi-specific prose sections.
		const systemPrompt = buildOurSystemPrompt(event.systemPrompt);

		if (!state.enabled) {
			return { systemPrompt };
		}

		// Inject the role as a post-history message, but only on role change. The
		// `[role: <id>]` header names the active role for the LLM; the TUI
		// renderer shows that same header as a single line (no duplication).
		if (state.role !== lastInjectedRole) {
			const role = getRole(state.role);
			if (role) {
				lastInjectedRole = state.role;
				return {
					systemPrompt,
					message: {
						customType: FRAG_ROLE_MESSAGE_TYPE,
						content: `${roleHeader(role.id)}\n\nSystem:\n${role.prompt}`,
						details: { role: role.id },
						display: true,
					},
				};
			}
		}

		return { systemPrompt };
	});
}
