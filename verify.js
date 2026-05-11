const fs = require("node:fs");

const ethers = require("ethers");
const imageSize = require("image-size");

const logos = {};

for (let i = 0; i < fs.readdirSync("logo/").length; i++) {
	const file = fs.readdirSync("logo/")[i];
	logos[file] = true;
}

for (const file of Object.keys(logos)) {
	const info = imageSize(`logo/${file}`);

	if (info.type !== "svg" && info.type !== "png" && info.type !== "jpg") {
		throw Error(`logo file ${file} is not SVG/PNG/JPG`);
	}

	if (info.height !== info.width && file !== "swaap.png")
		throw Error(
			`logo dimensions not square: ${file} (${info.height} x ${info.width})`,
		);
}

const VALID_VAULT_OVERRIDE_KEYS = new Set([
	"name",
	"description",
	"portfolioNotice",
	"deprecationReason",
	"block",
	"restricted",
	"notExplorableLend",
	"notExplorableBorrow",
	"keyring",
]);

const VALID_ASSET_MATCH_KEYS = new Set([
	"address",
	"symbols",
	"symbolRegex",
	"names",
	"nameRegex",
]);
const VALID_ASSET_KEYS = new Set([
	...VALID_ASSET_MATCH_KEYS,
	"block",
	"restricted",
]);
// Caps mirrored from the client/server side (server/api/labels/[file].get.ts)
// to keep locally-verified files in sync with what the proxy will accept.
const MAX_ASSET_ENTRIES = 10000;
const MAX_STRING_LEN = 16384;
const MAX_SYMBOL_LEN = 64;
const MAX_NAME_LEN = 256;
const MAX_REGEX_LEN = 512;
const COUNTRY_ALIASES = new Set(["EU", "EEA", "EFTA"]);
const ISO_ALPHA2_RE = /^[A-Za-z]{2}$/;

for (const file of fs.readdirSync(".")) {
	if (!/^\d+$/.test(file)) continue;
	validateChain(file);
}

validateGlobal();

console.log("OK");

///////////

