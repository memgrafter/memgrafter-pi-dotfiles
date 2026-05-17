/**
 * Pi Codex Model Guard Extension
 *
 * Override strategy:
 * - Overrides openai-codex provider streaming via pi.registerProvider(..., streamSimple)
 * - Parses raw Codex SSE response.completed payload
 * - If requested model is gpt-5.3-codex and response.model is downgraded,
 *   surfaces a red warning in UI but continues the response
 */

import os from "node:os";
import {
	AssistantMessageEventStream,
	calculateCost,
	getEnvApiKey,
	parseStreamingJson,
	supportsXhigh,
	type Api,
	type AssistantMessage,
	type Context,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type StopReason,
	type TextContent,
	type ThinkingContent,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
	ResponseFunctionToolCall,
	ResponseInput,
	ResponseInputContent,
	ResponseInputImage,
	ResponseInputText,
	ResponseOutputMessage,
	ResponseReasoningItem,
	ResponseStreamEvent,
	Tool as OpenAITool,
} from "openai/resources/responses/responses.js";

const TARGET_PROVIDER = "openai-codex";
const TARGET_MODEL = "gpt-5.3-codex";
const STATE_ENTRY_TYPE = "codex-model-guard";
const MISMATCH_ENTRY_TYPE = "codex-model-guard-mismatch";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth" as const;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

type CodexResponseStatus = "completed" | "incomplete" | "failed" | "cancelled" | "queued" | "in_progress";

const CODEX_RESPONSE_STATUSES = new Set<CodexResponseStatus>([
	"completed",
	"incomplete",
	"failed",
	"cancelled",
	"queued",
	"in_progress",
]);

interface GuardState {
	enabled: boolean;
}

interface GuardMismatchEntry {
	requestedProvider: string;
	requestedModel: string;
	receivedProvider: string;
	receivedModel: string;
	timestamp: number;
}

interface AssistantMessageLike {
	role: "assistant";
	provider: string;
	model: string;
	timestamp: number;
}

interface RequestBody {
	model: string;
	store?: boolean;
	stream?: boolean;
	instructions?: string;
	input?: ResponseInput;
	tools?: OpenAITool[];
	tool_choice?: "auto";
	parallel_tool_calls?: boolean;
	temperature?: number;
	reasoning?: { effort?: string; summary?: string };
	text?: { verbosity?: "low" | "medium" | "high" };
	include?: string[];
	prompt_cache_key?: string;
}

interface CodexStreamOptions extends SimpleStreamOptions {
	reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null;
	textVerbosity?: "low" | "medium" | "high";
}

function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function shortHash(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function transformMessages<TApi extends Api>(
	messages: Message[],
	model: Model<TApi>,
	normalizeToolCallId?: (id: string, model: Model<TApi>, source: AssistantMessage) => string,
): Message[] {
	const toolCallIdMap = new Map<string, string>();

	const transformed = messages.map((msg) => {
		if (msg.role === "user") return msg;
		if (msg.role === "toolResult") {
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			if (normalizedId && normalizedId !== msg.toolCallId) {
				return { ...msg, toolCallId: normalizedId };
			}
			return msg;
		}

		const assistantMsg = msg as AssistantMessage;
		const isSameModel =
			assistantMsg.provider === model.provider &&
			assistantMsg.api === model.api &&
			assistantMsg.model === model.id;

		const transformedContent = assistantMsg.content.flatMap((block) => {
			if (block.type === "thinking") {
				if (isSameModel && block.thinkingSignature) return block;
				if (!block.thinking || block.thinking.trim() === "") return [];
				if (isSameModel) return block;
				return { type: "text" as const, text: block.thinking };
			}

			if (block.type === "text") {
				if (isSameModel) return block;
				return { type: "text" as const, text: block.text };
			}

			if (block.type === "toolCall") {
				const toolCall = block as ToolCall;
				let normalizedToolCall: ToolCall = toolCall;

				if (!isSameModel && toolCall.thoughtSignature) {
					normalizedToolCall = { ...toolCall };
					delete (normalizedToolCall as { thoughtSignature?: string }).thoughtSignature;
				}

				if (!isSameModel && normalizeToolCallId) {
					const normalizedId = normalizeToolCallId(toolCall.id, model, assistantMsg);
					if (normalizedId !== toolCall.id) {
						toolCallIdMap.set(toolCall.id, normalizedId);
						normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
					}
				}

				return normalizedToolCall;
			}

			return block;
		});

		return { ...assistantMsg, content: transformedContent };
	});

	const result: Message[] = [];
	let pendingToolCalls: ToolCall[] = [];
	let existingToolResultIds = new Set<string>();

	for (let i = 0; i < transformed.length; i++) {
		const msg = transformed[i];

		if (msg.role === "assistant") {
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [{ type: "text", text: "No result provided" }],
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}

			const assistantMsg = msg as AssistantMessage;
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") continue;

			const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall") as ToolCall[];
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				existingToolResultIds = new Set();
			}

			result.push(msg);
		} else if (msg.role === "toolResult") {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else {
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name,
							content: [{ type: "text", text: "No result provided" }],
							isError: true,
							timestamp: Date.now(),
						} as ToolResultMessage);
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}
			result.push(msg);
		}
	}

	return result;
}

