import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import {
	createBashTool,
	formatSize,
	SettingsManager,
	type BashToolDetails,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

const MAX_BASH_OUTPUT_BYTES = 20 * 1024;

function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `pi-bash-${id}.log`);
}

function getTextContent(content: Array<TextContent | ImageContent>): string {
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

async function writeTempOutput(text: string): Promise<string> {
	const path = getTempFilePath();
	await writeFile(path, text);
	return path;
}

function buildTooLargeMessage(options: {
	actualBytes: number;
	details?: BashToolDetails;
	fromTruncation: boolean;
}): string {
	const parts: string[] = [];
	parts.push(
		`bash output too large (${formatSize(options.actualBytes)}), exceeding the ${formatSize(MAX_BASH_OUTPUT_BYTES)} extension limit.`,
	);
	if (options.fromTruncation) {
		parts.push("The output was already truncated by the underlying bash tool.");
	}
	if (options.details?.fullOutputPath) {
		parts.push(`Full output is available at: ${options.details.fullOutputPath}.`);
	}
	parts.push("Run a more precise command (narrow file scope, add filters, or use head/tail/grep/find/ls).");
	return parts.join(" ");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		...createBashTool(process.cwd()),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const shellCommandPrefix = SettingsManager.create(ctx.cwd).getShellCommandPrefix();
			const baseBash = createBashTool(ctx.cwd, {
				commandPrefix: shellCommandPrefix,
			});

			try {
				const result = await baseBash.execute(toolCallId, params, signal, onUpdate);
				const details = result.details as BashToolDetails | undefined;
				const outputText = getTextContent(result.content);
				const actualBytes = Buffer.byteLength(outputText, "utf-8");
				const fromTruncation = Boolean(details?.truncation?.truncated);

				if (fromTruncation || actualBytes > MAX_BASH_OUTPUT_BYTES) {
					const fullOutputPath =
						details?.fullOutputPath ??
						(actualBytes > MAX_BASH_OUTPUT_BYTES ? await writeTempOutput(outputText) : undefined);

					throw new Error(
						buildTooLargeMessage({
							actualBytes,
							details: { ...details, fullOutputPath },
							fromTruncation,
						}),
					);
				}

				return result;
			} catch (error) {
				if (!(error instanceof Error)) {
					throw error;
				}

				const actualBytes = Buffer.byteLength(error.message, "utf-8");
				if (actualBytes > MAX_BASH_OUTPUT_BYTES) {
					const fullOutputPath = await writeTempOutput(error.message);

					throw new Error(
						buildTooLargeMessage({
							actualBytes,
							details: { fullOutputPath },
							fromTruncation: false,
						}),
					);
				}

				throw error;
			}
		},
	});
}