function validateChain(chainId) {
	const entities = loadJsonFile(`${chainId}/entities.json`);
	const products = loadJsonFile(`${chainId}/products.json`);
	const points = loadJsonFile(`${chainId}/points.json`);
	const assets = loadJsonFileIfExists(`${chainId}/assets.json`) || [];

	validateUniqueEntityAddresses(entities);
	validateAssets(`${chainId}/assets.json`, assets);

	for (const entityId of Object.keys(entities)) {
		const entity = entities[entityId];

		if (!validSlug(entityId))
			throw Error(`entities: invalid slug: ${entityId}`);
		if (!entity.name) throw Error(`entities: missing name: ${entityId}`);

		for (const addr of Object.keys(entity.addresses || {})) {
			if (addr !== ethers.getAddress(addr))
				throw Error(`entities: malformed address: ${addr}`);
		}

		if (entity.logo && !logos[entity.logo])
			throw Error(`entities: logo not found: ${entity.logo}`);
	}

	const vaultsSeenInProducts = {};

	for (const productId of Object.keys(products)) {
		const product = products[productId];

		if (!validSlug(productId))
			throw Error(`products: invalid slug: ${productId}`);
		if (!product.name) throw Error(`products: missing name: ${productId}`);

		if (
			product.description !== undefined &&
			typeof product.description !== "string"
		)
			throw Error(`products: description must be a string: ${productId}`);

		for (const addr of product.vaults) {
			if (addr !== ethers.getAddress(addr))
				throw Error(
					`products: malformed vault address: ${ethers.getAddress(addr)}`,
				);
			if (vaultsSeenInProducts[addr])
				throw Error(`products: vault in multiple products: ${addr}`);
			vaultsSeenInProducts[addr] = true;
		}

		if (product.deprecatedVaults) {
			for (const addr of product.deprecatedVaults) {
				if (addr !== ethers.getAddress(addr))
					throw Error(
						`products: malformed deprecated vault address: ${ethers.getAddress(addr)}`,
					);
				if (product.vaults.includes(addr))
					throw Error(
						`products: vault ${addr} cannot be both in vaults and deprecatedVaults: ${productId}`,
					);
				if (vaultsSeenInProducts[addr])
					throw Error(`products: vault in multiple products: ${addr}`);
				vaultsSeenInProducts[addr] = true;
			}
		}

		if (product.deprecationReason !== undefined) {
			if (typeof product.deprecationReason !== "string")
				throw Error(
					`products: deprecationReason must be a string: ${productId}`,
				);
		}

		for (const entity of getArray(product.entity)) {
			if (!entities[entity]) throw Error(`products: no such entity ${entity}`);
		}

		if (product.logo && !logos[product.logo])
			throw Error(`products: logo not found: ${product.logo}`);

		if (
			product.url !== undefined &&
			product.url !== "" &&
			!validUrl(product.url)
		)
			throw Error(`products: invalid url: ${productId}`);

		if (product.portfolioNotice !== undefined) {
			if (typeof product.portfolioNotice !== "string")
				throw Error(`products: portfolioNotice must be a string: ${productId}`);
		}

		if (product.notExplorable !== undefined) {
			if (typeof product.notExplorable !== "boolean")
				throw Error(`products: notExplorable must be a boolean: ${productId}`);
		}

		if (product.isGovernanceLimited !== undefined) {
			if (typeof product.isGovernanceLimited !== "boolean")
				throw Error(
					`products: isGovernanceLimited must be a boolean: ${productId}`,
				);
		}

		if (product.keyring !== undefined) {
			if (typeof product.keyring !== "boolean")
				throw Error(`products: keyring must be a boolean: ${productId}`);
		}

		if (product.block !== undefined) {
			if (!Array.isArray(product.block))
				throw Error(`products: block must be an array: ${productId}`);
			for (const code of product.block) {
				if (typeof code !== "string")
					throw Error(`products: block entries must be strings: ${productId}`);
			}
		}

		if (product.featuredVaults) {
			for (const addr of product.featuredVaults) {
				if (addr !== ethers.getAddress(addr))
					throw Error(`products: malformed featured vault address: ${addr}`);
				if (!product.vaults.includes(addr))
					throw Error(
						`products: featured vault ${addr} not in vaults: ${productId}`,
					);
			}
		}

		if (product.vaultOverrides) {
			const allProductVaults = [
				...product.vaults,
				...(product.deprecatedVaults || []),
			];

			for (const [addr, override] of Object.entries(product.vaultOverrides)) {
				if (addr !== ethers.getAddress(addr))
					throw Error(`products: malformed vaultOverrides address: ${addr}`);
				if (!allProductVaults.includes(addr))
					throw Error(
						`products: vaultOverrides address ${addr} not in vaults or deprecatedVaults: ${productId}`,
					);

				for (const key of Object.keys(override)) {
					if (!VALID_VAULT_OVERRIDE_KEYS.has(key))
						throw Error(
							`products: unknown vaultOverrides key "${key}" for ${addr}: ${productId}`,
						);
				}

				if (override.name !== undefined && typeof override.name !== "string")
					throw Error(
						`products: vaultOverrides name must be a string for ${addr}: ${productId}`,
					);
				if (
					override.description !== undefined &&
					typeof override.description !== "string"
				)
					throw Error(
						`products: vaultOverrides description must be a string for ${addr}: ${productId}`,
					);
				if (
					override.portfolioNotice !== undefined &&
					typeof override.portfolioNotice !== "string"
				)
					throw Error(
						`products: vaultOverrides portfolioNotice must be a string for ${addr}: ${productId}`,
					);
				if (
					override.deprecationReason !== undefined &&
					typeof override.deprecationReason !== "string"
				)
					throw Error(
						`products: vaultOverrides deprecationReason must be a string for ${addr}: ${productId}`,
					);
				if (
					override.notExplorableLend !== undefined &&
					typeof override.notExplorableLend !== "boolean"
				)
					throw Error(
						`products: vaultOverrides notExplorableLend must be a boolean for ${addr}: ${productId}`,
					);
				if (
					override.notExplorableBorrow !== undefined &&
					typeof override.notExplorableBorrow !== "boolean"
				)
					throw Error(
						`products: vaultOverrides notExplorableBorrow must be a boolean for ${addr}: ${productId}`,
					);
				if (
					override.keyring !== undefined &&
					typeof override.keyring !== "boolean"
				)
					throw Error(
						`products: vaultOverrides keyring must be a boolean for ${addr}: ${productId}`,
					);
				if (override.block !== undefined) {
					if (!Array.isArray(override.block))
						throw Error(
							`products: vaultOverrides block must be an array for ${addr}: ${productId}`,
						);
					for (const code of override.block) {
						if (typeof code !== "string")
							throw Error(
								`products: vaultOverrides block entries must be strings for ${addr}: ${productId}`,
							);
					}
				}
				if (override.restricted !== undefined) {
					if (!Array.isArray(override.restricted))
						throw Error(
							`products: vaultOverrides restricted must be an array for ${addr}: ${productId}`,
						);
					for (const code of override.restricted) {
						if (typeof code !== "string")
							throw Error(
								`products: vaultOverrides restricted entries must be strings for ${addr}: ${productId}`,
							);
					}
				}
			}
		}
	}

	for (const point of points) {
		if (point.token && point.token !== ethers.getAddress(point.token))
			throw Error(`points: malformed token: ${point.token}`);
		if (!point.name) throw Error(`points: missing name: ${point.name}`);
		if (point.url && !validUrl(point.url))
			throw Error(`points: missing name: ${point.name}`);
		if (point.logo && !logos[point.logo])
			throw Error(`points: logo not found: ${product.logo}`);

		if (point.skipValidation) continue;

		if (!point.collateralVaults?.length && !point.liabilityVaults?.length) {
			throw Error(
				`points: missing collateral or liability vaults for ${point.name}`,
			);
		}

		if (point.collateralVaults) {
			for (const addr of point.collateralVaults) {
				if (addr !== ethers.getAddress(addr))
					throw Error(`points: malformed vault address: ${addr}`);
			}
		}

		if (point.liabilityVaults) {
			for (const addr of point.liabilityVaults) {
				if (addr !== ethers.getAddress(addr))
					throw Error(`points: malformed vault address: ${addr}`);
			}
		}
	}
}