function normalizeModelId(modelId: string): string {
	const trimmed = modelId.trim();
	const slashIndex = trimmed.lastIndexOf("/");
	return slashIndex === -1 ? trimmed : trimmed.slice(slashIndex + 1);
}

function isExpectedModelId(modelId: string): boolean {
	const normalized = normalizeModelId(modelId).toLowerCase();
	const expected = TARGET_MODEL.toLowerCase();
	return normalized === expected || normalized.startsWith(`${expected}-`);
}

function isAssistantMessageLike(message: unknown): message is AssistantMessageLike {
	if (!message || typeof message !== "object") return false;
	const candidate = message as Record<string, unknown>;
	return (
		candidate.role === "assistant" &&
		typeof candidate.provider === "string" &&
		typeof candidate.model === "string" &&
		typeof candidate.timestamp === "number"
	);
}

function parseGuardStateEntry(entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>): boolean | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown };
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
		if (!entry.data || typeof entry.data !== "object") return undefined;
		const enabled = (entry.data as { enabled?: unknown }).enabled;
		return typeof enabled === "boolean" ? enabled : undefined;
	}
	return undefined;
}

function updateStatus(ctx: ExtensionContext, enabled: boolean, downgradeDetected = false): void {
	if (!ctx.hasUI) return;
	if (!enabled) {
		ctx.ui.setStatus("codex-guard", undefined);
		return;
	}
	ctx.ui.setStatus(
		"codex-guard",
		downgradeDetected ? ctx.ui.theme.fg("error", "● codex-guard") : ctx.ui.theme.fg("muted", "● codex-guard"),
	);
}

function clampReasoning(effort: CodexStreamOptions["reasoningEffort"]): Exclude<CodexStreamOptions["reasoningEffort"], "xhigh"> | undefined {
	if (!effort) return undefined;
	return effort === "xhigh" ? "high" : effort;
}

function clampReasoningEffort(modelId: string, effort: string): string {
	const id = modelId.includes("/") ? modelId.split("/").pop() ?? modelId : modelId;
	if ((id.startsWith("gpt-5.2") || id.startsWith("gpt-5.3")) && effort === "minimal") return "low";
	if (id === "gpt-5.1" && effort === "xhigh") return "high";
	if (id === "gpt-5.1-codex-mini") return effort === "high" || effort === "xhigh" ? "high" : "medium";
	return effort;
}

