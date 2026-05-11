const fs = require("node:fs");

const API_BASE = "https://api.hexagate.com";
const GOV_VAULT_TAG_NAME = "GOV-Vault";
const TAG_KIND_ADDRESS = 1;
const ENTITY_TYPE_CONTRACT = 1;
const ENTITY_PARAM_TYPE = 1;
const TAG_PAGE_SIZE = 300;
const ENTITY_RESOLVE_PAGE_SIZE = 200;
const ADD_BATCH_SIZE = 50;
const DELETE_BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_MAX_RETRIES = 2;
const REQUEST_RETRY_BASE_MS = 1_000;

main().catch((err) => {
	process.stderr.write(`ERROR: ${err.stack || err.message || err}\n`);
	process.exit(1);
});

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const apiKey = process.env.HEXAGATE_API_KEY;
	if (!apiKey) throw Error("HEXAGATE_API_KEY env var is required");

	const http = createClient(apiKey);

	log("Fetching Hexagate chain registry…");
	const supportedChains = await fetchSupportedChains(http);
	log(`Found ${supportedChains.size} monitorable chains`);

	log("Fetching kind=1 tag inventory…");
	const allTags = await fetchAllAddressTags(http);
	const byName = new Map(allTags.map((t) => [t.name, t]));
	const govVault = byName.get(GOV_VAULT_TAG_NAME);
	if (!govVault) {
		throw Error(
			`'${GOV_VAULT_TAG_NAME}' tag not found in Hexagate; refusing to proceed`,
		);
	}
	log(`Found GOV-Vault tag id=${govVault.id}`);

	log("Fetching current GOV-Vault membership…");
	const govSnapshot = await http.get(
		`/api/v1/monitoring/monitor_tags/${govVault.id}`,
	);
	const govByChain = normalizeEntitiesByChain(govSnapshot.entities_by_chain);

	const chainDirs = fs
		.readdirSync(".")
		.filter((d) => /^\d+$/.test(d))
		.map((d) => Number(d))
		.filter((d) => !args.only || args.only.has(d))
		.sort((a, b) => a - b);

	if (args.only) {
		const missing = [...args.only].filter((c) => !chainDirs.includes(c));
		if (missing.length > 0) {
			throw Error(
				`--only references chains with no labels directory: ${missing.join(", ")}`,
			);
		}
	}

	const plan = [];
	for (const chainId of chainDirs) {
		const desired = readDesiredVaults(chainId);
		const current = govByChain.get(chainId) ?? new Set();

		if (!supportedChains.has(chainId)) {
			plan.push({
				chainId,
				skipped: "chain not supported by Hexagate (not monitorable)",
				desired,
				current,
				toAdd: new Set(),
				toRemove: current,
				chainTag: null,
			});
			continue;
		}

		const chainTag = discoverChainTag(allTags, chainId);
		if (!chainTag) {
			plan.push({
				chainId,
				skipped:
					"no per-chain tag in Hexagate (no monitor configured for this chain)",
				desired,
				current,
				toAdd: new Set(),
				toRemove: new Set(),
				chainTag: null,
			});
			continue;
		}

		const toAdd = setDiff(desired, current);
		const toRemove = setDiff(current, desired);
		plan.push({
			chainId,
			skipped: null,
			desired,
			current,
			toAdd,
			toRemove,
			chainTag,
		});
	}

	if (args.mode === "apply") {
		for (const entry of plan) {
			if (entry.toAdd.size > 0) {
				await applyAdds(http, entry, govVault);
			}
			if (entry.toRemove.size > 0) {
				await applyRemoves(http, entry);
			}
		}
	}

	process.stdout.write(renderSummary(plan, args.mode));
}