/**
 * Validates that each Ethereum address is only referenced once across all entities
 */
function validateUniqueEntityAddresses(entities) {
	const addressMap = new Map();

	for (const entityId of Object.keys(entities)) {
		const entity = entities[entityId];

		if (!entity.addresses) continue;

		for (const address of Object.keys(entity.addresses)) {
			const normalizedAddress = ethers.getAddress(address);

			if (addressMap.has(normalizedAddress)) {
				const previousEntity = addressMap.get(normalizedAddress);
				// Allow for duplicates in gauntlet
				if (previousEntity === "gauntlet" || entityId === "gauntlet") {
					continue;
				}
				throw Error(
					`Duplicate address ${normalizedAddress} found in entities: ${previousEntity} and ${entityId}`,
				);
			}

			addressMap.set(normalizedAddress, entityId);
		}
	}
}

function loadJsonFile(file) {
	return JSON.parse(fs.readFileSync(file).toString());
}

function loadJsonFileIfExists(file) {
	if (!fs.existsSync(file)) return null;
	return loadJsonFile(file);
}

function validateGlobal() {
	const assets = loadJsonFileIfExists("all/assets.json") || [];
	validateAssets("all/assets.json", assets, { isGlobal: true });
}

function validateAssets(fileLabel, assets, opts = {}) {
	const isGlobal = opts.isGlobal === true;
	const filePrefix = `assets (${fileLabel})`;

	if (!Array.isArray(assets))
		throw Error(`${filePrefix}: top-level value must be an array`);
	if (assets.length > MAX_ASSET_ENTRIES)
		throw Error(
			`${filePrefix}: ${assets.length} entries exceeds cap of ${MAX_ASSET_ENTRIES}`,
		);

	const seenAddresses = new Set();
	for (let i = 0; i < assets.length; i++) {
		const entry = assets[i];
		const where = `${filePrefix}: entry #${i}`;

		if (!entry || typeof entry !== "object" || Array.isArray(entry))
			throw Error(`${where} must be a plain object`);

		for (const key of Object.keys(entry)) {
			if (!VALID_ASSET_KEYS.has(key))
				throw Error(`${where} has unknown key '${key}'`);
		}

		const hasAddress = entry.address !== undefined;
		const hasSymbols = entry.symbols !== undefined;
		const hasSymbolRegex = entry.symbolRegex !== undefined;
		const hasNames = entry.names !== undefined;
		const hasNameRegex = entry.nameRegex !== undefined;

		if (hasAddress) {
			if (typeof entry.address !== "string" || !entry.address)
				throw Error(`${where} address must be a non-empty string`);
			if (entry.address.length > MAX_STRING_LEN)
				throw Error(`${where} address exceeds ${MAX_STRING_LEN} chars`);
			if (entry.address !== ethers.getAddress(entry.address))
				throw Error(
					`${where} address ${entry.address} not in checksummed form`,
				);
			if (seenAddresses.has(entry.address))
				throw Error(`${where} duplicate address ${entry.address}`);
			seenAddresses.add(entry.address);
			if (isGlobal) {
				console.log(
					`warn: ${where} uses address ${entry.address} in all/assets.json — addresses are chain-specific; prefer symbols/names patterns for cross-chain rules`,
				);
			}
		}

		if (hasSymbols)
			validateMatchArray(entry.symbols, "symbols", where, MAX_SYMBOL_LEN);
		if (hasNames) validateMatchArray(entry.names, "names", where, MAX_NAME_LEN);
		if (hasSymbolRegex) validateRegex(entry.symbolRegex, "symbolRegex", where);
		if (hasNameRegex) validateRegex(entry.nameRegex, "nameRegex", where);

		const hasPattern = hasSymbols || hasSymbolRegex || hasNames || hasNameRegex;
		if (!hasAddress && !hasPattern) throw Error(`${where} has no match fields`);

		if (hasAddress && hasPattern) {
			console.log(
				`warn: ${where} mixes address and pattern match fields; consider splitting into two entries so block/restricted can be scoped independently`,
			);
		}

		validateCountryCodeArray(entry.block, "block", where);
		validateCountryCodeArray(entry.restricted, "restricted", where);

		const hasBlockRule = Array.isArray(entry.block) && entry.block.length > 0;
		const hasRestrictedRule =
			Array.isArray(entry.restricted) && entry.restricted.length > 0;
		if (!hasBlockRule && !hasRestrictedRule)
			throw Error(`${where} has neither block nor restricted`);
	}
}

