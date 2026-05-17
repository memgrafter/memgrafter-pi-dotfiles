/**
 * Pi Dynamic Tools
 *
 * Load tool definitions into conversation context on demand.
 * Two flavors:
 *
 *   - Skill-based: name resolves to a discovered SKILL.md
 *   - Description-based: user provides name + inline description
 *
 * Both can be pre-configured in settings.json or loaded at runtime
 * via slash commands. Definitions are injected as conversation messages,
 * never touching the system prompt or prefix cache.
 *
 * Settings in ~/.pi/agent/settings.json or .pi/settings.json:
 *
 *   "dynamicTools": {
 *     "skill-tools": ["quick-report", "shell-analyzer"],
 *     "tools": {
 *       "deploy": "Deploy the application to the specified environment",
 *       "sequential_thinking": "Think step by step through complex problems"
 *     }
 *   }
 *
 * Slash commands:
 *
 *   /dynamic-tool-load <name>                Load a skill as a dynamic tool
 *   /dynamic-tool-load <name> <description>  Load a description-based tool
 *   /dynamic-tool-unload <name>              Unload a dynamic tool
 *   /dynamic-tool-list                       List loaded dynamic tools
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface DynamicToolsConfig {
	skillTools: string[];
	tools: Record<string, string>;
}

function loadSettings(): DynamicToolsConfig {
	const paths = [
		join(homedir(), ".pi", "agent", "settings.json"),
		join(process.cwd(), ".pi", "settings.json"),
	];

	const config: DynamicToolsConfig = { skillTools: [], tools: {} };

	for (const path of paths) {
		try {
			if (!existsSync(path)) continue;
			const raw = JSON.parse(readFileSync(path, "utf-8"));
			const dt = raw?.dynamicTools;
			if (!dt) continue;

			const skillTools = dt["skill-tools"];
			if (Array.isArray(skillTools)) {
				for (const s of skillTools) {
					if (typeof s === "string" && s.length > 0 && !config.skillTools.includes(s)) {
						config.skillTools.push(s);
					}
				}
			}

			if (dt.tools && typeof dt.tools === "object" && !Array.isArray(dt.tools)) {
				for (const [name, desc] of Object.entries(dt.tools)) {
					if (typeof desc === "string" && desc.length > 0 && !(name in config.tools)) {
						config.tools[name] = desc;
					}
				}
			}
		} catch {}
	}

	return config;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Allowed tool name characters: letters, digits, underscore, hyphen, period. */
const TOOL_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function validateToolName(name: string): string | undefined {
	if (name.length === 0) return "Tool name cannot be empty.";
	if (!TOOL_NAME_RE.test(name)) {
		const bad = Array.from(new Set(name.split("").filter((ch) => !TOOL_NAME_RE.test(ch))));
		return `Tool name contains invalid characters: ${bad.map((c) => JSON.stringify(c)).join(", ")}. Allowed: a-z A-Z 0-9 . _ -`;
	}
	return undefined;
}

/**
 * Control characters that break JSON serialization or are meaningless in text.
 * Preserves \t (0x09), \n (0x0A), \r (0x0D).
 */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeDescription(text: string): { clean: string; stripped: string[] } {
	const found = new Set<string>();
	const clean = text.replace(CONTROL_CHAR_RE, (ch) => {
		const hex = `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`;
		found.add(hex);
		return "";
	});
	return { clean, stripped: Array.from(found) };
}

const SEQUENTIAL_THINKING_NAME = "sequential_thinking";

const DEFAULT_DYNAMIC_TOOL_PARAMETERS: Record<string, unknown> = {
	type: "object",
	properties: {},
	required: [],
	additionalProperties: true,
};

const SEQUENTIAL_THINKING_PARAMETERS: Record<string, unknown> = {
	type: "object",
	properties: {
		thought: { type: "string" },
		thoughtNumber: { type: "integer" },
		totalThoughts: { type: "integer" },
		nextThoughtNeeded: { type: "boolean" },
	},
	required: ["thought", "thoughtNumber", "totalThoughts", "nextThoughtNeeded"],
	additionalProperties: true,
};

/**
 * Inject loaded dynamic tools as request-only tools for OpenAI Codex OAuth
 * payloads. This does not touch pi's tool registry or active tool set.
 */
