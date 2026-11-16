// Copy the built Pi runtime and redistribution notices without user configuration.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { verifyEngine } from "./engine.mjs";

const [resourcesArg, piRootArg, nodeArg] = process.argv.slice(2);
if (!resourcesArg || !piRootArg || !nodeArg) throw new Error("Expected resources directory, Pi checkout, and Node executable");
const resources = resolve(resourcesArg);
const piRoot = resolve(piRootArg);
const engine = verifyEngine(piRoot);
const source = join(piRoot, "packages/coding-agent");
const target = join(resources, "pi/packages/coding-agent");
const notices = join(resources, "licenses");
mkdirSync(target, { recursive: true });
mkdirSync(notices, { recursive: true });

for (const item of ["package.json", "README.md", "CHANGELOG.md", "docs", "schemas", "containerization.md", "dist/bundle", "dist/modes/interactive/theme", "dist/modes/interactive/assets", "dist/core/export-html"]) {
	const from = join(source, item);
	if (existsSync(from)) cpSync(from, join(target, item), { recursive: true, dereference: true });
}
for (const dependency of ["jiti", "quickjs-wasi", "@silvia-odwyer/photon-node"]) {
	cpSync(join(piRoot, "node_modules", dependency), join(target, "node_modules", dependency), { recursive: true, dereference: true });
}
cpSync(join(piRoot, "LICENSE"), join(notices, "Pi-LICENSE"));
cpSync(join(piRoot, "PI_DESKTOP.md"), join(notices, "Pi-Desktop-Engine.md"));
cpSync(join(dirname(dirname(realpathSync(nodeArg))), "LICENSE"), join(notices, "Node-LICENSE"));

// Include notices from the build dependency tree as well: the CLI bundle strips legal comments.
const inventory = [];
const visited = new Set();
function collectPackage(directory, label) {
	const canonical = realpathSync(directory);
	if (visited.has(canonical)) return;
	visited.add(canonical);
	const manifestPath = join(canonical, "package.json");
	if (!existsSync(manifestPath)) return;
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const output = join(notices, "dependencies", label.replace(/[^a-zA-Z0-9._-]/g, "_"));
	const licenses = readdirSync(canonical, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /^(licen[sc]e|copying|copyright|notice)([.-]|$)/i.test(entry.name));
	if (licenses.length) {
		mkdirSync(output, { recursive: true });
		for (const entry of licenses) cpSync(join(canonical, entry.name), join(output, entry.name));
	}
	inventory.push({ name: manifest.name || label, version: manifest.version, license: manifest.license, noticeFiles: licenses.map((entry) => entry.name) });
	collectModules(join(canonical, "node_modules"));
}
function collectModules(directory) {
	if (!existsSync(directory)) return;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		const path = join(directory, entry.name);
		if (entry.name.startsWith("@")) {
			for (const child of readdirSync(path)) collectPackage(join(path, child), `${entry.name}/${child}`);
		} else collectPackage(path, entry.name);
	}
}
collectModules(join(piRoot, "node_modules"));
writeFileSync(join(notices, "dependency-inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
writeFileSync(join(resources, "runtime-versions.json"), JSON.stringify({ node: process.version, pi: engine.piVersion, architecture: process.arch, engine }, null, 2) + "\n");
console.log(`Packaged Pi runtime and ${inventory.length} dependency notices in ${basename(resources)}`);