function parseArgs(argv) {
	let mode = null;
	let only = null;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--dry-run" || a === "--apply") {
			if (mode) throw Error("specify exactly one of --dry-run or --apply");
			mode = a === "--dry-run" ? "dry-run" : "apply";
		} else if (a === "--only") {
			const next = argv[++i];
			if (!next) throw Error("--only requires a comma-separated chainId list");
			only = new Set(
				next.split(",").map((s) => {
					const n = Number(s.trim());
					if (!Number.isInteger(n) || n <= 0) {
						throw Error(`--only: invalid chainId: ${s}`);
					}
					return n;
				}),
			);
		} else if (a.startsWith("--only=")) {
			only = new Set(
				a
					.slice("--only=".length)
					.split(",")
					.map((s) => {
						const n = Number(s.trim());
						if (!Number.isInteger(n) || n <= 0) {
							throw Error(`--only: invalid chainId: ${s}`);
						}
						return n;
					}),
			);
		} else {
			throw Error(`unknown argument: ${a}`);
		}
	}
	if (!mode) throw Error("specify exactly one of --dry-run or --apply");
	return { mode, only };
}

function createClient(apiKey) {
	const headers = {
		"X-Hexagate-Api-Key": apiKey,
		Accept: "application/json",
	};

	async function request(method, path, { query, body } = {}) {
		const url = new URL(API_BASE + path);
		if (query) {
			for (const [k, v] of Object.entries(query)) {
				if (v === undefined || v === null) continue;
				if (Array.isArray(v)) {
					for (const item of v) url.searchParams.append(k, String(item));
				} else {
					url.searchParams.set(k, String(v));
				}
			}
		}
		const init = { method, headers: { ...headers } };
		if (body !== undefined) {
			init.headers["Content-Type"] = "application/json";
			init.body = JSON.stringify(body);
		}

		let lastErr = null;
		for (let attempt = 0; attempt <= REQUEST_MAX_RETRIES; attempt++) {
			try {
				const res = await fetch(url, {
					...init,
					signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
				});
				if (res.status >= 500 && attempt < REQUEST_MAX_RETRIES) {
					const text = await res.text();
					lastErr = Error(`${method} ${path} → HTTP ${res.status}: ${text}`);
					log(
						`retry ${attempt + 1}/${REQUEST_MAX_RETRIES}: ${method} ${path} (HTTP ${res.status})`,
					);
					await sleep(REQUEST_RETRY_BASE_MS * 2 ** attempt);
					continue;
				}
				if (!res.ok) {
					const text = await res.text();
					throw Error(`${method} ${path} → HTTP ${res.status}: ${text}`);
				}
				if (res.status === 204) return null;
				const ct = res.headers.get("content-type") || "";
				return ct.includes("application/json") ? res.json() : res.text();
			} catch (err) {
				if (attempt < REQUEST_MAX_RETRIES && isTransient(err)) {
					lastErr = err;
					log(
						`retry ${attempt + 1}/${REQUEST_MAX_RETRIES}: ${method} ${path} (${err.message || err})`,
					);
					await sleep(REQUEST_RETRY_BASE_MS * 2 ** attempt);
					continue;
				}
				throw err;
			}
		}
		throw lastErr;
	}

	return {
		get: (path, query) => request("GET", path, { query }),
		post: (path, body, query) => request("POST", path, { body, query }),
		delete: (path, query) => request("DELETE", path, { query }),
	};
}

async function fetchSupportedChains(http) {
	const res = await http.get("/api/v1/chains/");
	const out = new Set();
	for (const [k, info] of Object.entries(res ?? {})) {
		const cid = Number(k);
		if (!Number.isFinite(cid) || cid <= 0) continue;
		if (info?.chain_type !== "evm") continue;
		if (!info?.concord_support) continue;
		if (!info?.included_in_plan) continue;
		if (info?.is_testnet) continue;
		out.add(cid);
	}
	return out;
}