function patchCodexOAuthPayloadWithDynamicTools(
	payload: unknown,
	state: DynamicToolState,
): Record<string, unknown> | undefined {
	if (state.loaded.size === 0) return undefined;
	if (!payload || typeof payload !== "object") return undefined;

	const obj = payload as Record<string, unknown>;
	const tools = Array.isArray(obj.tools) ? obj.tools : [];
	let changed = !Array.isArray(obj.tools);
	const seen = new Set<string>();

	const patchedTools = tools.map((tool) => {
		if (!tool || typeof tool !== "object") return tool;
		const t = tool as Record<string, unknown>;
		const toolName = typeof t.name === "string" ? t.name : undefined;
		if (t.type === "function" && toolName && state.loaded.has(toolName)) {
			seen.add(toolName);
			if (t.strict === false) return tool;
			changed = true;
			return { ...t, strict: false };
		}
		return tool;
	});

	for (const [name, definition] of state.loaded.entries()) {
		if (seen.has(name)) continue;
		const parameters =
			name === SEQUENTIAL_THINKING_NAME
				? SEQUENTIAL_THINKING_PARAMETERS
				: DEFAULT_DYNAMIC_TOOL_PARAMETERS;
		patchedTools.push({
			type: "function",
			name,
			description: definition,
			parameters,
			strict: false,
		});
		changed = true;
	}

	if (!changed) return undefined;
	return { ...obj, tools: patchedTools };
}

// ---------------------------------------------------------------------------
// Dynamic tools — core logic (wrappable as LLM-callable tools)
// ---------------------------------------------------------------------------

interface DynamicToolState {
	/** name → full definition content */
	loaded: Map<string, string>;
	/** reference to pi for skill resolution */
	pi: ExtensionAPI;
}

interface DynamicToolResult {
	ok: boolean;
	message: string;
	/** Set when control characters were stripped from the description. */
	strippedChars?: string[];
}

/**
 * Resolve a skill name to its SKILL.md path using pi's discovered commands.
 */
function resolveSkillPath(pi: ExtensionAPI, name: string): string | undefined {
	const commands = pi.getCommands();
	const skillCmd = commands.find(
		(cmd) => cmd.source === "skill" && cmd.name === `skill:${name}`,
	);
	if (!skillCmd) return undefined;

	// sourceInfo.path points to the SKILL.md file
	const skillMdPath = skillCmd.sourceInfo.path;
	if (existsSync(skillMdPath)) return skillMdPath;

	// Fallback: sourceInfo.baseDir + SKILL.md
	if (skillCmd.sourceInfo.baseDir) {
		const fallback = join(skillCmd.sourceInfo.baseDir, "SKILL.md");
		if (existsSync(fallback)) return fallback;
	}

	return undefined;
}

/**
 * List available skill names from pi's discovered commands.
 */
function listAvailableSkills(pi: ExtensionAPI): string[] {
	return pi.getCommands()
		.filter((cmd) => cmd.source === "skill")
		.map((cmd) => cmd.name.replace(/^skill:/, ""));
}

function dynamicToolLoad(
	pi: ExtensionAPI,
	state: DynamicToolState,
	name: string,
	description?: string,
): DynamicToolResult {
	const trimmed = name.trim();
	if (!trimmed) {
		return { ok: false, message: "No tool name provided." };
	}

	const nameError = validateToolName(trimmed);
	if (nameError) {
		return { ok: false, message: nameError };
	}

	if (state.loaded.has(trimmed)) {
		return { ok: false, message: `Dynamic tool "${trimmed}" is already loaded.` };
	}

	let definition: string;
	let strippedChars: string[] | undefined;

	if (description !== undefined) {
		// Description-based tool — sanitize control chars
		const sanitized = sanitizeDescription(description);
		definition = sanitized.clean;
		if (sanitized.stripped.length > 0) {
			strippedChars = sanitized.stripped;
		}
	} else {
		// Skill-based tool — resolve via pi's discovered skills
		const skillPath = resolveSkillPath(pi, trimmed);
		if (!skillPath) {
			const available = listAvailableSkills(pi).join(", ");
			return {
				ok: false,
				message: `Skill "${trimmed}" not found. Available: ${available || "(none)"}`,
			};
		}
		const raw = readFileSync(skillPath, "utf-8");
		const sanitized = sanitizeDescription(raw);
		definition = sanitized.clean;
		if (sanitized.stripped.length > 0) {
			strippedChars = sanitized.stripped;
		}
	}

	state.loaded.set(trimmed, definition);

	const lines = Array.from(state.loaded.entries()).map(
		([n, def]) => `\t- ${n}: ${def}`,
	);
	pi.sendMessage({
		customType: "dynamic-tool",
		content: `\n\nSystem:\nDynamic Tool Added:\n${lines.join("\n")}`,
		display: true,
		details: { action: "load", name: trimmed },
	});

	const result: DynamicToolResult = { ok: true, message: `Loaded dynamic tool "${trimmed}".` };
	if (strippedChars) {
		result.strippedChars = strippedChars;
		result.message += ` Warning: stripped control characters: ${strippedChars.join(", ")}`;
	}
	return result;
}

