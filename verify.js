const child_process = require("node:child_process");
const fs = require("node:fs");

const ethers = require("ethers");
const imageSize = require("image-size");

const MAX_VAULT_NAME_SIZE = 40;

const logos = {};

for (let i = 0; i < fs.readdirSync("logo/").length; i++) {
	const file = fs.readdirSync("logo/")[i];
	logos[file] = true;
}

for (const file of Object.keys(logos)) {
	const info = imageSize(`logo/${file}`);

	if (info.type !== "svg") {
		// legacy PNG files: please use SVG instead
		if (
			file !== "re7labs.png" &&
			file !== "apostro.png" &&
			file !== "usual.png" &&
			file !== "dinero.png" &&
			file !== "alterscope_wb.png" &&
			file !== "ethena.png"
		)
			throw Error(`logo file ${file} is not SVG`);
	}

	if (info.height !== info.width)
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
		if (vault.name.length > MAX_VAULT_NAME_SIZE)
			throw Error(`vaults: name is too long: ${vault.name}`);

		for (const entity of getArray(vault.entity)) {
			if (!entities[entity])
				throw Error(`vaults: no such entity ${vault.entity}`);
		}
	}

	for (const productId of Object.keys(products)) {
		const product = products[productId];

		if (!validSlug(productId))
			throw Error(`products: invalid slug: ${entityId}`);
		if (!product.name) throw Error(`products: missing name: ${productId}`);

		for (const addr of product.vaults) {
			if (addr !== ethers.getAddress(addr))
				throw Error(
					`products: malformed vault address: ${ethers.getAddress(addr)}`,
				);
			if (!vaults[addr]) throw Error(`products: unknown vault: ${addr}`);
		}

		for (const entity of getArray(product.entity)) {
			if (!entities[entity]) throw Error(`products: no such entity ${entity}`);
		}

		if (product.logo && !logos[product.logo])
			throw Error(`products: logo not found: ${product.logo}`);
	}

	for (const point of points) {
		if (point.token && point.token !== ethers.getAddress(point.token))
			throw Error(`points: malformed token: ${point.token}`);
		if (!point.name) throw Error(`points: missing name: ${point.name}`);
		if (point.url && !validUrl(point.url))
			throw Error(`points: missing name: ${point.name}`);
		if (point.logo && !logos[point.logo])
			throw Error(`points: logo not found: ${product.logo}`);

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
		for (const entity of getArray(point.entity)) {
			if (!entities[entity]) throw Error(`points: no such entity ${entity}`);
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
