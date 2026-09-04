const { readFile } = require("node:fs/promises");
const path = require("node:path");

const ADVISORIES_URL = "https://api.github.com/advisories";
const ALLOWLIST = new Set(["GHSA-5p2g-fcmc-qvqq", "GHSA-w3rx-r6r6-pgpr"]);
const BATCH_SIZE = 50;
const PER_PAGE = 100;

function getPackageName(lockPath, metadata) {
	if (metadata.name) return metadata.name;

	const marker = "node_modules/";
	const markerIndex = lockPath.lastIndexOf(marker);
	return markerIndex === -1
		? undefined
		: lockPath.slice(markerIndex + marker.length);
}

function getLockedPackages(lockfile) {
	const packages = new Set();

	for (const [lockPath, metadata] of Object.entries(lockfile.packages ?? {})) {
		if (!lockPath || !metadata.version) continue;

		const name = getPackageName(lockPath, metadata);
		if (name) packages.add(`${name}@${metadata.version}`);
	}

	return [...packages].sort();
}

function isRetryableStatus(status) {
	return status === 429 || status >= 500;
}

async function requestAdvisories(url) {
	let lastError;

	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			const headers = {
				Accept: "application/vnd.github+json",
				"User-Agent": "euler-labels-dependency-audit",
				"X-GitHub-Api-Version": "2022-11-28",
			};
			if (process.env.GITHUB_TOKEN) {
				headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
			}

			const response = await fetch(url, {
				headers,
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) {
				const error = new Error(
					`GitHub Advisory Database returned ${response.status} ${response.statusText}`,
				);
				error.retryable = isRetryableStatus(response.status);
				throw error;
			}

			const advisories = await response.json();
			if (!Array.isArray(advisories)) {
				throw new Error(
					"GitHub Advisory Database returned an invalid response",
				);
			}
			return advisories;
		} catch (error) {
			lastError = error;
			if (attempt === 2 || error.retryable === false) throw error;
			console.warn("GitHub Advisory Database request failed; retrying once...");
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
	}

	throw lastError;
}

async function findAdvisories(packages, severity) {
	const advisories = [];

	for (let offset = 0; offset < packages.length; offset += BATCH_SIZE) {
		const batch = packages.slice(offset, offset + BATCH_SIZE);
		let page = 1;
		let results;

		do {
			const params = new URLSearchParams({
				affects: batch.join(","),
				ecosystem: "npm",
				page: String(page),
				per_page: String(PER_PAGE),
				severity,
			});
			results = await requestAdvisories(`${ADVISORIES_URL}?${params}`);
			advisories.push(...results);
			page++;
		} while (results.length === PER_PAGE);
	}

	return advisories;
}

async function main() {
	const lockfilePath = path.join(__dirname, "package-lock.json");
	const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
	const packages = getLockedPackages(lockfile);
	if (packages.length === 0) {
		throw new Error("No locked npm packages found to audit");
	}

	const results = await Promise.all([
		findAdvisories(packages, "high"),
		findAdvisories(packages, "critical"),
	]);
	const advisories = new Map(
		results.flat().map((advisory) => [advisory.ghsa_id, advisory]),
	);
	const unexpected = [...advisories.values()].filter(
		(advisory) => !ALLOWLIST.has(advisory.ghsa_id),
	);

	for (const id of ALLOWLIST) {
		if (!advisories.has(id)) {
			console.warn(`Allowlisted advisory not found: ${id}`);
		}
	}

	if (unexpected.length > 0) {
		console.error("Dependency audit found blocking advisories:");
		for (const advisory of unexpected) {
			console.error(
				`- ${advisory.ghsa_id} (${advisory.severity}): ${advisory.summary}`,
			);
		}
		process.exitCode = 1;
		return;
	}

	const allowlisted = [...advisories.keys()].filter((id) => ALLOWLIST.has(id));
	if (allowlisted.length > 0) {
		console.warn(
			`Found allowlisted advisories: ${allowlisted.sort().join(", ")}`,
		);
	}
	console.log(
		`Passed security audit for ${packages.length} locked npm packages.`,
	);
}

main().catch((error) => {
	console.error(`Dependency audit failed: ${error.message}`);
	process.exitCode = 1;
});
