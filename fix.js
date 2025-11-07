const fs = require("node:fs");
const { getAddress } = require("ethers");

// Get all chain directories
const chainDirs = fs.readdirSync(".").filter((dir) => /^\d+$/.test(dir));

function fixAddress(address) {
	try {
		return getAddress(address);
	} catch (error) {
		throw Error(`Invalid address ${address}: ${error.message}`);
	}
}

function fixAddressesInArray(addresses, context) {
	return addresses.map((address) => {
		const fixedAddress = fixAddress(address);
		if (fixedAddress !== address) {
			return {
				changed: true,
				message: `Fixing ${context}: ${address} -> ${fixedAddress}`,
				value: fixedAddress,
			};
		}
		return { changed: false, value: address };
	});
}

function fixAddressesInObject(obj, context) {
	const result = {};
	let changes = false;
	const changesList = [];

	for (const [key, value] of Object.entries(obj)) {
		const fixedKey = fixAddress(key);
		if (fixedKey !== key) {
			changes = true;
			const message = `Fixing ${context}: ${key} -> ${fixedKey}`;
			console.log(message);
			changesList.push(message);
		}
		result[fixedKey] = value;
	}

	return { result, changes, changesList };
}

function fixBiomeFormatting(content) {
	// Remove trailing commas in arrays and objects
	let fixed = content.replace(/,(\s*[}\]])/g, "$1");

	// Ensure consistent spacing around colons in objects, but not in URLs
	fixed = fixed.replace(/([^"\s]):(?=\s*[{"])/g, "$1 :");

	// Ensure consistent spacing around commas
	fixed = fixed.replace(/,(\S)/g, ", $1");

	return fixed;
}

function fixChain(chainId) {
	console.log(`\nProcessing chain ${chainId}...`);

	// Read all JSON files
	const files = {
		entities: JSON.parse(fs.readFileSync(`${chainId}/entities.json`, "utf8")),
		vaults: JSON.parse(fs.readFileSync(`${chainId}/vaults.json`, "utf8")),
		points: JSON.parse(fs.readFileSync(`${chainId}/points.json`, "utf8")),
		products: JSON.parse(fs.readFileSync(`${chainId}/products.json`, "utf8")),
		opportunities: JSON.parse(
			fs.readFileSync(`${chainId}/opportunities.json`, "utf8"),
		),
	};

	let changes = false;
	const changesList = [];

	// Fix entity addresses
	for (const [entityId, entity] of Object.entries(files.entities)) {
		if (entity.addresses) {
			const {
				result,
				changes: entityChanges,
				changesList: entityChangesList,
			} = fixAddressesInObject(entity.addresses, `entities.${entityId}`);
			if (entityChanges) {
				changes = true;
				changesList.push(...entityChangesList);
				entity.addresses = result;
			}
		}
	}

	// Fix vault addresses
	const {
		result: fixedVaults,
		changes: vaultChanges,
		changesList: vaultChangesList,
	} = fixAddressesInObject(files.vaults, "vault");
	if (vaultChanges) {
		changes = true;
		changesList.push(...vaultChangesList);
		files.vaults = fixedVaults;
	}

	// Fix product vault addresses
	for (const [productId, product] of Object.entries(files.products)) {
		if (product.vaults) {
			const fixedAddresses = fixAddressesInArray(
				product.vaults,
				`vault address in products.${productId}`,
			);
			const productChanges = fixedAddresses.filter((a) => a.changed);
			if (productChanges.length > 0) {
				changes = true;
				changesList.push(...productChanges.map((a) => a.message));
				product.vaults = fixedAddresses.map((a) => a.value);
			}
		}

		if (product.deprecatedVaults) {
			const fixedAddresses = fixAddressesInArray(
				product.deprecatedVaults,
				`deprecated vault address in products.${productId}`,
			);
			const productChanges = fixedAddresses.filter((a) => a.changed);
			if (productChanges.length > 0) {
				changes = true;
				changesList.push(...productChanges.map((a) => a.message));
				product.deprecatedVaults = fixedAddresses.map((a) => a.value);
			}
		}
	}

	// Fix points addresses
	for (const point of files.points) {
		if (point.skipValidation) continue;

		if (point.token) {
			const fixedToken = fixAddress(point.token);
			if (fixedToken !== point.token) {
				changes = true;
				const message = `Fixing token address in points.${point.name}: ${point.token} -> ${fixedToken}`;
				console.log(message);
				changesList.push(message);
				point.token = fixedToken;
			}
		}

		for (const field of ["collateralVaults", "liabilityVaults"]) {
			if (point[field]) {
				const fixedAddresses = fixAddressesInArray(
					point[field],
					`${field} address in points.${point.name}`,
				);
				const pointChanges = fixedAddresses.filter((a) => a.changed);
				if (pointChanges.length > 0) {
					changes = true;
					changesList.push(...pointChanges.map((a) => a.message));
					point[field] = fixedAddresses.map((a) => a.value);
				}
			}
		}
	}

	const {
		result: fixedOpportunities,
		changes: opportunitiesChanges,
		changesList: opportunitiesChangesList,
	} = fixAddressesInObject(files.opportunities, "opportunities");

	if (opportunitiesChanges) {
		changes = true;
		changesList.push(...opportunitiesChangesList);
		files.opportunities = fixedOpportunities;
	}

	// Write back changes if any were made
	if (changes) {
		console.log(`\nWriting changes for chain ${chainId}:`);
		console.log(`Found ${changesList.length} addresses to fix`);

		// Write all files with Biome formatting
		for (const [filename, data] of Object.entries(files)) {
			const content = JSON.stringify(data, null, 2);
			const biomeFixed = fixBiomeFormatting(content);
			fs.writeFileSync(`${chainId}/${filename}.json`, biomeFixed);
			console.log(`- Updated ${filename}.json`);
		}

		console.log(`\nAll changes saved for chain ${chainId}`);
	} else {
		console.log(`No malformed addresses found in chain ${chainId}`);
	}
}

// Process all chains
for (const chainId of chainDirs) {
	try {
		fixChain(chainId);
	} catch (error) {
		console.error(`Error processing chain ${chainId}:`, error);
		process.exit(1);
	}
}

console.log("\nAddress fixing complete!");