function convertResponsesMessages<TApi extends Api>(model: Model<TApi>, context: Context): ResponseInput {
	const messages: ResponseInput = [];

	const normalizeToolCallId = (id: string): string => {
		if (!CODEX_TOOL_CALL_PROVIDERS.has(model.provider)) return id;
		if (!id.includes("|")) return id;
		const [callId, itemId] = id.split("|");
		const sanitizedCallId = callId.replace(/[^a-zA-Z0-9_-]/g, "_");
		let sanitizedItemId = itemId.replace(/[^a-zA-Z0-9_-]/g, "_");
		if (!sanitizedItemId.startsWith("fc")) sanitizedItemId = `fc_${sanitizedItemId}`;
		let normalizedCallId = sanitizedCallId.length > 64 ? sanitizedCallId.slice(0, 64) : sanitizedCallId;
		let normalizedItemId = sanitizedItemId.length > 64 ? sanitizedItemId.slice(0, 64) : sanitizedItemId;
		normalizedCallId = normalizedCallId.replace(/_+$/, "");
		normalizedItemId = normalizedItemId.replace(/_+$/, "");
		return `${normalizedCallId}|${normalizedItemId}`;
	};

	const transformedMessages = transformMessages(context.messages, model, normalizeToolCallId);

	if (context.systemPrompt) {
		const role = model.reasoning ? "developer" : "system";
		messages.push({
			role,
			content: sanitizeSurrogates(context.systemPrompt),
		} as ResponseInput[number]);
	}

	let msgIndex = 0;
	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				messages.push({
					role: "user",
					content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
				});
			} else {
				const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
					if (item.type === "text") {
						return { type: "input_text", text: sanitizeSurrogates(item.text) } satisfies ResponseInputText;
					}
					return {
						type: "input_image",
						detail: "auto",
						image_url: `data:${item.mimeType};base64,${item.data}`,
					} satisfies ResponseInputImage;
				});

				const filteredContent = !model.input.includes("image")
					? content.filter((c) => c.type !== "input_image")
					: content;
				if (filteredContent.length === 0) continue;
				messages.push({ role: "user", content: filteredContent });
			}
		} else if (msg.role === "assistant") {
			const output: ResponseInput = [];
			const assistantMsg = msg as AssistantMessage;
			const isDifferentModel =
				assistantMsg.model !== model.id &&
				assistantMsg.provider === model.provider &&
				assistantMsg.api === model.api;

			for (const block of msg.content) {
				if (block.type === "thinking") {
					if (block.thinkingSignature) {
						const reasoningItem = JSON.parse(block.thinkingSignature) as ResponseReasoningItem;
						output.push(reasoningItem);
					}
				} else if (block.type === "text") {
					const textBlock = block as TextContent;
					let msgId = textBlock.textSignature;
					if (!msgId) msgId = `msg_${msgIndex}`;
					else if (msgId.length > 64) msgId = `msg_${shortHash(msgId)}`;
					output.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: sanitizeSurrogates(textBlock.text), annotations: [] }],
						status: "completed",
						id: msgId,
					} as ResponseOutputMessage);
				} else if (block.type === "toolCall") {
					const toolCall = block as ToolCall;
					const [callId, itemIdRaw] = toolCall.id.split("|");
					let itemId: string | undefined = itemIdRaw;
					if (isDifferentModel && itemId?.startsWith("fc_")) itemId = undefined;
					output.push({
						type: "function_call",
						id: itemId,
						call_id: callId,
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.arguments),
					});
				}
			}
			if (output.length === 0) continue;
			messages.push(...output);
		} else if (msg.role === "toolResult") {
			const textResult = msg.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			const hasImages = msg.content.some((c) => c.type === "image");
			const hasText = textResult.length > 0;
			const [callId] = msg.toolCallId.split("|");
			messages.push({
				type: "function_call_output",
				call_id: callId,
				output: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
			});

			if (hasImages && model.input.includes("image")) {
				const contentParts: ResponseInputContent[] = [];
				contentParts.push({ type: "input_text", text: "Attached image(s) from tool result:" } satisfies ResponseInputText);
				for (const block of msg.content) {
					if (block.type === "image") {
						contentParts.push({
							type: "input_image",
							detail: "auto",
							image_url: `data:${block.mimeType};base64,${block.data}`,
						} satisfies ResponseInputImage);
					}
				}
				messages.push({ role: "user", content: contentParts });
			}
		}
		msgIndex++;
	}

	return messages;
}

