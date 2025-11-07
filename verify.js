const child_process = require("node:child_process");
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

for (const file of fs.readdirSync(".")) {
	if (!/^\d+$/.test(file)) continue;
	validateChain(file);
}

console.log("OK");

///////////

function validateChain(chainId) {
	const entities = loadJsonFile(`${chainId}/entities.json`);
	const vaults = loadJsonFile(`${chainId}/vaults.json`);
	const products = loadJsonFile(`${chainId}/products.json`);
	const points = loadJsonFile(`${chainId}/points.json`);
	const opportunities = loadJsonFile(`${chainId}/opportunities.json`);

	validateUniqueEntityAddresses(entities);

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

	for (const vaultId of Object.keys(vaults)) {
		const vault = vaults[vaultId];

		if (vaultId !== ethers.getAddress(vaultId))
			throw Error(`vaults: malformed vaultId: ${vaultId}`);
		if (!vault.name) throw Error(`vaults: missing name: ${vaultId}`);
		if (!vault.description)
			throw Error(`vaults: missing description: ${vaultId}`);

		for (const entity of getArray(vault.entity)) {
			if (!entities[entity])
				throw Error(`vaults: no such entity ${vault.entity}`);
		}
	}

	const vaultsSeenInProducts = {};
	const deprecatedVaults = new Set();

	for (const productId of Object.keys(products)) {
		const product = products[productId];

		if (!validSlug(productId))
			throw Error(`products: invalid slug: ${productId}`);
		if (!product.name) throw Error(`products: missing name: ${productId}`);

		for (const addr of product.vaults) {
			if (addr !== ethers.getAddress(addr))
				throw Error(
					`products: malformed vault address: ${ethers.getAddress(addr)}`,
				);
			if (!vaults[addr]) throw Error(`products: unknown vault: ${addr}`);
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
				if (!vaults[addr])
					throw Error(`products: unknown deprecated vault: ${addr}`);
				if (product.vaults.includes(addr))
					throw Error(
						`products: vault ${addr} cannot be both in vaults and deprecatedVaults: ${productId}`,
					);
				deprecatedVaults.add(addr);
			}
		}

		for (const entity of getArray(product.entity)) {
			if (!entities[entity]) throw Error(`products: no such entity ${entity}`);
		}

		if (product.logo && !logos[product.logo])
			throw Error(`products: logo not found: ${product.logo}`);
	}

	for (const vaultId of Object.keys(vaults)) {
		if (!vaultsSeenInProducts[vaultId] && !deprecatedVaults.has(vaultId))
			throw Error(`vault does not exist in product: ${vaultId}`);
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

	for (const vaultId of Object.keys(opportunities)) {
		const vaultOpportunity = opportunities[vaultId];

		if (vaultId !== ethers.getAddress(vaultId))
			throw Error(`opportunities: malformed address: ${vaultId}`);

		if (vaultOpportunity.cozy) {
			if (!vaultOpportunity.cozy.safetyModule)
				throw Error(`opportunities: missing safety module: ${vaultId}`);
			if (
				vaultOpportunity.cozy.safetyModule !==
				ethers.getAddress(vaultOpportunity.cozy.safetyModule)
			)
				throw Error(
					`opportunities: malformed safety module: ${vaultOpportunity.cozy.safetyModule}`,
				);
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
