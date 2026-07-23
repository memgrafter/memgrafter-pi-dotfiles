/**
 * World Tool — Physical item inventory management
 *
 * Manages an inventory of physical items in world.json (cwd-relative).
 * Three tools: world_create, world_transform, world_search.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
	defineTool,
	type AgentToolResult,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorldItem {
	name: string;
	metadata: Record<string, string>;
	created: string; // ISO timestamp
	modified: string; // ISO timestamp
	quantity: number;
}

interface WorldState {
	items: WorldItem[];
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

const WORLD_FILE = "world.json";

function worldPath(cwd: string): string {
	return join(cwd, WORLD_FILE);
}

function loadWorld(cwd: string): WorldState {
	if (!existsSync(worldPath(cwd))) {
		return { items: [] };
	}
	try {
		const raw = readFileSync(worldPath(cwd), "utf-8");
		const data = JSON.parse(raw) as WorldState;
		if (!Array.isArray(data.items)) {
			return { items: [] };
		}
		return data;
	} catch {
		return { items: [] };
	}
}

function saveWorld(state: WorldState, cwd: string): void {
	const path = worldPath(cwd);
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString();
const cwd = () => process.cwd();

function findByName(state: WorldState, name: string): WorldItem | undefined {
	return state.items.find((it) => it.name === name);
}

/**
 * Token-based similarity between query and item name.
 * Returns a score in [0, 1] where 1 is exact match.
 */
function tokenSimilarity(query: string, itemName: string): number {
	const tokenize = (s: string): Set<string> =>
		new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean));

	const queryTokens = tokenize(query);
	const nameTokens = tokenize(itemName);

	if (queryTokens.size === 0 || nameTokens.size === 0) return 0;

	// Exact match check first
	if (query.toLowerCase() === itemName.toLowerCase()) return 1;

	let overlap = 0;
	for (const t of queryTokens) {
		if (nameTokens.has(t)) overlap++;
	}

	// Jaccard similarity
	const union = new Set([...queryTokens, ...nameTokens]).size;
	return overlap / union;
}

// ---------------------------------------------------------------------------
// world_create
// ---------------------------------------------------------------------------

const worldCreateItemSchema = Type.Object({
	name: Type.String({ description: "Item name (unique key for matching)" }),
	metadata: Type.Optional(
		Type.Object({}, { description: "Arbitrary string-keyed metadata (description, material, etc.)" }),
	),
	quantity: Type.Optional(Type.Integer({ description: "Initial quantity (default 1)" })),
});

const worldCreateParams = Type.Object({
	items: Type.Array(worldCreateItemSchema, {
		description: "Array of items to create or update",
	}),
});

interface WorldCreateDetails {
	created: Array<{ name: string; quantity: number }>;
	conflicts: Array<{
		inputName: string;
		inputMetadata: Record<string, string>;
		existing: WorldItem;
	}>;
}

const worldCreateTool = defineTool({
	name: "world_create",
	label: "World Create",
	description:
		"Create new items in the world inventory. If any item name already exists, the entire create fails with a conflict report. Use world_transform with empty consume to add quantity to existing items.",
	promptSnippet: "world_create — create new physical items in world.json (cwd)",
	parameters: worldCreateParams,

	async execute(
		_toolCallId,
		params,
		_signal,
		_onUpdate,
		_ctx,
	): Promise<AgentToolResult<WorldCreateDetails>> {
		const state = loadWorld(cwd());
		const created: WorldCreateDetails["created"] = [];
		const nowTs = now();

		// Validate no name conflicts before writing anything
		const conflicts: WorldCreateDetails["conflicts"] = [];
		for (const input of params.items) {
			const existing = findByName(state, input.name);
			if (existing) {
				conflicts.push({
					inputName: input.name,
					inputMetadata: input.metadata ?? {},
					existing,
				});
			}
		}

		if (conflicts.length) {
			const lines: string[] = [
				`world_create failed: ${conflicts.length} name conflict(s):`,
			];
			for (const c of conflicts) {
				lines.push(
					`  "${c.inputName}" — existing: ${JSON.stringify(c.existing)}`,
				);
			}
			lines.push(
				"Use world_transform (with empty consume) to add quantity, or use a different name.",
			);
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { created: [], conflicts },
			};
		}

		// No conflicts — create all items
		for (const input of params.items) {
			const qty = input.quantity ?? 1;
			const newItem: WorldItem = {
				name: input.name,
				metadata: input.metadata ?? {},
				created: nowTs,
				modified: nowTs,
				quantity: qty,
			};
			state.items.push(newItem);
			created.push({ name: input.name, quantity: qty });
		}

		saveWorld(state, cwd());

		return {
			content: [
				{
					type: "text",
					text: `Created ${created.length} item(s): ${created.map((c) => `${c.name} (${c.quantity})`).join(", ")}`,
				},
			],
			details: { created, conflicts: [] },
		};
	},
});

// ---------------------------------------------------------------------------
// world_transform
// ---------------------------------------------------------------------------

const consumeItemSchema = Type.Object({
	name: Type.String({ description: "Item name to consume from" }),
	quantity: Type.Integer({ description: "Quantity to subtract (default 1)" }),
});

const produceItemSchema = Type.Object({
	name: Type.String({ description: "Item name to produce" }),
	metadata: Type.Optional(
		Type.Object({}, { description: "Arbitrary string-keyed metadata for the new item" }),
	),
	quantity: Type.Optional(Type.Integer({ description: "Quantity produced (default 1)" })),
});

const worldTransformParams = Type.Object({
	consume: Type.Array(consumeItemSchema, {
		description:
			"Items to subtract from inventory. Each entry reduces quantity; entries with insufficient stock cause failure.",
	}),
	produce: Type.Array(produceItemSchema, {
		description: "Items to produce (add or create).",
	}),
});