function convertResponsesTools(tools: Tool[]): OpenAITool[] {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as unknown as OpenAITool["parameters"],
		strict: null,
	}));
}

function mapStopReason(status: string | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		case "in_progress":
		case "queued":
			return "stop";
		default:
			return "stop";
	}
}

async function processResponsesStreamLocal<TApi extends Api>(
	openaiStream: AsyncIterable<ResponseStreamEvent>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
): Promise<void> {
	let currentItem: ResponseReasoningItem | ResponseOutputMessage | ResponseFunctionToolCall | null = null;
	let currentBlock: ThinkingContent | TextContent | (ToolCall & { partialJson: string }) | null = null;
	const blocks = output.content;
	const blockIndex = () => blocks.length - 1;

	for await (const event of openaiStream) {
		if (event.type === "response.output_item.added") {
			const item = event.item;
			if (item.type === "reasoning") {
				currentItem = item;
				currentBlock = { type: "thinking", thinking: "" };
				output.content.push(currentBlock);
				stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
			} else if (item.type === "message") {
				currentItem = item;
				currentBlock = { type: "text", text: "" };
				output.content.push(currentBlock);
				stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
			} else if (item.type === "function_call") {
				currentItem = item;
				currentBlock = {
					type: "toolCall",
					id: `${item.call_id}|${item.id}`,
					name: item.name,
					arguments: {},
					partialJson: item.arguments || "",
				};
				output.content.push(currentBlock);
				stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
			}
		} else if (event.type === "response.reasoning_summary_part.added") {
			if (currentItem && currentItem.type === "reasoning") {
				currentItem.summary = currentItem.summary || [];
				currentItem.summary.push(event.part);
			}
		} else if (event.type === "response.reasoning_summary_text.delta") {
			if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
				currentItem.summary = currentItem.summary || [];
				const lastPart = currentItem.summary[currentItem.summary.length - 1];
				if (lastPart) {
					currentBlock.thinking += event.delta;
					lastPart.text += event.delta;
					stream.push({ type: "thinking_delta", contentIndex: blockIndex(), delta: event.delta, partial: output });
				}
			}
		} else if (event.type === "response.reasoning_summary_part.done") {
			if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
				currentItem.summary = currentItem.summary || [];
				const lastPart = currentItem.summary[currentItem.summary.length - 1];
				if (lastPart) {
					currentBlock.thinking += "\n\n";
					lastPart.text += "\n\n";
					stream.push({ type: "thinking_delta", contentIndex: blockIndex(), delta: "\n\n", partial: output });
				}
			}
		} else if (event.type === "response.content_part.added") {
			if (currentItem?.type === "message") {
				currentItem.content = currentItem.content || [];
				if (event.part.type === "output_text" || event.part.type === "refusal") currentItem.content.push(event.part);
			}
		} else if (event.type === "response.output_text.delta") {
			if (currentItem?.type === "message" && currentBlock?.type === "text") {
				if (!currentItem.content || currentItem.content.length === 0) continue;
				const lastPart = currentItem.content[currentItem.content.length - 1];
				if (lastPart?.type === "output_text") {
					currentBlock.text += event.delta;
					lastPart.text += event.delta;
					stream.push({ type: "text_delta", contentIndex: blockIndex(), delta: event.delta, partial: output });
				}
			}
		} else if (event.type === "response.refusal.delta") {
			if (currentItem?.type === "message" && currentBlock?.type === "text") {
				if (!currentItem.content || currentItem.content.length === 0) continue;
				const lastPart = currentItem.content[currentItem.content.length - 1];
				if (lastPart?.type === "refusal") {
					currentBlock.text += event.delta;
					lastPart.refusal += event.delta;
					stream.push({ type: "text_delta", contentIndex: blockIndex(), delta: event.delta, partial: output });
				}
			}
		} else if (event.type === "response.function_call_arguments.delta") {
			if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
				currentBlock.partialJson += event.delta;
				currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
				stream.push({ type: "toolcall_delta", contentIndex: blockIndex(), delta: event.delta, partial: output });
			}
		} else if (event.type === "response.function_call_arguments.done") {
			if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
				currentBlock.partialJson = event.arguments;
				currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
			}
		} else if (event.type === "response.output_item.done") {
			const item = event.item;
			if (item.type === "reasoning" && currentBlock?.type === "thinking") {
				currentBlock.thinking = item.summary?.map((s) => s.text).join("\n\n") || "";
				currentBlock.thinkingSignature = JSON.stringify(item);
				stream.push({ type: "thinking_end", contentIndex: blockIndex(), content: currentBlock.thinking, partial: output });
				currentBlock = null;
			} else if (item.type === "message" && currentBlock?.type === "text") {
				currentBlock.text = item.content.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("");
				currentBlock.textSignature = item.id;
				stream.push({ type: "text_end", contentIndex: blockIndex(), content: currentBlock.text, partial: output });
				currentBlock = null;
			} else if (item.type === "function_call") {
				const args =
					currentBlock?.type === "toolCall" && currentBlock.partialJson
						? parseStreamingJson(currentBlock.partialJson)
						: parseStreamingJson(item.arguments || "{}");
				const toolCall: ToolCall = {
					type: "toolCall",
					id: `${item.call_id}|${item.id}`,
					name: item.name,
					arguments: args,
				};
				currentBlock = null;
				stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
			}
		} else if (event.type === "response.completed") {
			const response = event.response;
			if (response?.usage) {
				const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
				output.usage = {
					input: (response.usage.input_tokens || 0) - cachedTokens,
					output: response.usage.output_tokens || 0,
					cacheRead: cachedTokens,
					cacheWrite: 0,
					totalTokens: response.usage.total_tokens || 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
			}
			calculateCost(model, output.usage);
			output.stopReason = mapStopReason(response?.status);
			if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
				output.stopReason = "toolUse";
			}
		} else if (event.type === "error") {
			throw new Error(`Error Code ${event.code}: ${event.message}` || "Unknown error");
		} else if (event.type === "response.failed") {
			throw new Error("Unknown error");
		}
	}
}

