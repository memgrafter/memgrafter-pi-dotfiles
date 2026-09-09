/**
 * Pi Skill Injector Extension
 *
 * Keeps a named list of skills permanently in context. Each configured skill
 * is expanded the same way pi expands a typed `/skill:name` command (frontmatter
 * stripped, body wrapped in a `<skill name=... location=...>` block with the
 * base-dir reference note) and injected as a single post-history custom message
 * via `before_agent_start` — landing after the user message, and after the
 * frag role message when frag is on (extension load order:
 * flexible-role-agent < skill-injector).
 *
 * Injection happens at launch (the first prompt of the session) and is
 * re-triggered after every compaction, because compaction replaces the history
 * and drops the previously injected skill content. No system prompt is ever
 * modified, so there is no cache-bust warning flow (unlike frag).
 *
 * Usage:
 *   pi -e ./extensions/skill-injector.ts
 *   /skill-inject            show current state and configured skills
 *   /skill-inject on | off   enable/disable (persists to settings)
 *   /skill-inject add <name>      add a skill by name (validated against the
 *                                 loaded skill registry; persists)
 *   /skill-inject remove <name>   remove a skill (persists)
 *   /skill-inject list         list available skill names
 *
 * Config: optional "skill-inject" key in settings.json (project
 * .pi/settings.json → global ~/.pi/agent/settings.json):
 *   { "skill-inject": { "enabled": true, "skills": ["think-tool-formats"] } }
 * Skill entries are skill NAMES (the `name` frontmatter field / registry name),
 * not paths. Unknown names are warned at session start and skipped at
 * injection time. Both fields default off/empty.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, stripFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

// ============================================================================
// Settings persistence (optional "skill-inject" key in settings.json)
// ============================================================================

const SETTINGS_SECTION = "skill-inject";

interface SkillInjectConfig {
	enabled: boolean;
	skills: string[];
}

function getProjectSettingsPath(cwd: string): string {
	return path.join(cwd, ".pi", "settings.json");
}

function getGlobalSettingsPath(): string {
	return path.join(homedir(), ".pi", "agent", "settings.json");
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) return;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
	} catch {
		return;
	}
}

function readSkillInjectSettings(filePath: string): Partial<SkillInjectConfig> | undefined {
	const section = readJsonObject(filePath)?.[SETTINGS_SECTION];
	if (!section || typeof section !== "object" || Array.isArray(section)) return;
	const enabled = (section as { enabled?: unknown }).enabled;
	const skills = (section as { skills?: unknown }).skills;
	return {
		enabled: typeof enabled === "boolean" ? enabled : undefined,
		skills: Array.isArray(skills) ? skills.filter((s): s is string => typeof s === "string") : undefined,
	};
}

function resolveConfig(cwd: string): SkillInjectConfig {
	const project = readSkillInjectSettings(getProjectSettingsPath(cwd));
	const global = readSkillInjectSettings(getGlobalSettingsPath());
	return {
		enabled: project?.enabled ?? global?.enabled ?? false,
		skills: project?.skills ?? global?.skills ?? [],
	};
}

function getSettingsPathToUpdate(cwd: string): string {
	return readJsonObject(getProjectSettingsPath(cwd))?.[SETTINGS_SECTION] !== undefined
		? getProjectSettingsPath(cwd)
		: getGlobalSettingsPath();
}

function writeConfig(cwd: string, patch: Partial<SkillInjectConfig>): void {
	const settingsPath = getSettingsPathToUpdate(cwd);
	const settings = readJsonObject(settingsPath) ?? {};
	const section = settings[SETTINGS_SECTION];
	const nextSection = section && typeof section === "object" && !Array.isArray(section) ? section : {};
	settings[SETTINGS_SECTION] = { ...nextSection, ...patch };
	mkdirSync(path.dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

// ============================================================================
// Skill expansion (mirrors pi's /skill:name expansion)
// ============================================================================

const SKILL_INJECT_TYPE = "skill-inject";

/** Matches the skill block header pi writes for /skill:name and for our injections. */
const SKILL_BLOCK_NAME_PATTERN = /<skill name="([a-z0-9-]+)"/g;

/** Minimal skill shape as reported in systemPromptOptions.skills. */
interface SkillRef {
	name: string;
	filePath: string;
	baseDir: string;
}

/**
 * Build the same block pi produces for a typed `/skill:name`:
 * frontmatter stripped (pi's own stripFrontmatter), body wrapped with the
 * location and base-dir note.
 */