async function fetchAllAddressTags(http) {
	const items = [];
	for (let page = 1; ; page++) {
		const res = await http.get("/api/v1/monitoring/monitor_tags/", {
			page,
			page_size: TAG_PAGE_SIZE,
			kind: TAG_KIND_ADDRESS,
		});
		const got = res.items ?? [];
		items.push(...got);
		if (got.length < TAG_PAGE_SIZE) break;
	}
	return items;
}

function normalizeEntitiesByChain(ebc) {
	const out = new Map();
	for (const [k, addrs] of Object.entries(ebc ?? {})) {
		out.set(Number(k), new Set(addrs.map((a) => a.toLowerCase())));
	}
	return out;
}

function discoverChainTag(allTags, chainId) {
	const candidates = [];
	for (const t of allTags) {
		const ebc = t.entities_by_chain ?? {};
		const keys = Object.keys(ebc).map(Number);
		if (keys.length !== 1 || keys[0] !== chainId) continue;
		candidates.push({ tag: t, n: ebc[String(chainId)].length });
	}
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.n - a.n);
	if (candidates.length > 1) {
		const others = candidates
			.slice(1)
			.map((c) => `${c.tag.name}=${c.n}`)
			.join(", ");
		log(
			`chain ${chainId}: ${candidates.length} candidate per-chain tags, picking '${candidates[0].tag.name}' (${candidates[0].n}) over [${others}]`,
		);
	}
	return candidates[0].tag;
}

function readDesiredVaults(chainId) {
	const products = JSON.parse(
		fs.readFileSync(`${chainId}/products.json`).toString(),
	);
	const out = new Set();
	for (const product of Object.values(products)) {
		for (const addr of product.vaults ?? []) out.add(addr.toLowerCase());
		for (const addr of product.deprecatedVaults ?? [])
			out.add(addr.toLowerCase());
	}
	return out;
}

function setDiff(a, b) {
	const out = new Set();
	for (const x of a) if (!b.has(x)) out.add(x);
	return out;
}

async function applyAdds(http, entry, govVault) {
	const addrs = [...entry.toAdd];
	log(`chain ${entry.chainId}: adding ${addrs.length} entities…`);
	const govTag = {
		id: govVault.id,
		name: govVault.name,
		kind: TAG_KIND_ADDRESS,
	};
	const chainTag = {
		id: entry.chainTag.id,
		name: entry.chainTag.name,
		kind: TAG_KIND_ADDRESS,
	};
	const existing = await fetchEntities(http, entry.chainId, addrs);
	for (let i = 0; i < addrs.length; i += ADD_BATCH_SIZE) {
		const slice = addrs.slice(i, i + ADD_BATCH_SIZE);
		const body = [];
		for (const address of slice) {
			const ex = existing.get(address);
			if (ex) {
				const existingTags = (ex.monitor_tags ?? []).map((t) => ({
					id: t.id,
					name: t.name,
					kind: t.kind,
				}));
				const ids = new Set(existingTags.map((t) => t.id));
				const merged = [...existingTags];
				if (!ids.has(govTag.id)) merged.push(govTag);
				if (!ids.has(chainTag.id)) merged.push(chainTag);
				if (merged.length === existingTags.length) continue;
				body.push({
					id: ex.id,
					monitor_tags: merged,
					monitor_entity: {
						entity_type: ENTITY_TYPE_CONTRACT,
						params: {
							type: ENTITY_PARAM_TYPE,
							address,
							chain_id: entry.chainId,
						},
					},
				});
			} else {
				body.push({
					monitor_tags: [govTag, chainTag],
					monitor_entity: {
						entity_type: ENTITY_TYPE_CONTRACT,
						params: {
							type: ENTITY_PARAM_TYPE,
							address,
							chain_id: entry.chainId,
						},
					},
				});
			}
		}
		if (body.length === 0) continue;
		await http.post("/api/v1/monitoring/entities_metadata/batch", body);
	}
}

