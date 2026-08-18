/**
 * Pi Video Extension
 *
 * Gives the agent a video-understanding path for video-capable models
 * (currently: Qwen/Qwen3.8-27B served via vLLM). A video is attached to a
 * user message, injected into the provider payload as an OpenAI-style
 * `video_url` part for the duration of the agent run, and dropped when the
 * run settles. The session file only ever stores a text marker with the
 * file path — never the video bytes — so resumed sessions never re-expose
 * the video.
 *
 * Attach a video:
 *   /video <path>           send a user message carrying the video
 *   ... @<path>.mp4 ...     reference a video in any typed input
 *   video tool              the model can attach a video itself (like `read` for images)
 *
 * vLLM note: each request appends a unique `free` atom to mp4/mov bytes so
 * the media hash never repeats across requests of a run — vLLM's P0/P1 mm
 * caches desync ("Expected a cached item for mm_hash=...") when the same
 * hash is re-sent as a reference-only feature.
 *
 * Supported extensions: .mp4 .m4v .mov .webm .mkv
 *
 * Environment:
 *   PI_VIDEO_FPS      frame sampling rate. UNSET (default) sends no
 *                     mm_processor_kwargs, so the server uses its own default
 *                     (fps=2, do_sample_frames=true) — this works on any vLLM.
 *                     SET to a non-default value sends mm_processor_kwargs.fps,
 *                     which 400s unless the vLLM server was launched with
 *                     --media-io-kwargs '{"video": {"num_frames": -1}}'.
 *   PI_VIDEO_MAX_MB   reject videos larger than this (default: 50)
 *
 * Video capability is keyed on the model itself, the way the pi catalog keys
 * image support on `Model.input`: see the VIDEO_CAPABLE_MODELS table below.
 * Add a new video-capable model there (normalized id, e.g. "qwen3.8-27b").
 *
 * Usage:
 *   pi -e ./extensions/pi-video.ts
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── Config ──────────────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS: Record<string, string> = {
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".mkv": "video/x-matroska",
};

/**
 * Video-capable models, keyed on model identity the way the pi catalog keys
 * image support on `Model.input`. Entries are normalized ids (lowercase, no
 * provider prefix); matching is case-insensitive, provider-prefix-agnostic,
 * and substring-tolerant, so "Qwen/Qwen3.8-27B" (OpenRouter) and
 * "qwen3.8-27b" (local vLLM) both match.
 */
const VIDEO_CAPABLE_MODELS = ["qwen3.8-27b", "qwen3.8-9b", "qwen3.8-2.4t-a95b"];

/**
 * Returns the explicitly-requested fps, or null when PI_VIDEO_FPS is unset.
 * We only emit mm_processor_kwargs for an explicit, non-default fps: the server
 * default is already fps=2/do_sample_frames=true, and sending the kwarg on a
 * server not launched with --media-io-kwargs '{"video":{"num_frames":-1}}'
 * makes vLLM 400 ("Failed to apply Qwen3VLProcessor").
 */
