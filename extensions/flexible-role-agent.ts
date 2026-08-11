/**
 * Pi Flexible Role Agent Extension
 *
 * Replaces the system prompt with a stable "context builder" that frames the
 * agent as role-flexible, and delivers the active role as a post-history custom
 * message (`System: <role content>`). Role changes never touch the system
 * prompt, so they never bust the provider cache.
 *
 * Roles are defined as plain TypeScript strings at the top of this file.
 * The system prompt is composed of:
 *   - the context builder (the original pi prompt with the coding-agent role
 *     sentence replaced by flexible-role framing; pi branding is kept for now),
 *     which is fully role-neutral.
 *   - the "Guidelines" and "Pi documentation" sections are stripped: they are
 *     pi-specific prose the model does not need once frag framing is active.
 *     Tool definitions still reach the model via the provider payload.
 * The active role — including the initial one — is always delivered as a
 * post-history message (`System: <role content>`), so every role injection
 * looks the same and the system prompt never changes.
 *
 * Usage:
 *   pi -e ./extensions/flexible-role-agent.ts
 *   --frag                 start with frag mode enabled (default role)
 *   /frag                  show current mode and role
 *   /frag on | off         enable/disable frag mode (warns if the system prompt
 *                          will change: Continue | Fork | Cancel)
 *   /frag set <role>       switch role (requires frag mode enabled; errors if off)
 *   /frag status           show current mode and role
 *   /frag show             display the current system prompt (ephemeral, not stored in session)
 *
 * Typing `/frag ` in the editor shows autocomplete options for roles and
 * subcommands, mirroring the compaction extension's `/compact` autocomplete.
 */

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
];

function getRole(id: string): RoleDefinition | undefined {
	const normalized = id.trim().toLowerCase();
	return ROLES.find((role) => role.id === normalized);
}

function roleLabel(id: string): string {
	return getRole(id)?.label ?? id;
}

// ============================================================================
// Context builder (system prompt)
// ============================================================================

/** Flexible-role framing replaces the original pi role sentence. */
const CONTEXT_BUILDER_FRAMING = `You are an expert flexible-role agent inside a coding harness. Your active role is delivered as a message at the end of the conversation; the most recent role message is authoritative. Until a role message arrives, act as a general-purpose assistant. You help users by reading files, executing commands, editing code, and writing new files.`;

/** The exact first sentence of pi's default system prompt (strip target). */
const PI_ROLE_SENTENCE = `You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.`;

const FRAG_MARKER = "flexible-role agent";

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
 * Strip-with-fallback: replace the pi role sentence with the context builder
 * framing; if the current prompt is not the pi default (custom --system-prompt),
 * prepend the framing and keep the custom content. Also remove the
 * "Guidelines" and "Pi documentation" sections (pi-specific prose). The output
 * is fully role-neutral and stable across turns, so the cache is preserved once
 * frag mode is active.
 */
function buildFragSystemPrompt(current: string): string {
	if (current.includes(FRAG_MARKER)) {
		return current;
	}

	let prompt = current.startsWith(PI_ROLE_SENTENCE)
		? CONTEXT_BUILDER_FRAMING + current.slice(PI_ROLE_SENTENCE.length)
		: `${CONTEXT_BUILDER_FRAMING}\n\n${current}`;

	prompt = stripPromptSection(prompt, "Guidelines:");
	prompt = stripPromptSection(prompt, "Pi documentation");

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
	/** Applied on next session_start (used by the Fork flow). */
	pendingApply?: { enabled: boolean; role: string };
}

const state: FragState = {
	enabled: false,
	role: DEFAULT_ROLE_ID,
};

/** In-memory tracker so the role message is injected only on role change. */
let lastInjectedRole: string | undefined;

function parseFragEntry(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): { enabled: boolean; role?: string } | undefined {
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
		if (typeof enabled === "boolean") {
			return { enabled, role: typeof role === "string" ? role : undefined };
		}
		return undefined;
	}

	return undefined;
}

/**
 * Find the most recently injected frag role message in session history so we do
 * not re-inject the same role after a restart or fork.
 */