function buildRequestBody(model: Model<Api>, context: Context, options?: CodexStreamOptions): RequestBody {
	const messages = convertResponsesMessages(model, context);
	const body: RequestBody = {
		model: model.id,
		store: false,
		stream: true,
		instructions: context.systemPrompt,
		input: messages,
		text: { verbosity: options?.textVerbosity ?? "medium" },
		include: ["reasoning.encrypted_content"],
		prompt_cache_key: options?.sessionId,
		tool_choice: "auto",
		parallel_tool_calls: true,
	};

	if (options?.temperature !== undefined) body.temperature = options.temperature;
	if (context.tools) body.tools = convertResponsesTools(context.tools);
	if (options?.reasoningEffort !== undefined) {
		body.reasoning = {
			effort: clampReasoningEffort(model.id, options.reasoningEffort),
			summary: options.reasoningSummary ?? "auto",
		};
	}

	return body;
}

function extractAccountId(token: string): string {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error("Invalid token");
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
		const auth = payload[JWT_CLAIM_PATH] as { chatgpt_account_id?: unknown } | undefined;
		const accountId = typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined;
		if (!accountId) throw new Error("No account ID in token");
		return accountId;
	} catch {
		throw new Error("Failed to extract accountId from token");
	}
}

function resolveCodexUrl(baseUrl?: string): string {
	const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
	const normalized = raw.replace(/\/+$/, "");
	if (normalized.endsWith("/codex/responses")) return normalized;
	if (normalized.endsWith("/codex")) return `${normalized}/responses`;
	return `${normalized}/codex/responses`;
}

