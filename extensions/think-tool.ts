import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ToolDefinition, AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ToolRenderContext } from "@earendil-works/pi-coding-agent/core/extensions/types";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { Type, Static } from "typebox";

// ── Settings ────────────────────────────────────────────────────────────────
//
// The tool is gated by a `think-tool` settings section: project .pi/settings.json
// overrides global ~/.pi/agent/settings.json, which overrides the default (off).
// `/think-tool on|off` persists to settings; the `--think_tool` CLI flag is a
// one-off, session-only enable and never writes settings.

const SETTINGS_SECTION = "think-tool";

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

function readThinkToolEnabled(filePath: string): boolean | undefined {
	const section = readJsonObject(filePath)?.[SETTINGS_SECTION];
	if (!section || typeof section !== "object" || Array.isArray(section)) return;
	const value = (section as { think_tool?: unknown }).think_tool;
	return typeof value === "boolean" ? value : undefined;
}

function resolveThinkToolEnabled(cwd: string): { enabled: boolean; source: "project" | "global" | "default" } {
	const project = readThinkToolEnabled(getProjectSettingsPath(cwd));
	if (project !== undefined) return { enabled: project, source: "project" };
	const global = readThinkToolEnabled(getGlobalSettingsPath());
	if (global !== undefined) return { enabled: global, source: "global" };
	return { enabled: false, source: "default" };
}

function getSettingsPathToUpdate(cwd: string): string {
	return readJsonObject(getProjectSettingsPath(cwd))?.[SETTINGS_SECTION] !== undefined ? getProjectSettingsPath(cwd) : getGlobalSettingsPath();
}