/**
 * Unload a dynamic tool by name.
 */
function dynamicToolUnload(
	pi: ExtensionAPI,
	state: DynamicToolState,
	name: string,
): DynamicToolResult {
	const trimmed = name.trim();
	if (!trimmed) {
		return { ok: false, message: "No tool name provided." };
	}

	const nameError = validateToolName(trimmed);
	if (nameError) {
		return { ok: false, message: nameError };
	}

	if (!state.loaded.has(trimmed)) {
		return { ok: false, message: `Dynamic tool "${trimmed}" is not loaded.` };
	}

	state.loaded.delete(trimmed);

	pi.sendMessage({
		customType: "dynamic-tool",
		content: `\n\nSystem:\nDynamic Tool Removed:\n\t- ${trimmed}`,
		display: true,
		details: { action: "unload", name: trimmed },
	});

	return { ok: true, message: `Unloaded dynamic tool "${trimmed}".` };
}

/**
 * List all currently loaded dynamic tools.
 */
function dynamicToolList(state: DynamicToolState): DynamicToolResult {
	if (state.loaded.size === 0) {
		return { ok: true, message: "No dynamic tools loaded." };
	}
	const names = Array.from(state.loaded.keys()).join(", ");
	return { ok: true, message: `Loaded dynamic tools: ${names}` };
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function piDynamicTools(pi: ExtensionAPI): void {
	const state: DynamicToolState = {
		loaded: new Map(),
		pi,
	};

	// --- Load from settings at launch -----------------------------------------

	pi.on("session_start", async () => {
		pi.sendMessage({
			customType: "dynamic-tool",
			content: "\n\nSystem:\nDynamic Tool Calls Enabled. To protect cache, tools may be added and removed as System: messages appended to user messages.  This prevents the tool call array in the system message from busting the session cache, reducing cost and optimizing throughput.",
			display: true,
			details: { action: "init" },
		});

		const config = loadSettings();

		// Skill-based tools from settings
		for (const name of config.skillTools) {
			dynamicToolLoad(pi, state, name);
		}

		// Description-based tools from settings
		for (const [name, description] of Object.entries(config.tools)) {
			dynamicToolLoad(pi, state, name, description);
		}
	});

	// --- Provider payload patching -------------------------------------------

	pi.on("before_provider_request", async (event, ctx) => {
		const model = ctx.model;
		if (!model) return;
		if (model.provider !== "openai-codex" || model.api !== "openai-codex-responses") return;
		if (!ctx.modelRegistry.isUsingOAuth(model)) return;

		return patchCodexOAuthPayloadWithDynamicTools(event.payload, state);
	});

	// --- Slash commands -------------------------------------------------------

	pi.registerCommand("dynamic-tool-load", {
		description: "Load a dynamic tool: /dynamic-tool-load <name> [description]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const { name, description } = parseLoadArgs(args);
			const result = dynamicToolLoad(pi, state, name, description);
			ctx.ui.notify(result.message, result.ok ? (result.strippedChars ? "warning" : "info") : "warning");
		},
	});

	pi.registerCommand("dynamic-tool-unload", {
		description: "Unload a dynamic tool: /dynamic-tool-unload <name>",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const result = dynamicToolUnload(pi, state, args);
			ctx.ui.notify(result.message, result.ok ? "info" : "warning");
		},
	});

	pi.registerCommand("dynamic-tool-list", {
		description: "List loaded dynamic tools",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const result = dynamicToolList(state);
			ctx.ui.notify(result.message, "info");
		},
	});
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse `/dynamic-tool-load <name> [description]`.
 * First whitespace-delimited token is the name. Everything after is the
 * description (if present).
 */
function parseLoadArgs(args: string): { name: string; description?: string } {
	const trimmed = args.trim();
	const spaceIdx = trimmed.indexOf(" ");
	if (spaceIdx === -1) {
		return { name: trimmed };
	}
	const name = trimmed.slice(0, spaceIdx);
	const description = trimmed.slice(spaceIdx + 1).trim();
	return { name, description: description.length > 0 ? description : undefined };
}