function buildHeaders(
	initHeaders: Record<string, string> | undefined,
	additionalHeaders: Record<string, string> | undefined,
	accountId: string,
	token: string,
	sessionId?: string,
): Headers {
	const headers = new Headers(initHeaders);
	headers.set("Authorization", `Bearer ${token}`);
	headers.set("chatgpt-account-id", accountId);
	headers.set("OpenAI-Beta", "responses=experimental");
	headers.set("originator", "pi");
	headers.set("User-Agent", `pi (${os.platform()} ${os.release()}; ${os.arch()})`);
	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");
	for (const [key, value] of Object.entries(additionalHeaders ?? {})) headers.set(key, value);
	if (sessionId) headers.set("session_id", sessionId);
	return headers;
}

function isRetryableError(status: number, errorText: string): boolean {
	if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
	return /rate.?limit|overloaded|service.?unavailable|upstream.?connect|connection.?refused/i.test(errorText);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Request was aborted"));
			return;
		}
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timeout);
			reject(new Error("Request was aborted"));
		});
	});
}

async function parseErrorResponse(response: Response): Promise<{ message: string; friendlyMessage?: string }> {
	const raw = await response.text();
	let message = raw || response.statusText || "Request failed";
	let friendlyMessage: string | undefined;

	try {
		const parsed = JSON.parse(raw) as {
			error?: { code?: string; type?: string; message?: string; plan_type?: string; resets_at?: number };
		};
		const err = parsed.error;
		if (err) {
			const code = err.code || err.type || "";
			if (/usage_limit_reached|usage_not_included|rate_limit_exceeded/i.test(code) || response.status === 429) {
				const plan = err.plan_type ? ` (${err.plan_type.toLowerCase()} plan)` : "";
				const mins =
					typeof err.resets_at === "number"
						? Math.max(0, Math.round((err.resets_at * 1000 - Date.now()) / 60000))
						: undefined;
				const when = mins !== undefined ? ` Try again in ~${mins} min.` : "";
				friendlyMessage = `You have hit your ChatGPT usage limit${plan}.${when}`.trim();
			}
			message = err.message || friendlyMessage || message;
		}
	} catch {
		// ignore parse failures
	}

	return { message, friendlyMessage };
}

function normalizeCodexStatus(status: unknown): CodexResponseStatus | undefined {
	if (typeof status !== "string") return undefined;
	return CODEX_RESPONSE_STATUSES.has(status as CodexResponseStatus) ? (status as CodexResponseStatus) : undefined;
}

async function* parseSSE(response: Response): AsyncGenerator<Record<string, unknown>> {
	if (!response.body) return;

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let idx = buffer.indexOf("\n\n");
		while (idx !== -1) {
			const chunk = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);

			const dataLines = chunk
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trim());

			if (dataLines.length > 0) {
				const data = dataLines.join("\n").trim();
				if (data && data !== "[DONE]") {
					try {
						yield JSON.parse(data) as Record<string, unknown>;
					} catch {
						// ignore malformed chunk
					}
				}
			}

			idx = buffer.indexOf("\n\n");
		}
	}
}

async function* mapCodexEvents(
	events: AsyncIterable<Record<string, unknown>>,
	onResponseCompleted: (response: { model?: string }) => void,
): AsyncGenerator<ResponseStreamEvent> {
	for await (const event of events) {
		const type = typeof event.type === "string" ? event.type : undefined;
		if (!type) continue;

		if (type === "error") {
			const code = typeof event.code === "string" ? event.code : "";
			const message = typeof event.message === "string" ? event.message : "";
			throw new Error(`Codex error: ${message || code || JSON.stringify(event)}`);
		}

		if (type === "response.failed") {
			const response = event.response as { error?: { message?: string } } | undefined;
			throw new Error(response?.error?.message || "Codex response failed");
		}

		if (type === "response.done" || type === "response.completed") {
			const response = event.response as { status?: unknown; model?: unknown } | undefined;
			const responseModel = typeof response?.model === "string" ? response.model : undefined;
			onResponseCompleted({ model: responseModel });
			const normalizedResponse = response ? { ...response, status: normalizeCodexStatus(response.status) } : response;
			yield { ...event, type: "response.completed", response: normalizedResponse } as ResponseStreamEvent;
			continue;
		}

		yield event as unknown as ResponseStreamEvent;
	}
}