function validateMatchArray(value, field, where, maxItemLen) {
	if (!Array.isArray(value)) throw Error(`${where} ${field} must be an array`);
	if (value.length === 0)
		throw Error(`${where} ${field} must be a non-empty array`);
	for (let j = 0; j < value.length; j++) {
		const item = value[j];
		if (typeof item !== "string")
			throw Error(`${where} ${field}[${j}] must be a string`);
		if (!item || !item.trim())
			throw Error(
				`${where} ${field}[${j}] must be a non-empty, non-whitespace string`,
			);
		if (item.length > maxItemLen)
			throw Error(
				`${where} ${field}[${j}] '${item}' exceeds ${maxItemLen} chars`,
			);
		if (item.length > MAX_STRING_LEN)
			throw Error(`${where} ${field}[${j}] exceeds ${MAX_STRING_LEN} chars`);
	}
}

function validateRegex(value, field, where) {
	if (typeof value !== "string" || !value)
		throw Error(`${where} ${field} must be a non-empty string`);
	if (value.length > MAX_STRING_LEN)
		throw Error(`${where} ${field} exceeds ${MAX_STRING_LEN} chars`);
	if (value.length > MAX_REGEX_LEN)
		throw Error(`${where} ${field} exceeds ${MAX_REGEX_LEN} chars`);
	try {
		new RegExp(value, "i");
	} catch (e) {
		throw Error(`${where} ${field} does not compile: ${e.message}`);
	}
}

function validateCountryCodeArray(value, field, where) {
	if (value === undefined) return;
	if (!Array.isArray(value)) throw Error(`${where} ${field} must be an array`);
	const seen = new Set();
	for (let j = 0; j < value.length; j++) {
		const item = value[j];
		if (typeof item !== "string")
			throw Error(`${where} ${field}[${j}] must be a string`);
		if (item.length > MAX_STRING_LEN)
			throw Error(`${where} ${field}[${j}] exceeds ${MAX_STRING_LEN} chars`);
		let canonical;
		if (COUNTRY_ALIASES.has(item)) {
			canonical = item;
		} else if (ISO_ALPHA2_RE.test(item)) {
			canonical = item.toUpperCase();
		} else {
			throw Error(
				`${where} ${field}[${j}] '${item}' is not a valid country code (expected ISO 3166-1 alpha-2 or EU/EEA/EFTA)`,
			);
		}
		if (seen.has(canonical))
			throw Error(`${where} ${field} has duplicate '${item}'`);
		seen.add(canonical);
	}
}

function validSlug(slug) {
	return /^[a-z0-9-]+$/.test(slug);
}

function validUrl(url) {
	return /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,63}(\/[^\s]*)?$/.test(
		url,
	);
}

function getArray(v) {
	if (Array.isArray(v)) return v;
	return [v];
}
