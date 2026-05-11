# Euler Labels

This repository contains a database of metadata about [Euler Vault Kit](https://docs.euler.finance/euler-vault-kit-white-paper/) vaults and related entities. This metadata is used to augment the [Euler dApp](https://app.euler.finance) UI by showing human-readable identifiers alongside vaults, and providing the information necessary to render custom pages for governors and packaged lending products.

If you have created a vault and wish to have it included in this database, please read the rest of this file, fork the repo, and create a pull request.

## Schema

Each network has a directory, named after its numeric `chainId`. For example, the Ethereum mainnet data is stored in directory `1/`.

There is also an optional top-level `all/` directory for cross-chain rules. Today only `all/assets.json` is consumed — see the [`assets.json`](#assetsjson) schema.

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

This optional file lists asset-level geo-blocking rules. An asset-level rule applies to every asset that matches — and therefore to every vault whose underlying asset matches — across all products. Use it when a restriction exists because of the asset itself (e.g. tokenized equities that cannot be sold to US residents). For restrictions that exist because of the *product* wrapping an asset (e.g. one product's USDC vault is blocked in a region while other USDC vaults are not), keep the rule in `products.json` as a product-level `block` or a `vaultOverrides[address].block` / `.restricted`.

There are two locations:

* **Per-chain** — `<chainId>/assets.json`. Applies only to assets on that chain. Best for rules anchored to a concrete deployment address.
* **Global (cross-chain)** — `all/assets.json`. Applies on every chain. Best for pattern rules driven by an issuer's symbol/name convention that spans chains (e.g. every token whose name contains a given brand). Entries from `all/assets.json` are transparently unioned with the per-chain file at query time.

Each entry is an object with at least one **match field** and at least one **rule field**.

**Match fields** (OR-composed within an entry — an asset matches the entry if *any* populated match field matches):

* `address`: Checksummed hex address of the asset (ERC-20 token). Exact address match. In `all/assets.json` the same literal address matches on every chain, which is rarely what you want — prefer pattern fields for cross-chain rules.
* `symbols`: Array of token symbols. Case-insensitive exact match against the asset's symbol.
* `symbolRegex`: Regular expression string. Compiled with the case-insensitive (`i`) flag and matched against the asset's symbol. Max length 512 chars; must compile.
* `names`: Array of token names. Case-insensitive exact match against the asset's name.
* `nameRegex`: Regular expression string. Compiled with the case-insensitive (`i`) flag and matched against the asset's name. Max length 512 chars; must compile.

**Rule fields** (at least one required):

* `block`: Array of country code strings where matching assets are hard-blocked. Any vault using a matching asset is treated as blocked for users in those countries.
* `restricted`: Array of country code strings where matching assets are soft-restricted. Users can still reduce exposure to a matching asset but cannot acquire more via swap flows.

Country codes may be ISO 3166-1 alpha-2 codes (e.g. `US`, `CA`, `GB`) or group aliases (`EU`, `EEA`, `EFTA`).

Asset-level and vault-level rules combine with OR semantics: a vault is blocked if its underlying asset is blocked by *any* asset-level entry (per-chain or global) *or* the vault itself has a vault-level block. Asset rules act as a floor that vault rules can only add to.

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