function createGuardedCodexStreamSimple(
	state: GuardState,
	mismatchByTimestamp: Map<number, GuardMismatchEntry>,
): (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream {
	return (model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream => {
		const stream = new AssistantMessageEventStream();
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "openai-codex-responses" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		(async () => {
			const guardEnabledForRequest = state.enabled;
			const shouldCheckDowngrade = guardEnabledForRequest && isExpectedModelId(model.id);
			let mismatch: GuardMismatchEntry | undefined;

			try {
				const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
				if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);

				const accountId = extractAccountId(apiKey);
				const reasoningEffort = supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning);
				const codexOptions: CodexStreamOptions = {
					...options,
					reasoningEffort,
				};
				const body = buildRequestBody(model, context, codexOptions);
				options?.onPayload?.(body);

				const headers = buildHeaders(model.headers, options?.headers, accountId, apiKey, options?.sessionId);
				const bodyJson = JSON.stringify(body);

				let response: Response | undefined;
				let lastError: Error | undefined;
				for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
					if (options?.signal?.aborted) throw new Error("Request was aborted");
					try {
						response = await fetch(resolveCodexUrl(model.baseUrl), {
							method: "POST",
							headers,
							body: bodyJson,
							signal: options?.signal,
						});

						if (response.ok) break;

						const errorText = await response.text();
						if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
							await sleep(BASE_DELAY_MS * 2 ** attempt, options?.signal);
							continue;
						}

						const fakeResponse = new Response(errorText, { status: response.status, statusText: response.statusText });
						const info = await parseErrorResponse(fakeResponse);
						throw new Error(info.friendlyMessage || info.message);
					} catch (error) {
						if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
							throw new Error("Request was aborted");
						}
						lastError = error instanceof Error ? error : new Error(String(error));
						if (attempt < MAX_RETRIES && !lastError.message.includes("usage limit")) {
							await sleep(BASE_DELAY_MS * 2 ** attempt, options?.signal);
							continue;
						}
						throw lastError;
					}
				}

				if (!response?.ok) throw lastError ?? new Error("Failed after retries");
				if (!response.body) throw new Error("No response body");

				stream.push({ type: "start", partial: output });
				await processResponsesStreamLocal(
					mapCodexEvents(parseSSE(response), ({ model: responseModel }) => {
						if (responseModel) {
							output.model = responseModel;
							if (shouldCheckDowngrade) {
								if (!isExpectedModelId(responseModel)) {
									mismatch = {
										requestedProvider: TARGET_PROVIDER,
										requestedModel: TARGET_MODEL,
										receivedProvider: model.provider,
										receivedModel: responseModel,
										timestamp: Date.now(),
									};
								} else {
									mismatch = undefined;
								}
							}
						} else if (shouldCheckDowngrade) {
							mismatch = {
								requestedProvider: TARGET_PROVIDER,
								requestedModel: TARGET_MODEL,
								receivedProvider: model.provider,
								receivedModel: "<missing response.model>",
								timestamp: Date.now(),
							};
						}
					}),
					output,
					stream,
					model,
				);

				if (mismatch) mismatchByTimestamp.set(output.timestamp, mismatch);
				if (options?.signal?.aborted) throw new Error("Request was aborted");

				stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
				stream.end();
			} catch (error) {
				output.stopReason = options?.signal?.aborted ? "aborted" : "error";
				output.errorMessage = error instanceof Error ? error.message : String(error);
				stream.push({ type: "error", reason: output.stopReason, error: output });
				stream.end();
			}
		})();

		return stream;
	};
}

