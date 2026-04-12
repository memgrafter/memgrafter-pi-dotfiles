import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * pi-openrouter
 *
 * Skeleton extension that registers an OpenRouter provider.
 *
 * Auth:
 *   OPENROUTER_API_KEY=...
 */
export default function (pi: ExtensionAPI) {
	pi.registerProvider("openrouter", {
		baseUrl: OPENROUTER_BASE_URL,
		apiKey: "OPENROUTER_API_KEY",
		api: "openai-completions",
		models: [
			{
				id: "openai/gpt-4o-mini",
				name: "OpenRouter: GPT-4o Mini",
				reasoning: false,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
		],
	});
}
