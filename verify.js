const child_process = require('child_process');
const fs = require("fs");

const ethers = require("ethers");
const imageSize = require("image-size");


const MAX_VAULT_NAME_SIZE = 40;


let logos = {};

fs.readdirSync("logo/").forEach(file => {
    logos[file] = true;
});

for (let file of Object.keys(logos)) {
    let info = imageSize(`logo/${file}`);

    if (info.type !== 'svg') {
        // legacy PNG files: please use SVG instead
        if (file !== 're7labs.png' && file !== 'apostro.png') throw Error(`logo file ${file} is not SVG`);
    }

    if (info.height !== info.width) throw Error(`logo dimensions not square: ${file} (${info.height} x ${info.width})`);
}

fs.readdirSync(".").forEach(file => {
    if (!/^\d+$/.test(file)) return;
    validateChain(file);
});

console.log("OK");



///////////

function validateChain(chainId) {
    let entities = loadJsonFile(`${chainId}/entities.json`);
    let vaults = loadJsonFile(`${chainId}/vaults.json`);
    let products = loadJsonFile(`${chainId}/products.json`);

    for (let entityId of Object.keys(entities)) {
        let entity = entities[entityId];

        if (!validSlug(entityId)) throw Error(`entities: invalid slug: ${entityId}`);
        if (!entity.name) throw Error(`entities: missing name: ${entityId}`);

        for (let addr of Object.keys(entity.addresses || {})) {
            if (addr !== ethers.getAddress(addr)) throw Error(`entities: malformed address: ${addr}`);
        }

        if (entity.logo && !logos[entity.logo]) throw Error(`entities: logo not found: ${entity.logo}`);
    }

    for (let vaultId of Object.keys(vaults)) {
        let vault = vaults[vaultId];

        if (vaultId !== ethers.getAddress(vaultId)) throw Error(`vaults: malformed vaultId: ${vaultId}`);
        if (!vault.name) throw Error(`vaults: missing name: ${vaultId}`);
        if (vault.name.length > MAX_VAULT_NAME_SIZE) throw Error(`vaults: name is too long: ${vault.name}`);

        for (let entity of getArray(vault.entity)) {
            if (!entities[entity]) throw Error(`vaults: no such entity ${vault.entity}`);
        }
    }

    for (let productId of Object.keys(products)) {
        let product = products[productId];

        if (!validSlug(productId)) throw Error(`products: invalid slug: ${entityId}`);
        if (!product.name) throw Error(`products: missing name: ${productId}`);

        for (let addr of product.vaults) {
            if (addr !== ethers.getAddress(addr)) throw Error(`products: malformed vault address: ${addr}`);
            if (!vaults[addr]) throw Error(`products: unknown vault: ${addr}`);
        }

        for (let entity of getArray(product.entity)) {
            if (!entities[entity]) throw Error(`products: no such entity ${entity}`);
        }

        if (product.logo && !logos[product.logo]) throw Error(`products: logo not found: ${product.logo}`);
    }

    checkFormatting(`${chainId}/entities.json`);
    checkFormatting(`${chainId}/vaults.json`);
    checkFormatting(`${chainId}/products.json`);
}

function loadJsonFile(file) {
    return JSON.parse(fs.readFileSync(file).toString());
}

function validSlug(slug) {
    return /^[a-z0-9-]+$/.test(slug);
}

function getArray(v) {
    if (Array.isArray(v)) return v;
    return [v];
}

function checkFormatting(file) {
    try {
        child_process.execSync(`bash -c 'diff -u ${file} <(jq --indent 4 . ${file})'`);
    } catch (e) {
        console.error(`Formatting problem in ${file} -- apply this patch to fix:\n\n${e.stdout.toString()}\n\n`);
        throw Error(`Formatting problem in ${file}`);
    }
}