function writeThinkToolEnabled(cwd: string, enabled: boolean): string {
	const settingsPath = getSettingsPathToUpdate(cwd);
	const settings = readJsonObject(settingsPath) ?? {};
	const section = settings[SETTINGS_SECTION];
	const nextSection = section && typeof section === "object" && !Array.isArray(section) ? section : {};
	settings[SETTINGS_SECTION] = { ...nextSection, think_tool: enabled };
	mkdirSync(path.dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
	return settingsPath;
}

// ── Schema ──────────────────────────────────────────────────────────────────
//
// `think` is a scratchpad the model *writes into*. During the output phase the
// model cannot emit real thinking tokens into a tool call — only output tokens
// can land there — so what it writes is output text that stays in the
// transcript and stays visible to the model later in its own tool-trace
// history. That makes it a durable, in-context working surface, not a
// controller: reasoning effort is managed by the harness, not by this tool.
//
// `level` and `kind` are no-ops: they do not change any harness state. Their
// only effect is to be echoed back in the tool result as a lightweight
// reminder of what the model asked for / named.

const thinkSchema = Type.Object({
	reasoning: Type.String({
		description:
			"Your working-out for this step: hypothesis, constraints, decomposition, a check on a surprising tool result, or a decision. This text is recorded in the tool history and stays visible to you in context.",
	}),
	level: Type.Optional(
		Type.Union(
			[
				Type.Literal("minimal"),
				Type.Literal("low"),
				Type.Literal("medium"),
				Type.Literal("high"),
				Type.Literal("xhigh"),
				Type.Literal("maximum"),
			],
			{
				description:
					"Name your thinking level so the tool trace is auditable. Use minimal for a deterministic step; high or more for a genuinely hard one.",
			},
		),
	),
	kind: Type.Optional(
		Type.String({
			description:
				"Names what you are doing so the tool trace is auditable. Canonical kinds: plan, react, diagnose, decide, verify — or name your own.",
		}),
	),
	format: Type.Optional(
		Type.String({
			description:
				"Thinking format that structures your reasoning: table (decisions), pseudocode (plans), trace (diagnosis). Read the thinking-formats skill before setting this. The format is the first line of your reasoning, prefixed with 'format: '.",
		}),
	),
});

// ── Tool ────────────────────────────────────────────────────────────────────

function createThinkTool(): ToolDefinition {
	return {
		name: "think",
		label: "Think",
		promptSnippet:
			"Write reasoning into a scratchpad that is recorded in your tool history. Use it while planning and before starting changes; it stays visible to you in context. `level`, `kind`, and `format` are no-op tags echoed back in the result.",
		description:
			"Think: a scratchpad you write your reasoning into. What you put here is output text that is recorded in the tool history and stays visible to you later in your own tool-trace context — use it to work out a step before acting. Call it while planning and before starting changes: a new sub-problem appeared, a non-trivial decision is needed, or a tool returned unexpected output. For a deterministic step, do not overthink — a short note or none at all is fine. " +
			"`level` is a no-op reminder (thinking effort is controlled by the harness, not this tool): name the effort you want for the next step — minimal, low, medium, high, xhigh, maximum — and it is echoed back. " +
			"`kind` is a no-op tag, echoed back only, that names what you are doing: plan, react, diagnose, decide, verify, or name your own. " +
			"`format` structures your reasoning: table (decisions), pseudocode (plans), trace (diagnosis). Read the thinking-formats skill before setting this.",
		parameters: thinkSchema,
		renderCall(args: Static<typeof thinkSchema>, theme: Theme, context: ToolRenderContext) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const reasoning = args.reasoning ?? "";
			const tags: string[] = [];
			if (args.kind) tags.push(`kind: ${args.kind}`);
			if (args.level) tags.push(`level: ${args.level}`);
			if (args.format) tags.push(`format: ${args.format}`);
			const line = `[think${tags.length ? " · " + tags.join(" · ") : ""}] ${reasoning}`;
			text.setText(theme.fg("toolTitle", theme.bold(line)));
			return text;
		},
		renderResult(result: AgentToolResult<any>, options: { expanded: boolean; isPartial: boolean }, theme: Theme, context: ToolRenderContext) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const content = result.content.map((c: any) => c.text || "").join("\n");
			const colorFn = result.isError ? theme.fg("toolError", content) : theme.fg("toolOutput", content);
			text.setText(colorFn || content);
			return text;
		},
		async execute(
			_toolCallId,
			params: Static<typeof thinkSchema>,
			_signal,
			_onUpdate,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<Record<string, any>>> {
			return {
				content: [{ type: "text", text: "Success." }],
				details: {
					kind: params.kind,
					level: params.level,
					format: params.format,
					reasoning: params.reasoning,
				},
			};
		},
	};
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	pi.registerFlag("think_tool", {
		description: "One-off, session-only enable of the `think` tool (does not change settings)",
		type: "boolean",
		default: false,
	});

	pi.registerTool(createThinkTool());

	function setThinkActive(ctx: ExtensionContext, enabled: boolean): void {
		const tools = pi.getActiveTools();
		const hasThink = tools.includes("think");
		if (hasThink === enabled) return; // no change
		const next = enabled ? [...tools, "think"] : tools.filter((t) => t !== "think");
		pi.setActiveTools(next);
		if (ctx.hasUI) ctx.ui.notify(`think tool ${enabled ? "enabled" : "disabled"} for this session.`, "info");
	}

	pi.registerCommand("think-tool", {
		description: "Manage the think scratchpad tool: /think-tool [on|off|status]",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const items: AutocompleteItem[] = [
				{ value: "on", label: "on", description: "enable and persist to settings" },
				{ value: "off", label: "off", description: "disable and persist to settings" },
				{ value: "status", label: "status", description: "show current status" },
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx: ExtensionCommandContext) => {
			const arg = (args ?? "").trim().toLowerCase();
			if (arg === "on" || arg === "off") {
				const enabled = arg === "on";
				const settingsPath = writeThinkToolEnabled(ctx.cwd, enabled);
				setThinkActive(ctx, enabled);
				ctx.ui.notify(`think tool ${enabled ? "on" : "off"} (saved to ${settingsPath}).`, "info");
				return;
			}
			if (arg === "" || arg === "status") {
				const { enabled, source } = resolveThinkToolEnabled(ctx.cwd);
				const active = pi.getActiveTools().includes("think");
				ctx.ui.notify(`think tool: ${active ? "active" : "inactive"} this session; setting ${enabled ? "on" : "off"} (${source}).`, "info");
				return;
			}
			ctx.ui.notify(`Unknown argument: ${arg}. Usage: /think-tool [on|off|status]`, "warning");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		const { enabled } = resolveThinkToolEnabled(ctx.cwd);
		setThinkActive(ctx, pi.getFlag("think_tool") === true || enabled);
	});
}
