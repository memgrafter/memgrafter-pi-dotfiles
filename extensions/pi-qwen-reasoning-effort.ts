import type { BeforeProviderRequestEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Adds a top-level `reasoning_effort` to provider requests for qwen-chat-template
 * models that advertise `supportsReasoningEffort` (e.g. local vLLM Qwen3).
 *
 * Released pi-ai only sets `chat_template_kwargs.enable_thinking` for these
 * models and never emits `reasoning_effort`, so the mapped value is injected
 * here via `before_provider_request`. The mapping mirrors pi-ai's thinking
 * levels: minimal/low -> "low", medium -> "medium", high/xhigh/max -> "xhigh".
 * A model's `thinkingLevelMap` overrides the table.
 *
 * The supported-levels/clamp helpers below mirror pi-ai's
 * `getSupportedThinkingLevels`/`clampThinkingLevel` (inlined because
 * `@earendil-works/pi-ai` is not importable from this repo).
 */

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const QWEN_EFFORT: Record<string, string> = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "xhigh",
	xhigh: "xhigh",
	max: "xhigh",
};

type QwenModel = {
	reasoning: boolean;
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
	compat?: { thinkingFormat?: string; supportsReasoningEffort?: boolean };
};

function supportedLevels(model: QwenModel): ThinkingLevel[] {
	if (!model.reasoning) return ["off"];
	return THINKING_LEVELS.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if (level === "xhigh" || level === "max") return mapped !== undefined;
		return true;
	}) as ThinkingLevel[];
}

function clampLevel(model: QwenModel, level: ThinkingLevel): ThinkingLevel {
	const available = supportedLevels(model);
	if (available.includes(level)) return level;
	const requestedIndex = THINKING_LEVELS.indexOf(level);
	if (requestedIndex === -1) return available[0] ?? "off";
	for (let i = requestedIndex; i < THINKING_LEVELS.length; i++) {
		if (available.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
	}
	for (let i = requestedIndex - 1; i >= 0; i--) {
		if (available.includes(THINKING_LEVELS[i])) return THINKING_LEVELS[i];
	}
	return available[0] ?? "off";
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event: BeforeProviderRequestEvent, ctx) => {
		const model = ctx.model as QwenModel | undefined;
		const level: string | undefined = ctx.thinkingLevel;
		if (!model || !level || level === "off") return;
		if (model.compat?.thinkingFormat !== "qwen-chat-template" || !model.compat.supportsReasoningEffort) return;
		const payload = event.payload;
		if (!payload || typeof payload !== "object") return;
		const clamped = clampLevel(model, level as ThinkingLevel);
		if (clamped === "off") return;
		const effort = model.thinkingLevelMap?.[clamped] ?? QWEN_EFFORT[clamped];
		if (effort == null) return;
		return { ...(payload as Record<string, unknown>), reasoning_effort: effort };
	});
}
