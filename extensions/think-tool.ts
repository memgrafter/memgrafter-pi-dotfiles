import type { ExtensionAPI, ToolDefinition, AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ToolRenderContext } from "@earendil-works/pi-coding-agent/core/extensions/types";
import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { Type, Static } from "typebox";

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
});

// ── Tool ────────────────────────────────────────────────────────────────────

function createThinkTool(): ToolDefinition {
	return {
		name: "think",
		label: "Think",
		promptSnippet:
			"Write reasoning into a scratchpad that is recorded in your tool history. Use it before a hard or surprising step; it stays visible to you in context. `level` and `kind` are no-op tags echoed back in the result.",
		description:
			"Think: a scratchpad you write your reasoning into. What you put here is output text that is recorded in the tool history and stays visible to you later in your own tool-trace context — use it to work out a step before acting. Call it before a hard or surprising step: a tool returned unexpected output, a new sub-problem appeared, or a non-trivial decision is needed. For a deterministic step, do not overthink — a short note or none at all is fine. " +
			"`level` is a no-op reminder (thinking effort is controlled by the harness, not this tool): name the effort you want for the next step — minimal, low, medium, high, xhigh, maximum — and it is echoed back. " +
			"`kind` is a no-op tag, echoed back only, that names what you are doing: plan, react, diagnose, decide, verify, or name your own.",
		parameters: thinkSchema,
		renderCall(args: Static<typeof thinkSchema>, theme: Theme, context: ToolRenderContext) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const reasoning = args.reasoning ? args.reasoning.split("\n").slice(0, 1).join(" ") : "";
			const tags: string[] = [];
			if (args.kind) tags.push(`kind: ${args.kind}`);
			if (args.level) tags.push(`level: ${args.level}`);
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
			const parts: string[] = ["Recorded think tool. It is available in the session tool history."];
			const tags: string[] = [];
			if (params.kind) tags.push(`kind: ${params.kind}`);
			if (params.level) tags.push(`level: ${params.level}`);
			if (tags.length) {
				parts.push(`(tags: ${tags.join(", ")})`);
			}
			return {
				content: [{ type: "text", text: parts.join(" ") }],
				details: {
					kind: params.kind,
					level: params.level,
					reasoning: params.reasoning,
				},
			};
		},
	};
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	pi.registerFlag("think_tool", {
		description: "Enable the `think` scratchpad tool",
		type: "boolean",
		default: false,
	});

	pi.registerTool(createThinkTool());

	pi.on("session_start", () => {
		if (pi.getFlag("think_tool") === true) {
			const tools = pi.getActiveTools();
			if (!tools.includes("think")) tools.push("think");
			pi.setActiveTools(tools);
		}
	});
}
