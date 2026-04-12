import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import {
	createBashTool,
	formatSize,
	SettingsManager,
	type BashToolDetails,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

const MAX_BASH_OUTPUT_BYTES = 20 * 1024;

function getTextContentBytes(content: Array<TextContent | ImageContent>): number {
	const text = content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return Buffer.byteLength(text, "utf-8");
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
		description:
			"Execute a bash command in the current working directory. Enforces a strict 20KB output limit and returns an error if exceeded. Use narrower commands when output is too large.",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const shellCommandPrefix = SettingsManager.create(ctx.cwd).getShellCommandPrefix();
			const baseBash = createBashTool(ctx.cwd, {
				commandPrefix: shellCommandPrefix,
			});

			try {
				const result = await baseBash.execute(toolCallId, params, signal, onUpdate);
				const details = result.details as BashToolDetails | undefined;
				const actualBytes = getTextContentBytes(result.content);
				const fromTruncation = Boolean(details?.truncation?.truncated);

				if (fromTruncation || actualBytes > MAX_BASH_OUTPUT_BYTES) {
					throw new Error(
						buildTooLargeMessage({
							actualBytes,
							details,
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
					throw new Error(
						buildTooLargeMessage({
							actualBytes,
							fromTruncation: false,
						}),
					);
				}

				throw error;
			}
		},
	});
}
