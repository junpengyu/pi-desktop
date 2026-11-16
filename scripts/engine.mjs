// Fetch, build, and verify the exact Pi fork revision used by desktop packages.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readEngineLock() {
	return JSON.parse(readFileSync(join(projectRoot, "engine.lock.json"), "utf8"));
}

function git(directory, args) {
	return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8" }).trim();
}

function verifySource(directory, lock) {
	const revision = git(directory, ["rev-parse", "HEAD"]);
	if (revision !== lock.revision) throw new Error(`Engine revision mismatch: expected ${lock.revision}, found ${revision}. Use npm run engine:prepare with a fresh PI_SOURCE_DIR.`);
	if (git(directory, ["status", "--porcelain"])) throw new Error("Engine checkout has local changes. Commit or preserve them before building a distributable.");
	return revision;
}

function buildRecordPath(directory) {
	return resolve(directory, git(directory, ["rev-parse", "--git-path", "pi-desktop-build.json"]));
}

export function verifyEngine(directory) {
	const lock = readEngineLock();
	const revision = verifySource(directory, lock);
	const manifest = JSON.parse(readFileSync(join(directory, "packages/coding-agent/package.json"), "utf8"));
	if (manifest.version !== lock.piVersion) throw new Error("Engine package version differs from engine.lock.json");
	const recordFile = buildRecordPath(directory);
	if (!existsSync(recordFile)) throw new Error("Engine build provenance is missing. Run npm run engine:prepare before packaging.");
	const record = JSON.parse(readFileSync(recordFile, "utf8"));
	const cli = join(directory, "packages/coding-agent/dist/bundle/cli.js");
	if (record.revision !== revision || !existsSync(cli)) throw new Error("Engine build is stale. Run npm run engine:prepare.");
	if (record.cliSha256 !== createHash("sha256").update(readFileSync(cli)).digest("hex")) throw new Error("Engine CLI changed since the recorded build. Run npm run engine:prepare.");
	const digest = createHash("sha256").update(readFileSync(join(directory, "package-lock.json"))).digest("hex");
	if (record.packageLockSha256 !== digest) throw new Error("Engine dependency lock changed since the build");
	return { repository: lock.repository, revision, upstream: lock.upstream, piVersion: manifest.version, build: record };
}

function prepareEngine(directory) {
	const lock = readEngineLock();
	if (!existsSync(directory)) {
		execFileSync("git", ["clone", "--no-checkout", lock.repository, directory], { stdio: "inherit" });
		execFileSync("git", ["-C", directory, "checkout", "--detach", lock.revision], { stdio: "inherit" });
	}
	verifySource(directory, lock);
	// A failed rebuild must invalidate a previous success record.
	rmSync(buildRecordPath(directory), { force: true });
	execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: directory, stdio: "inherit" });
	execFileSync("npm", ["run", "build"], { cwd: directory, stdio: "inherit" });
	verifySource(directory, lock);
	writeFileSync(buildRecordPath(directory), JSON.stringify({
		revision: lock.revision,
		cliSha256: createHash("sha256").update(readFileSync(join(directory, "packages/coding-agent/dist/bundle/cli.js"))).digest("hex"),
		packageLockSha256: createHash("sha256").update(readFileSync(join(directory, "package-lock.json"))).digest("hex"),
		node: process.version,
		builtAt: new Date().toISOString(),
	}, null, 2) + "\n");
	console.log(JSON.stringify(verifyEngine(directory), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const directory = resolve(process.env.PI_SOURCE_DIR || join(projectRoot, "../pi"));
	try {
		if (process.argv[2] === "prepare") prepareEngine(directory);
		else if (process.argv[2] === "verify") console.log(JSON.stringify(verifyEngine(directory), null, 2));
		else throw new Error("Usage: node scripts/engine.mjs prepare|verify");
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
