import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { ExtensionAPI, BeforeProviderRequestEvent, ThinkingLevelSelectEvent } from "@earendil-works/pi-coding-agent";

const SETTINGS_PATH = join(homedir(), ".pi", "agent", "models.json");
const AGENT_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

interface ThinkingBudgets {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

interface ModelEntry {
	id: string;
	thinkingBudgets?: ThinkingBudgets;
}

interface ModelsConfig {
	providers?: Record<
		string,
		{
			models?: ModelEntry[];
		}
	>;
}

let currentThinkingLevel: string = "off";
let modelsConfig: ModelsConfig | null = null;

function loadModelsConfig(): ModelsConfig | null {
	if (modelsConfig) return modelsConfig;
	if (!existsSync(SETTINGS_PATH)) return null;
	try {
		modelsConfig = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8")) as ModelsConfig;
		return modelsConfig;
	} catch {
		return null;
	}
}

function loadDefaultThinkingLevel(): string {
	if (!existsSync(AGENT_SETTINGS_PATH)) return "off";
	try {
		const settings = JSON.parse(readFileSync(AGENT_SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
		const level = settings.defaultThinkingLevel;
		return typeof level === "string" ? level : "off";
	} catch {
		return "off";
	}
}

function findThinkingBudgets(modelId: string): ThinkingBudgets | undefined {
	const config = loadModelsConfig();
	if (!config?.providers) return;

	for (const provider of Object.values(config.providers)) {
		if (!provider?.models) continue;
		for (const model of provider.models) {
			if (model.id === modelId && model.thinkingBudgets) {
				return model.thinkingBudgets;
			}
		}
	}
}

function resolveBudget(thinkingBudgets: ThinkingBudgets, level: string): number | undefined {
	const normalized = level.toLowerCase();
	if (normalized in thinkingBudgets) {
		return thinkingBudgets[normalized as keyof ThinkingBudgets];
	}
}

type RequestPayload = Record<string, unknown> & {
	model?: string;
	messages?: unknown[];
};

export default function (pi: ExtensionAPI) {
	// Initialize from settings on load.
	currentThinkingLevel = loadDefaultThinkingLevel();

	pi.on("thinking_level_select", (event: ThinkingLevelSelectEvent) => {
		currentThinkingLevel = event.level ?? "off";
	});

	pi.on("before_provider_request", (event: BeforeProviderRequestEvent) => {
		const payload = event.payload as RequestPayload | undefined;
		if (!payload || typeof payload !== "object" || !payload.model) return;

		if (currentThinkingLevel === "off") return;

		const budgets = findThinkingBudgets(payload.model);
		if (!budgets) return;

		const budget = resolveBudget(budgets, currentThinkingLevel);
		if (budget === undefined) return;

		return {
			...payload,
			// llama.cpp reads thinking_budget_tokens; vLLM reads thinking_token_budget.
			// Send both so the same budget applies across backends.
			thinking_budget_tokens: budget,
			thinking_token_budget: budget,
		};
	});
}