function expandSkillBody(skill: SkillRef): string {
	const content = readFileSync(skill.filePath, "utf-8");
	const body = stripFrontmatter(content).trim();
	return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI): void {
	const state: SkillInjectConfig = { enabled: false, skills: [] };
	/**
	 * Skill names currently present in the live context, from ANY source: our
	 * injections (custom messages), or /skill:name blocks typed by the user or
	 * agent (stored as plain user messages). undefined = unknown (rescan needed);
	 * [] = scanned, nothing present.
	 */
	let injected: string[] | undefined;
	/**
	 * Skill registry snapshot. pi 0.85.x event contexts do not expose
	 * getSystemPromptOptions (command contexts do), so the registry is captured
	 * from before_agent_start's event.systemPromptOptions and refreshed on
	 * session_start (reload) via a one-shot pendingRefresh flag.
	 */
	let available: SkillRef[] = [];
	let pendingRefresh = false;

	/** Extract text from an entry's content (string or content-block array). */
	function entryText(content: unknown): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text?: unknown }).text ?? "") : ""))
				.join("");
		}
		return "";
	}

	/** Skill names named in a <skill name="..."> block's text. */
	function skillNamesInText(text: string): string[] {
		const names: string[] = [];
		for (const match of text.matchAll(SKILL_BLOCK_NAME_PATTERN)) {
			if (match[1] && !names.includes(match[1])) names.push(match[1]);
		}
		return names;
	}

	/**
	 * Scan session history (reverse) for skill blocks from any source: our
	 * skill-inject custom messages (details.skills fast path, content fallback)
	 * and /skill:name user messages. Returns the union of names present.
	 */
	function scanInjectedSkills(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): string[] {
		const found = new Set<string>();
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index] as { type?: string; customType?: string; details?: unknown; message?: { role?: string; content?: unknown } };
			if (entry.type === "custom_message" && entry.customType === SKILL_INJECT_TYPE) {
				const details = entry.details as { skills?: unknown } | undefined;
				if (Array.isArray(details?.skills)) {
					for (const name of details.skills as unknown[]) {
						if (typeof name === "string") found.add(name);
					}
				} else {
					for (const name of skillNamesInText(entryText((entry as { content?: unknown }).content))) {
						found.add(name);
					}
				}
			} else if (entry.type === "message" && entry.message?.role === "user") {
				for (const name of skillNamesInText(entryText(entry.message.content))) {
					found.add(name);
				}
			}
		}
		return [...found];
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		const list = state.skills.length > 0 ? state.skills.join(", ") : "(none)";
		const text = `skill-inject: ${state.enabled ? `on [${list}]` : "off"}`;
		ctx.ui.setStatus("skill-inject", state.enabled ? ctx.ui.theme.fg("accent", text) : text);
	}

	/**
	 * Inject the configured skills as one post-history custom message. Returns
	 * undefined when there is nothing to inject. Called from
	 * before_agent_start at launch and after every compaction.
	 */
	function buildInjection(ctx: ExtensionContext, names: string[]): { customType: string; content: string; details: { skills: string[] }; display: boolean } | undefined {
		const blocks: string[] = [];
		const injectedNames: string[] = [];
		for (const name of names) {
			const skill = available.find((s) => s.name === name);
			if (!skill) continue; // warned at session start
			try {
				blocks.push(expandSkillBody(skill));
				injectedNames.push(name);
			} catch (error) {
				if (ctx.hasUI) {
					ctx.ui.notify(`skill-inject: failed to read skill '${name}': ${error instanceof Error ? error.message : String(error)}`, "warning");
				}
			}
		}
		if (blocks.length === 0) return undefined;
		return {
			customType: SKILL_INJECT_TYPE,
			content: blocks.join("\n\n"),
			details: { skills: injectedNames },
			display: true,
		};
	}

	pi.registerMessageRenderer(SKILL_INJECT_TYPE, (message, _options, theme) => {
		const details = message.details as { skills?: unknown } | undefined;
		const names = Array.isArray(details?.skills) ? (details!.skills as string[]).join(", ") : "";
		const content = typeof message.content === "string" ? message.content : "";
		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(theme.fg("customMessageLabel", `\x1b[1m[skill: ${names || "inject"}]\x1b[22m`), 0, 0));
		box.addChild(new Spacer(1));
		box.addChild(new Markdown(content, 0, 0, getMarkdownTheme(), {
			color: (text) => theme.fg("customMessageText", text),
		}));
		return box;
	});

	// Command contexts expose getSystemPromptOptions in 0.85.x; event contexts
	// do not. Prefer the live call, fall back to the captured snapshot.
	function commandAvailableSkills(ctx: ExtensionCommandContext): SkillRef[] {
		try {
			const live = (ctx.getSystemPromptOptions?.() as { skills?: SkillRef[] } | undefined)?.skills;
			if (live) return live;
		} catch {
			// fall through to snapshot
		}
		return available;
	}

	// Capture the skill registry on the first prompt of the session (and after
	// a reload, which re-fires session_start with a fresh resource loader).
	// before_agent_start always fires before the first session_compact, so the
	// snapshot is populated before any injection needs it.
	function refreshRegistry(event: { systemPromptOptions?: { skills?: SkillRef[] } }): void {
		if (!pendingRefresh) return;
		const skills = event.systemPromptOptions?.skills;
		if (skills) {
			available = skills as SkillRef[];
			pendingRefresh = false;
		}
	}

	pi.on("session_start", (_event, ctx) => {
		const config = resolveConfig(ctx.cwd);
		state.enabled = config.enabled;
		state.skills = config.skills;
		// Resume guard: pick up skill blocks already in the (possibly compacted)
		// history, whether we injected them or the user/agent typed /skill:name.
		injected = scanInjectedSkills(ctx.sessionManager.getEntries());
		pendingRefresh = true;

		if (state.enabled && state.skills.length > 0 && ctx.hasUI && available.length > 0) {
			const names = available.map((s) => s.name);
			const unknown = state.skills.filter((name) => !names.includes(name));
			if (unknown.length > 0) {
				ctx.ui.notify(
					`skill-inject: unknown skill name(s): ${unknown.join(", ")}. Available: ${names.join(", ") || "(none)"}`,
					"warning",
				);
			}
		}
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		refreshRegistry(event);
		if (!state.enabled || state.skills.length === 0) return undefined;
		if (injected === undefined) {
			injected = scanInjectedSkills(ctx.sessionManager.getEntries());
		}
		const missing = state.skills.filter((name) => !injected!.includes(name));
		if (missing.length === 0) return undefined;
		const message = buildInjection(ctx, missing);
		if (!message) return undefined;
		injected = [...injected!, ...message.details.skills];
		return { message };
	});

	// Compaction may drop skill blocks from the live context (ours and
	// /skill:name alike); rescan the post-compaction history on the next prompt.
	pi.on("session_compact", () => {
		injected = undefined;
	});

	pi.registerCommand("skill-inject", {
		description: "Inject named skills into context at launch and after compaction (use: /skill-inject [status|on|off|add <name>|remove <name>|list])",
		getArgumentCompletions: (prefix: string) => {
			const items: AutocompleteItem[] = [
				{ value: "status", label: "status", description: "show current state" },
				{ value: "on", label: "on", description: "enable and persist" },
				{ value: "off", label: "off", description: "disable and persist" },
				{ value: "add ", label: "add ", description: "add a skill by name" },
				{ value: "remove ", label: "remove ", description: "remove a skill by name" },
				{ value: "list", label: "list", description: "list available skill names" },
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx: ExtensionCommandContext) => {
			const trimmed = (args ?? "").trim();
			const [cmd, ...rest] = trimmed.split(" ");
			const arg = rest.join(" ").trim();

			switch (cmd) {
				case "":
				case "status": {
					const list = state.skills.length > 0 ? state.skills.join(", ") : "(none)";
					ctx.ui.notify(`skill-inject: ${state.enabled ? "on" : "off"} — skills: ${list}`, "info");
					updateStatus(ctx);
					return;
				}
				case "on":
				case "off": {
					const enabled = cmd === "on";
					state.enabled = enabled;
					writeConfig(ctx.cwd, { enabled });
					if (enabled) injected = undefined; // rescan: pick up pending additions next prompt
					ctx.ui.notify(`skill-inject ${enabled ? "enabled" : "disabled"} (persisted).`, "info");
					updateStatus(ctx);
					return;
				}
				case "add": {
					if (!arg) {
						ctx.ui.notify("Usage: /skill-inject add <name>", "warning");
						return;
					}
					const names = commandAvailableSkills(ctx).map((s) => s.name);
					if (!names.includes(arg)) {
						ctx.ui.notify(`Unknown skill '${arg}'. Available: ${names.join(", ") || "(none)"}`, "warning");
						return;
					}
					if (state.skills.includes(arg)) {
						ctx.ui.notify(`Skill '${arg}' is already configured.`, "info");
						return;
					}
					state.skills = [...state.skills, arg];
					writeConfig(ctx.cwd, { skills: state.skills });
					injected = undefined; // rescan: the new skill is not in history yet
					ctx.ui.notify(`Added '${arg}' — will inject on next prompt.`, "info");
					updateStatus(ctx);
					return;
				}
				case "remove": {
					if (!arg) {
						ctx.ui.notify("Usage: /skill-inject remove <name>", "warning");
						return;
					}
					if (!state.skills.includes(arg)) {
						ctx.ui.notify(`Skill '${arg}' is not configured.`, "warning");
						return;
					}
					state.skills = state.skills.filter((s) => s !== arg);
					writeConfig(ctx.cwd, { skills: state.skills });
					ctx.ui.notify(`Removed '${arg}'.`, "info");
					updateStatus(ctx);
					return;
				}
				case "list": {
					const names = commandAvailableSkills(ctx).map((s) => s.name);
					ctx.ui.notify(`Available skills: ${names.join(", ") || "(none)"}`, "info");
					return;
				}
				default:
					ctx.ui.notify(`Unknown: /skill-inject ${cmd}. Usage: /skill-inject [status|on|off|add <name>|remove <name>|list]`, "warning");
			}
		},
	});

	// Render the injected skill blocks as a compact box: header + markdown body.
	pi.registerMessageRenderer("skill-inject", (message, _ctx, _theme: Theme) => {
		const content = typeof message.content === "string" ? message.content : "";
		const names = [...content.matchAll(/<skill name="([^"]+)"/g)].map((m) => m[1]);
		const box = new Box(0, 0, (c: Theme) => c.accentBlue);
		box.addChild(new Text(`[skill: ${names.join(", ")}]`, 0, 0, (c: Theme) => c.accentBlue));
		box.addChild(new Spacer(1));
		box.addChild(new Text(content, 0, 0, (c: Theme) => c.text, getMarkdownTheme()));
		return box;
	});
}