interface WorldTransformDetails {
	consumed: Array<{ name: string; quantity: number; remaining: number }>;
	produced: Array<{ name: string; quantity: number; isNew: boolean }>;
}

const worldTransformTool = defineTool({
	name: "world_transform",
	label: "World Transform",
	description:
		"Transform items: consume existing items (subtract quantity) and produce new ones. If consume target doesn't exist or has insufficient quantity, the entire transform fails. Producing an item with the same name as an existing entry adds to its quantity and replaces its metadata. Entries are never deleted (quantity 0 persists).",
	promptSnippet:
		"world_transform — consume and produce items (crafting, combining, relocating, etc.)",
	parameters: worldTransformParams,

	async execute(
		_toolCallId,
		params,
		_signal,
		_onUpdate,
		_ctx,
	): Promise<AgentToolResult<WorldTransformDetails>> {
		const state = loadWorld(cwd());
		const nowTs = now();
		const consumed: WorldTransformDetails["consumed"] = [];
		const produced: WorldTransformDetails["produced"] = [];

		// Phase 1: validate all consume targets
		for (const entry of params.consume) {
			const qty = entry.quantity ?? 1;
			const item = findByName(state, entry.name);

			if (!item) {
				throw new Error(
					`world_transform failed: "${entry.name}" not found in inventory.`,
				);
			}
			if (item.quantity < qty) {
				throw new Error(
					`world_transform failed: "${entry.name}" has ${item.quantity}, need ${qty}.`,
				);
			}
		}

		// Phase 2: consume
		for (const entry of params.consume) {
			const qty = entry.quantity ?? 1;
			const item = findByName(state, entry.name);
			item!.quantity -= qty;
			item!.modified = nowTs;
			consumed.push({ name: entry.name, quantity: qty, remaining: item!.quantity });
		}

		// Phase 3: produce
		for (const entry of params.produce) {
			const qty = entry.quantity ?? 1;
			const existing = findByName(state, entry.name);

			if (existing) {
				existing.metadata = entry.metadata ?? {};
				existing.quantity += qty;
				existing.modified = nowTs;
				produced.push({ name: entry.name, quantity: qty, isNew: false });
			} else {
				state.items.push({
					name: entry.name,
					metadata: entry.metadata ?? {},
					created: nowTs,
					modified: nowTs,
					quantity: qty,
				});
				produced.push({ name: entry.name, quantity: qty, isNew: true });
			}
		}

		saveWorld(state, cwd());

		const lines: string[] = [];
		if (consumed.length) {
			lines.push(
				`Consumed: ${consumed.map((c) => `${c.name} -${c.quantity} (${c.remaining} remaining)`).join(", ")}`,
			);
		}
		if (produced.length) {
			lines.push(
				`Produced: ${produced.map((p) => `${p.name} +${p.quantity}${p.isNew ? " (new)" : ""}`).join(", ")}`,
			);
		}

		return {
			content: [{ type: "text", text: lines.join("\n") || "Transform complete." }],
			details: { consumed, produced },
		};
	},
});

// ---------------------------------------------------------------------------
// world_search
// ---------------------------------------------------------------------------

const worldSearchParams = Type.Object({
	query: Type.String({
		description:
			"Search term. Partial token-based matching on item names. E.g. 'steel knife' matches 'steel knife 3 durability 49/50'.",
	}),
	limit: Type.Optional(Type.Integer({ description: "Max results (default 20)" })),
});

interface WorldSearchDetails {
	results: Array<WorldItem & { similarity: number }>;
	total: number;
}

const worldSearchTool = defineTool({
	name: "world_search",
	label: "World Search",
	description:
		"Search the world inventory by name. Token-based similarity matching, so partial queries work. Results sorted by similarity, then quantity.",
	promptSnippet: "world_search — search world inventory by name (token-based partial matching)",
	parameters: worldSearchParams,

	async execute(
		_toolCallId,
		params,
		_signal,
		_onUpdate,
		_ctx,
	): Promise<AgentToolResult<WorldSearchDetails>> {
		const state = loadWorld(cwd());
		const limit = params.limit ?? 20;

		if (!params.query) {
			return {
				content: [{ type: "text", text: "Provide a search query." }],
				details: { results: [], total: 0 },
			};
		}

		const scored = state.items
			.map((item) => ({
				...item,
				similarity: tokenSimilarity(params.query, item.name),
			}))
			.filter((it) => it.similarity > 0);

		scored.sort((a, b) => {
			if (b.similarity !== a.similarity) return b.similarity - a.similarity;
			return b.quantity - a.quantity;
		});

		const results = scored.slice(0, limit);

		if (results.length === 0) {
			return {
				content: [{ type: "text", text: `No items match "${params.query}".` }],
				details: { results: [], total: state.items.length },
			};
		}

		const lines: string[] = [
			`Found ${results.length} match(es) for "${params.query}":`,
		];
		for (const r of results) {
			const metaStr = Object.keys(r.metadata).length
				? ` [${Object.entries(r.metadata).map(([k, v]) => `${k}: ${v}`).join(", ")}]`
				: "";
			lines.push(
				`  ${r.quantity}x ${r.name}${metaStr} (similarity: ${r.similarity.toFixed(2)})`,
			);
		}
		if (scored.length > limit) {
			lines.push(
				`  ... and ${scored.length - limit} more (use limit parameter to see more)`,
			);
		}

		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: { results, total: state.items.length },
		};
	},
});

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerTool(worldCreateTool);
	pi.registerTool(worldTransformTool);
	pi.registerTool(worldSearchTool);
}
