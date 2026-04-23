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

for (const file of fs.readdirSync(".")) {
	if (!/^\d+$/.test(file)) continue;
	validateChain(file);
}

console.log("OK");

///////////

function validateChain(chainId) {
	const entities = loadJsonFile(`${chainId}/entities.json`);
	const products = loadJsonFile(`${chainId}/products.json`);
	const points = loadJsonFile(`${chainId}/points.json`);
	const assets = loadJsonFileIfExists(`${chainId}/assets.json`) || [];

	validateUniqueEntityAddresses(entities);
	validateAssets(chainId, assets);

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

function validateAssets(chainId, assets) {
	if (!Array.isArray(assets))
		throw Error(`assets: ${chainId}/assets.json must be an array`);

	const seen = new Set();
	for (let i = 0; i < assets.length; i++) {
		const entry = assets[i];
		if (!entry || typeof entry !== "object")
			throw Error(`assets: entry [${i}] must be an object`);
		if (typeof entry.address !== "string" || !entry.address)
			throw Error(`assets: entry [${i}] missing address`);
		if (entry.address !== ethers.getAddress(entry.address))
			throw Error(`assets: malformed address at [${i}]: ${entry.address}`);
		if (seen.has(entry.address))
			throw Error(`assets: duplicate address ${entry.address}`);
		seen.add(entry.address);

		if (entry.block !== undefined) {
			if (!Array.isArray(entry.block))
				throw Error(`assets: block must be an array for ${entry.address}`);
			for (const code of entry.block) {
				if (typeof code !== "string")
					throw Error(
						`assets: block entries must be strings for ${entry.address}`,
					);
			}
		}
		if (entry.restricted !== undefined) {
			if (!Array.isArray(entry.restricted))
				throw Error(`assets: restricted must be an array for ${entry.address}`);
			for (const code of entry.restricted) {
				if (typeof code !== "string")
					throw Error(
						`assets: restricted entries must be strings for ${entry.address}`,
					);
			}
		}
		if (!entry.block?.length && !entry.restricted?.length)
			throw Error(
				`assets: entry ${entry.address} has no block or restricted rules`,
			);
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