function scanLastInjectedRole(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; message?: { role?: string; customType?: string; content?: unknown } };
		if (entry.type !== "message" || entry.message?.role !== "custom" || entry.message.customType !== FRAG_ROLE_MESSAGE_TYPE) {
			continue;
		}

		const content = entry.message.content;
		if (!Array.isArray(content)) {
			continue;
		}
		const text = content
			.map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text?: unknown }).text ?? "") : ""))
			.join("");
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
	ctx.ui.setStatus("frag", state.enabled ? ctx.ui.theme.fg("accent", `frag: ${state.role}`) : undefined);
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
	const items: AutocompleteItemLike[] = [
		{ value: "coding-agent", label: "coding-agent", description: "Default: expert coding assistant" },
		{ value: "analyst", label: "analyst", description: "Analyst/researcher for agentic computer use" },
		{ value: "set coding-agent", label: "set coding-agent", description: "Switch role to coding-agent" },
		{ value: "set analyst", label: "set analyst", description: "Switch role to analyst" },
		{ value: "on", label: "on", description: "Enable frag mode" },
		{ value: "off", label: "off", description: "Disable frag mode" },
		{ value: "status", label: "status", description: "Show current mode and role" },
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
	return `flexible role agent mode (current: ${state.enabled ? `frag: ${roleLabel(state.role)}` : "off"}) — /frag on|off|status|show, /frag set ${ROLES.map((r) => r.id).join("|")}`;
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
	pi.registerFlag("frag", {
		description: "Start in flexible role agent mode",
		type: "boolean",
		default: false,
	});

	const persistState = (): void => {
		pi.appendEntry(FRAG_ENTRY_TYPE, { enabled: state.enabled, role: state.role });
	};

	pi.registerCommand("frag", {
		description: "Flexible role agent mode (use: /frag, /frag on|off|status|show, /frag set <role>)",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const lower = trimmed.toLowerCase();

			if (trimmed === "" || lower === "status") {
				if (ctx.hasUI) {
					ctx.ui.notify(
						state.enabled ? `frag mode enabled. Role: ${roleLabel(state.role)}` : "frag mode disabled",
						"info",
					);
				}
				updateStatus(ctx);
				return;
			}

			if (lower === "show") {
				if (ctx.hasUI) {
					const current = ctx.getSystemPrompt();
					const prompt = state.enabled ? buildFragSystemPrompt(current) : current;
					ctx.ui.notify(prompt, "info");
				}
				return;
			}

			if (lower === "help") {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`${buildFragUsageLine()}\nRole updates are delivered as a post-history message and never touch the system prompt.`,
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
				await ctx.fork(leaf.id, { position: "at" });
				return;
			}
		}

		state.enabled = target;
		state.pendingApply = undefined;
		persistState();
		updateStatus(ctx);
		if (ctx.hasUI) {
			ctx.ui.notify(
				target ? `frag mode enabled. Role: ${roleLabel(state.role)}` : "frag mode disabled",
				"info",
			);
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		// Fork flow: apply the pending change to the forked session.
		if (state.pendingApply) {
			state.enabled = state.pendingApply.enabled;
			state.role = state.pendingApply.role;
			state.pendingApply = undefined;
			persistState();
			if (ctx.hasUI) {
				ctx.ui.notify(
					state.enabled ? `Forked session — frag mode enabled. Role: ${roleLabel(state.role)}` : "Forked session — frag mode disabled.",
					"info",
				);
			}
			lastInjectedRole = scanLastInjectedRole(ctx.sessionManager.getEntries());
			updateStatus(ctx);
			return;
		}

		// Startup flag / persisted state restore.
		const persisted = parseFragEntry(ctx.sessionManager.getEntries());
		if (persisted !== undefined) {
			state.enabled = persisted.enabled;
			if (persisted.role && getRole(persisted.role)) {
				state.role = persisted.role;
			}
		} else if (pi.getFlag("frag") === true) {
			state.enabled = true;
			state.role = DEFAULT_ROLE_ID;
			// Persist so a resumed session restores frag mode without the flag.
			persistState();
		}

		lastInjectedRole = scanLastInjectedRole(ctx.sessionManager.getEntries());
		updateStatus(ctx);

		// Autocomplete for /frag, mirroring the compaction extension.
		ctx.ui.addAutocompleteProvider((current) =>
			createFragAutocompleteProvider(current as AutocompleteProviderLike) as typeof current,
		);
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.enabled) {
			return undefined;
		}

		const systemPrompt = buildFragSystemPrompt(event.systemPrompt);

		// Inject the role as a post-history message, but only on role change.
		if (state.role !== lastInjectedRole) {
			const role = getRole(state.role);
			if (role) {
				lastInjectedRole = state.role;
				return {
					systemPrompt,
					message: {
						customType: FRAG_ROLE_MESSAGE_TYPE,
						content: `System:\n${role.prompt}`,
						display: true,
					},
				};
			}
		}

		return { systemPrompt };
	});
}
