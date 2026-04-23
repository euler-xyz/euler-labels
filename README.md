# Euler Labels

This repository contains a database of metadata about [Euler Vault Kit](https://docs.euler.finance/euler-vault-kit-white-paper/) vaults and related entities. This metadata is used to augment the [Euler dApp](https://app.euler.finance) UI by showing human-readable identifiers alongside vaults, and providing the information necessary to render custom pages for governors and packaged lending products.

If you have created a vault and wish to have it included in this database, please read the rest of this file, fork the repo, and create a pull request.

## Schema

Each network has a directory, named after its numeric `chainId`. For example, the Ethereum mainnet data is stored in directory `1/`.

Inside each network's directory are JSON files that correspond to the following schemas. All keys are optional unless indicated as required.

### `entities.json`

Each entry in this object corresponds to a company, organisation, or other entity. Each key is an **entity ID**, which is a unique string per entity. It should be in "URL slug" format (lowercase ASCII letters or numbers, separated by `-` characters).

* `name`: Full, official name of the entity. (Required)
* `logo`: The filename of a logo stored in the `logo/` directory.
* `description`: Long-form description of the entity, displayed on the entity's page.
* `url`: Website where users can learn more about the entity.
* `addresses`: An object that indicates addresses controlled by this entity. Each key is a checksumed hex address, and each value is a human-meaningful description of what this address represents.
* `social`: An object that indicates social media handles controlled by this entity. Each key is a name of a social media system, and each value is the entity-specific username/handle.

### `products.json`

Each entry in this object corresponds to a lending product, which is primarily a grouping of vaults under a particular branding umbrella. Each key is the **product ID**, which is a unique string per product. It should be in "URL slug" format (lowercase ASCII letters or numbers, separated by `-` characters).

* `name`: Official name of the product. (Required)
* `description`: Long-form description of the product, displayed on the product's page.
* `entity`: An entity ID that refers to the organisation responsible for governing and/or creating this vault, or a list of entity IDs if the vault is joint-managed.
* `url`: Website where users can learn more about the product.
* `logo`: The filename of a logo stored in the `logo/` directory.
* `vaults`: An array of the vault addresses (in checksumed hex format) that comprise the product. A vault may only appear in one product.
* `deprecatedVaults`: An optional array of vault addresses (in checksumed hex format) that were previously part of this product but are now deprecated.
* `deprecationReason`: An optional string providing an explanation for why the product or its vaults have been deprecated.
* `portfolioNotice`: An optional string displayed as a notice in the user's portfolio view.
* `notExplorable`: An optional boolean. If true, hides the product from discovery UI.
* `isGovernanceLimited`: An optional boolean flag for governance-limited products.
* `keyring`: An optional boolean flag for keyring-type products.
* `block`: An optional array of country code strings where the product is blocked.
* `featuredVaults`: An optional array of vault addresses to feature. Each must also be in `vaults`.
* `vaultOverrides`: An optional object of per-vault configuration overrides, keyed by vault address. Each override can contain: `name` (string), `description` (string), `portfolioNotice` (string), `deprecationReason` (string), `block` (string[]), `restricted` (string[]), `notExplorableLend` (boolean), `notExplorableBorrow` (boolean), `keyring` (boolean).

### `assets.json`

This optional file lists per-asset geo-blocking rules, keyed by underlying asset address. An asset-level rule applies to every vault whose underlying asset matches, across all products. Use it when a restriction exists because of the asset itself (e.g. tokenized equities that cannot be sold to US residents). For restrictions that exist because of the *product* wrapping an asset (e.g. one product's USDC vault is blocked in a region while other USDC vaults are not), keep the rule in `products.json` as a product-level `block` or a `vaultOverrides[address].block` / `.restricted`.

Each entry is an object with:

* `address`: Checksummed hex address of the asset (ERC-20 token). (Required)
* `block`: An optional array of country code strings where the asset is hard-blocked. Any vault using this asset is treated as blocked for users in those countries.
* `restricted`: An optional array of country code strings where the asset is soft-restricted. Users can still reduce exposure to the asset but cannot acquire more via swap flows.

At least one of `block` or `restricted` must be present. Country codes may be ISO 3166-1 alpha-2 codes (e.g. `US`, `CA`, `GB`) or group aliases (`EU`, `EEA`, `EFTA`).

Asset-level and vault-level rules combine with OR semantics: a vault is blocked if either its underlying asset is blocked *or* the vault itself has a block. Asset rules act as a floor that vault rules can only add to.

### `points.json`

Each entry in this array corresponds to points available on deposits in a vault. Either `collateralVaults` or `liabilityVaults` or both are required. Each item has the following

* `token`: The token address (in a checksumed hex format) that the points are denominated in.
* `name`: The name of the points, for example "Euler Points". (Required)
* `description`: A long-form description of the points, displayed within points tooltips.
* `skipTooltipPrefix`: If true, the tooltip text will not be prefixed with "Deposits earns {logo}".
* `url`: A URL where users can learn more about the points.
* `logo`: The filename of a logo stored in the `logo/` directory. (Required)
* `collateralVaults`: An array of the vault addresses (in checksumed hex format) that offer these points. Each vault does not need to exist in the `vaults.json` file.
* `liabilityVaults`: An array of the vault addresses (in checksumed hex format) that offer these points. Each vault does not need to exist in the `vaults.json` file.
* `entity`: An entity ID that refers to the organisation responsible for governing and/or creating this vault, or a list of entity IDs if the vault is joint-managed.

## Logos

Logos exist in the `logo/` directory, and should satisfy the following properties:

* SVG/PNG (preferred) or JPG format
* Square-shaped

## Scripts

The repository includes several npm scripts to help maintain the data:

* `npm run verify`: Validates all JSON files against their schemas and ensures all Ethereum addresses are properly checksummed.
* `npm run fix`: Normalizes all Ethereum addresses to their proper checksummed format and fixes Biome formatting issues (like trailing commas) across all chain files.

## Verification

Before making your pull request, please ensure that `verify.js` succeeds:

    apt install -y npm jq
    npm i
    node verify.js