async function applyRemoves(http, entry) {
	const addrs = [...entry.toRemove];
	log(`chain ${entry.chainId}: removing ${addrs.length} entities…`);
	const existing = await fetchEntities(http, entry.chainId, addrs);
	const ids = [...existing.values()].map((e) => e.id);
	for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
		const slice = ids.slice(i, i + DELETE_BATCH_SIZE);
		await http.delete("/api/v1/monitoring/entities_metadata/batch", {
			ids: slice,
		});
	}
}

async function fetchEntities(http, chainId, addresses) {
	const out = new Map();
	for (let i = 0; i < addresses.length; i += ENTITY_RESOLVE_PAGE_SIZE) {
		const slice = addresses.slice(i, i + ENTITY_RESOLVE_PAGE_SIZE);
		let page = 1;
		for (;;) {
			const res = await http.get("/api/v1/monitoring/entities_metadata/", {
				page,
				page_size: ENTITY_RESOLVE_PAGE_SIZE,
				chains: [chainId],
				addresses: slice,
			});
			const got = res.items ?? [];
			for (const it of got) {
				const addr = it.monitor_entity?.params?.address?.toLowerCase();
				if (addr) out.set(addr, it);
			}
			if (got.length < ENTITY_RESOLVE_PAGE_SIZE) break;
			page += 1;
		}
	}
	return out;
}

function renderSummary(plan, mode) {
	const lines = [];
	lines.push(`# Hexagate sync — ${mode === "apply" ? "applied" : "dry-run"}`);
	lines.push("");
	lines.push("| chain | desired | hexagate | +adds | -removes | status |");
	lines.push("|---|---:|---:|---:|---:|---|");
	let totalAdd = 0;
	let totalRemove = 0;
	for (const e of plan) {
		const status = e.skipped ? `skipped: ${e.skipped}` : "ok";
		lines.push(
			`| ${e.chainId} | ${e.desired.size} | ${e.current.size} | ${e.toAdd.size} | ${e.toRemove.size} | ${status} |`,
		);
		totalAdd += e.toAdd.size;
		totalRemove += e.toRemove.size;
	}
	lines.push(`| **total** |  |  | **${totalAdd}** | **${totalRemove}** |  |`);
	lines.push("");

	for (const e of plan) {
		if (e.toAdd.size === 0 && e.toRemove.size === 0) continue;
		const heading = e.skipped
			? `chain ${e.chainId}: cleanup -${e.toRemove.size} (${e.skipped})`
			: `chain ${e.chainId}: +${e.toAdd.size} / -${e.toRemove.size}`;
		lines.push(`<details><summary>${heading}</summary>`);
		lines.push("");
		if (e.toAdd.size > 0) {
			lines.push("**Add:**");
			lines.push("");
			for (const a of [...e.toAdd].sort()) lines.push(`- \`${a}\``);
			lines.push("");
		}
		if (e.toRemove.size > 0) {
			lines.push("**Remove:**");
			lines.push("");
			for (const a of [...e.toRemove].sort()) lines.push(`- \`${a}\``);
			lines.push("");
		}
		lines.push("</details>");
		lines.push("");
	}

	const skipped = plan.filter((e) => e.skipped);
	if (skipped.length > 0) {
		lines.push("**Skipped chains (no sync):**");
		lines.push("");
		for (const e of skipped) {
			const cleanup =
				e.toRemove.size > 0
					? ` — cleaning up ${e.toRemove.size} stale entry(ies)`
					: "";
			lines.push(`- \`${e.chainId}\` — ${e.skipped}${cleanup}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function log(msg) {
	process.stderr.write(`${msg}\n`);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(err) {
	if (!err) return false;
	if (err.name === "TimeoutError" || err.name === "AbortError") return true;
	const code = err.cause?.code ?? err.code;
	return (
		code === "ECONNRESET" ||
		code === "ETIMEDOUT" ||
		code === "ECONNREFUSED" ||
		code === "EAI_AGAIN" ||
		code === "ENOTFOUND"
	);
}