export default function codexModelGuardExtension(pi: ExtensionAPI): void {
	const state: GuardState = { enabled: true };
	let downgradeDetected = false;
	const mismatchByTimestamp = new Map<number, GuardMismatchEntry>();

	const persistState = () => {
		pi.appendEntry<GuardState>(STATE_ENTRY_TYPE, { enabled: state.enabled });
	};

	pi.registerProvider(TARGET_PROVIDER, {
		api: "openai-codex-responses",
		streamSimple: createGuardedCodexStreamSimple(state, mismatchByTimestamp),
	});

	pi.registerFlag("codex-guard", {
		description: "Enable codex downgrade warning guard (checks response.completed.model for gpt-5.3-codex requests)",
		type: "boolean",
		default: true,
	});

	pi.registerCommand("codex-guard", {
		description: "Control codex downgrade guard (/codex-guard on|off|status|test|clear)",
		handler: async (args, ctx) => {
			const normalized = args.trim().toLowerCase();

			if (normalized === "status") {
				if (ctx.hasUI) ctx.ui.notify(`codex guard ${state.enabled ? "enabled" : "disabled"}`, "info");
				updateStatus(ctx, state.enabled, downgradeDetected);
				return;
			}

			if (normalized === "test") {
				downgradeDetected = true;
				updateStatus(ctx, state.enabled, downgradeDetected);
				const mismatch: GuardMismatchEntry = {
					requestedProvider: TARGET_PROVIDER,
					requestedModel: TARGET_MODEL,
					receivedProvider: TARGET_PROVIDER,
					receivedModel: "gpt-5.2-codex (synthetic test)",
					timestamp: Date.now(),
				};
				pi.appendEntry<GuardMismatchEntry>(MISMATCH_ENTRY_TYPE, mismatch);
				if (ctx.hasUI) {
					ctx.ui.notify(
						`codex model downgrade detected: requested ${mismatch.requestedProvider}/${mismatch.requestedModel}, received ${mismatch.receivedProvider}/${mismatch.receivedModel}`,
						"error",
					);
				}
				return;
			}

			if (normalized === "clear" || normalized === "reset") {
				downgradeDetected = false;
				updateStatus(ctx, state.enabled, downgradeDetected);
				if (ctx.hasUI) ctx.ui.notify("codex guard alert state cleared", "info");
				return;
			}

			if (normalized === "on" || normalized === "enable" || normalized === "enabled") {
				state.enabled = true;
			} else if (normalized === "off" || normalized === "disable" || normalized === "disabled") {
				state.enabled = false;
			} else {
				state.enabled = !state.enabled;
			}

			persistState();
			updateStatus(ctx, state.enabled, downgradeDetected);
			if (ctx.hasUI) ctx.ui.notify(`codex guard ${state.enabled ? "enabled" : "disabled"}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const flagValue = pi.getFlag("codex-guard");
		if (typeof flagValue === "boolean") state.enabled = flagValue;

		const persistedEnabled = parseGuardStateEntry(ctx.sessionManager.getEntries());
		if (persistedEnabled !== undefined) state.enabled = persistedEnabled;

		downgradeDetected = false;
		updateStatus(ctx, state.enabled, downgradeDetected);
	});

	pi.on("message_end", async (event, ctx) => {
		if (!state.enabled) return;
		if (!isAssistantMessageLike(event.message)) return;
		if (event.message.provider !== TARGET_PROVIDER) return;

		const mismatch = mismatchByTimestamp.get(event.message.timestamp);
		if (!mismatch) return;
		mismatchByTimestamp.delete(event.message.timestamp);

		downgradeDetected = true;
		updateStatus(ctx, state.enabled, downgradeDetected);
		pi.appendEntry<GuardMismatchEntry>(MISMATCH_ENTRY_TYPE, mismatch);
		if (ctx.hasUI) {
			ctx.ui.notify(
				`codex model downgrade detected: requested ${mismatch.requestedProvider}/${mismatch.requestedModel}, received ${mismatch.receivedProvider}/${mismatch.receivedModel}`,
				"error",
			);
		}
	});

	pi.on("model_select", async (_event, ctx) => {
		updateStatus(ctx, state.enabled, downgradeDetected);
	});
}