function explicitVideoFps(): number | null {
	if (process.env.PI_VIDEO_FPS === undefined) return null;
	const n = Number(process.env.PI_VIDEO_FPS);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function videoMaxBytes(): number {
	const n = Number(process.env.PI_VIDEO_MAX_MB ?? "50");
	return (Number.isFinite(n) && n > 0 ? n : 50) * 1024 * 1024;
}

// ── Attachments ─────────────────────────────────────────────────────────────

interface Attachment {
	id: number;
	path: string;
	mimeType: string;
	raw: Buffer;
	b64?: string; // cached base64 for non-atom containers (sent un-uniquified)
	active: boolean;
}

const attachments = new Map<number, Attachment>();
let nextId = 1;

/** Marker written into the (persisted) message text. The only permanent record. */
function marker(attachment: Attachment): string {
	return `[video: ${attachment.path} #${attachment.id}]`;
}

const MARKER_RE = /\[video: (.+?) #(\d+)\]/g;

function resolveVideoPath(p: string): string {
	const expanded = p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
	return path.resolve(process.cwd(), expanded);
}

function isVideoPath(p: string): boolean {
	return VIDEO_EXTENSIONS[path.extname(p).toLowerCase()] !== undefined;
}

/** Normalize a model id for matching: lowercase, drop the provider prefix ("Qwen/Qwen3.8-27B" -> "qwen3.8-27b"). */
function normalizeModelId(id: string): string {
	return id.toLowerCase().split("/").pop() ?? "";
}

function modelSupportsVideo(ctx: ExtensionContext): boolean {
	const id = ctx.model?.id;
	if (!id) return false;
	const n = normalizeModelId(id);
	return VIDEO_CAPABLE_MODELS.some((entry) => n === entry || n.includes(entry) || entry.includes(n));
}

function notifyNoVideoModel(ctx: ExtensionContext): void {
	ctx.ui.notify(`video attached, but model ${ctx.model?.id ?? "?"} is not in the video-capable model list (VIDEO_CAPABLE_MODELS) — it will not be sent`, "warning");
}

async function loadVideo(absPath: string): Promise<{ ok: true; attachment: Attachment } | { ok: false; error: string }> {
	const mimeType = VIDEO_EXTENSIONS[path.extname(absPath).toLowerCase()];
	if (!mimeType) return { ok: false, error: `not a supported video file: ${absPath}` };
	let size: number;
	try {
		size = (await fs.promises.stat(absPath)).size;
	} catch {
		return { ok: false, error: `file not found: ${absPath}` };
	}
	if (size === 0) return { ok: false, error: `empty file: ${absPath}` };
	if (size > videoMaxBytes()) {
		const mb = Math.round(size / 1024 / 1024);
		const limit = Math.round(videoMaxBytes() / 1024 / 1024);
		return { ok: false, error: `video too large (${mb}MB > ${limit}MB limit; raise PI_VIDEO_MAX_MB)` };
	}
	const bytes = await fs.promises.readFile(absPath);
	const attachment: Attachment = {
		id: nextId++,
		path: absPath,
		mimeType,
		raw: bytes,
		active: true,
	};
	attachments.set(attachment.id, attachment);
	return { ok: true, attachment };
}

// ── vLLM mm-cache desync workaround ─────────────────────────────────────────
//
// vLLM keys its P0 (API server) and P1 (engine) multimodal caches by a hash
// of the media bytes. When the *same* bytes are re-sent across requests, P0
// starts sending a reference-only feature (hash, no data), assuming P1 still
// holds the item — but P1's LRU may have evicted it, and the request then
// fails with "Expected a cached item for mm_hash=...". We therefore give
// every request its own byte string: for atom-based containers (mp4/m4v/mov)
// a `free` atom (a standard mp4 atom whose payload is ignored by demuxers)
// with a unique 16-byte payload is appended. Non-atom containers (webm/mkv)
// are sent as-is and remain exposed to the desync risk.

let uniqCounter = 0;

function uniquifiedAtomData(raw: Buffer): string {
	const payload = Buffer.alloc(16);
	payload.writeBigUInt64LE(BigInt(uniqCounter++), 0);
	crypto.randomBytes(8).copy(payload, 8);
	const atom = Buffer.alloc(24);
	atom.writeUInt32BE(24, 0);
	atom.write("free", 4, "ascii");
	atom.set(payload, 8);
	return Buffer.concat([raw, atom]).toString("base64");
}

function videoDataUrl(attachment: Attachment): string {
	const isAtomContainer = attachment.mimeType === "video/mp4" || attachment.mimeType === "video/quicktime";
	const data = isAtomContainer ? uniquifiedAtomData(attachment.raw) : (attachment.b64 ??= attachment.raw.toString("base64"));
	return `data:${attachment.mimeType};base64,${data}`;
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	// Reference a video in typed input: "describe @/tmp/clip.mp4"
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || !event.text || !event.text.includes("@")) return;
		let out = "";
		let transformed = false;
		let i = 0;
		while (i < event.text.length) {
			if (event.text[i] === "@") {
				let j = i + 1;
				while (j < event.text.length && !/\s/.test(event.text[j])) j++;
				const token = event.text.slice(i + 1, j);
				if (token && isVideoPath(token)) {
					const loaded = await loadVideo(resolveVideoPath(token));
					if (loaded.ok) {
						out += marker(loaded.attachment);
						if (!modelSupportsVideo(ctx)) notifyNoVideoModel(ctx);
					} else {
						ctx.ui.notify(`video: ${loaded.error}`, "warning");
						out += token; // keep the bare path so the user can fix and resend
					}
					transformed = true;
					i = j;
					continue;
				}
			}
			out += event.text[i];
			i++;
		}
		if (!transformed) return;
		return { action: "transform" as const, text: out };
	});

	// /video <path> — send a user message that carries the video
	pi.registerCommand("video", {
		description: "Attach a video file to a new user message (/video <path>)",
		handler: async (args, ctx) => {
			const raw = (args ?? "").trim();
			if (!raw) {
				ctx.ui.notify("usage: /video <path-to-video>", "warning");
				return;
			}
			const loaded = await loadVideo(resolveVideoPath(raw));
			if (!loaded.ok) {
				ctx.ui.notify(`video: ${loaded.error}`, "warning");
				return;
			}
			if (!modelSupportsVideo(ctx)) notifyNoVideoModel(ctx);
			pi.sendUserMessage(marker(loaded.attachment));
		},
	});

	// The model can attach videos itself, mirroring how `read` handles images.
	// The result carries only the text marker; the hook below re-emits the video
	// as a separate user message after the tool-result run (core's image pattern).
	pi.registerTool({
		name: "video",
		label: "video",
		description:
			"Attach a video file to the conversation so the model can see it (video-capable models only, e.g. Qwen3.8-27B). The video stays visible for the rest of the current run only.",
		promptSnippet: "Attach a video file so the model can see it",
		parameters: Type.Object({
			path: Type.String({ description: "Path to the video file (relative or absolute)" }),
		}),
		async execute(_toolCallId, { path: p }, _signal, _onUpdate, ctx) {
			const loaded = await loadVideo(resolveVideoPath(p));
			if (!loaded.ok) throw new Error(loaded.error);
			if (!modelSupportsVideo(ctx)) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Video found, but the current model (${ctx.model?.id ?? "?"}) is not in the video-capable model list (VIDEO_CAPABLE_MODELS). Nothing was attached.`,
						},
					],
					details: {},
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `Video attached: ${marker(loaded.attachment)} — visible to the model for the rest of this run.`,
					},
				],
				details: {},
			};
		},
	});

	// Inject the video into the provider payload while the attachment is active.
	// The payload is the built OpenAI-style body: { model, messages, ... }.
	// User messages get the video part appended in place; tool results (from the
	// `video` tool) get it re-emitted as a separate user message after the
	// tool-result run, mirroring how the core handles tool-result images.
	pi.on("before_provider_request", (event, ctx) => {
		const payload = event.payload as { messages?: unknown } | null | undefined;
		if (!payload || !Array.isArray(payload.messages) || !modelSupportsVideo(ctx)) return;

		type Part = { type?: string; text?: string };
		const messages = payload.messages as Array<{ role?: string; content?: string | Part[] }>;
		let injected = false;
		const out: Array<Record<string, unknown>> = [];
		let pendingParts: Array<Record<string, unknown>> = [];

		const flushPending = () => {
			if (pendingParts.length === 0) return;
			out.push({
				role: "user",
				content: [{ type: "text", text: "Attached video(s) from tool result:" }, ...pendingParts],
			});
			pendingParts = [];
		};

		for (const msg of messages) {
			if (msg?.role !== "tool") flushPending();
			out.push(msg);
			if (msg?.role !== "user" && msg?.role !== "tool") continue;

			const text =
				typeof msg.content === "string"
					? msg.content
					: (msg.content ?? []).map((part) => (part?.type === "text" ? part.text ?? "" : "")).join("\n");
			const parts: Array<Record<string, unknown>> = [];
			for (const match of text.matchAll(MARKER_RE)) {
				const attachment = attachments.get(Number(match[2]));
				if (!attachment || !attachment.active) continue;
				parts.push({
					type: "video_url",
					video_url: { url: videoDataUrl(attachment) },
				});
			}
			if (parts.length === 0) continue;
			injected = true;
			if (msg.role === "user") {
				msg.content = [
					...(typeof msg.content === "string" ? [{ type: "text" as const, text: msg.content }] : (msg.content ?? [])),
					...parts,
				];
			} else {
				pendingParts.push(...parts);
			}
		}
		flushPending();
		if (!injected) return;
		payload.messages = out;
		// Only override frame sampling when the user asked for a non-default fps.
		const fps = explicitVideoFps();
		if (fps === null) return;
		return { ...payload, mm_processor_kwargs: { fps, do_sample_frames: true } };
	});

	// Drop all videos once the run settles: no later request re-sends them.
	pi.on("agent_settled", () => {
		for (const attachment of attachments.values()) attachment.active = false;
	});
}
