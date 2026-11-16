#!/usr/bin/env node
import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, "public");

const DEFAULT_PI_CLI = resolve(
	__dirname,
	"..",
	"pi",
	"packages",
	"coding-agent",
	"dist",
	"bundle",
	"cli.js",
);
const PI_CLI_PATH = process.env.PI_CLI_PATH || DEFAULT_PI_CLI;
const PORT = Number(process.env.PI_DESKTOP_PORT || 4317);
const HOST = process.env.PI_DESKTOP_HOST || "127.0.0.1";

const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const PI_SESSIONS_DIR = join(PI_AGENT_DIR, "sessions");
const WORKSPACES_CONFIG_PATH = join(PI_AGENT_DIR, "desktop-workspaces.json");

mkdirSync(PI_AGENT_DIR, { recursive: true });
const AUTH_JSON_PATH = join(PI_AGENT_DIR, "auth.json");

function getAuthenticatedProviders() {
	try {
		if (!existsSync(AUTH_JSON_PATH)) return [];
		const raw = JSON.parse(readFileSync(AUTH_JSON_PATH, "utf-8"));
		return Object.keys(raw).filter((k) => Boolean(raw[k]));
	} catch {
		return [];
	}
}

// =============================================================================
// SSE Event Bus
// =============================================================================

const sseClients = new Set();

function broadcastEvent(payload) {
	const data = `data: ${JSON.stringify(payload)}\n\n`;
	for (const res of sseClients) {
		try {
			res.write(data);
		} catch {
			sseClients.delete(res);
		}
	}
}

// =============================================================================
// Workspace Persistence & Session Scanner
// =============================================================================

function loadWorkspaces() {
	const sessionCwds = scanAllSessions()
		.map((s) => s.cwd)
		.filter((p) => typeof p === "string" && p && existsSync(p));

	const defaultWorkspaces = [
		...(process.env.PI_DESKTOP_BUNDLED === "1" ? [homedir()] : [
			resolve(__dirname, "..", "pi"),
			resolve(__dirname, ".."),
		]),
		...sessionCwds,
	].filter((p) => existsSync(p));

	if (!existsSync(WORKSPACES_CONFIG_PATH)) {
		return saveWorkspaces(defaultWorkspaces);
	}
	try {
		const raw = JSON.parse(readFileSync(WORKSPACES_CONFIG_PATH, "utf-8"));
		if (Array.isArray(raw.workspaces) && raw.workspaces.length > 0) {
			const merged = Array.from(
				new Set([...raw.workspaces, ...sessionCwds].filter((p) => typeof p === "string" && existsSync(p))),
			);
			return merged;
		}
	} catch {
		// fall through
	}
	return Array.from(new Set(defaultWorkspaces));
}

function saveWorkspaces(workspaces) {
	const unique = Array.from(new Set(workspaces));
	writeFileSync(
		WORKSPACES_CONFIG_PATH,
		JSON.stringify({ workspaces: unique }, null, 2),
		"utf-8",
	);
	return unique;
}

function extractTextSnippet(content) {
	if (typeof content === "string") return content.trim();
	if (Array.isArray(content)) {
		for (const item of content) {
			if (item && item.type === "text" && typeof item.text === "string" && item.text.trim()) {
				return item.text.trim();
			}
		}
	}
	return "";
}

function parseSessionFileSummary(filePath) {
	try {
		const stat = statSync(filePath);
		const raw = readFileSync(filePath, "utf-8");
		const lines = raw.split("\n");
		let header = null;
		let sessionName = null;
		let firstUserPrompt = "";
		let messageCount = 0;
		let lastTimestamp = stat.mtimeMs;

		for (const line of lines) {
			const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
			if (!trimmed) continue;
			let record;
			try {
				record = JSON.parse(trimmed);
			} catch {
				continue;
			}
			if (record.type === "session" && !header) {
				header = record;
			} else if (record.type === "session_info") {
				sessionName = record.name || null;
			} else if (record.type === "message" && record.message) {
				if (record.message.role === "user" || record.message.role === "assistant") {
					messageCount++;
				}
				if (record.message.role === "user" && !firstUserPrompt) {
					firstUserPrompt = extractTextSnippet(record.message.content).slice(0, 120);
				}
				if (record.message.timestamp) {
					lastTimestamp = Math.max(lastTimestamp, Number(record.message.timestamp));
				}
			}
		}

		if (!header) return null;
		return {
			id: header.id || basename(filePath, ".jsonl"),
			sessionFile: filePath,
			cwd: header.cwd || "",
			name: sessionName || firstUserPrompt || "Untitled Session",
			firstUserPrompt,
			messageCount,
			createdAt: header.timestamp || new Date(stat.birthtimeMs).toISOString(),
			updatedAt: new Date(lastTimestamp).toISOString(),
			updatedAtMs: lastTimestamp,
		};
	} catch {
		return null;
	}
}

function scanAllSessions() {
	if (!existsSync(PI_SESSIONS_DIR)) return [];
	const results = [];
	try {
		const subdirs = readdirSync(PI_SESSIONS_DIR, { withFileTypes: true });
		for (const dirent of subdirs) {
			if (!dirent.isDirectory()) continue;
			const folderPath = join(PI_SESSIONS_DIR, dirent.name);
			let files = [];
			try {
				files = readdirSync(folderPath);
			} catch {
				continue;
			}
			for (const file of files) {
				if (!file.endsWith(".jsonl")) continue;
				const summary = parseSessionFileSummary(join(folderPath, file));
				if (summary) results.push(summary);
			}
		}
	} catch {
		// ignore
	}
	results.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
	return results;
}

// =============================================================================
// RPC Worker Manager (Manages `pi --mode rpc` child processes)
// =============================================================================

class RpcWorker {
	constructor({ workerId, cwd, sessionFile }) {
		this.workerId = workerId;
		this.cwd = cwd;
		this.sessionFile = sessionFile || null;
		this.proc = null;
		this.pendingRequests = new Map();
		this.stdoutBuffer = "";
		this.stderrLines = [];
		this.isStreaming = false;
		this.activeTools = new Map();
		this.statusEntries = {};
		this.widgets = {};
		this.lastState = null;
		this.readyPromise = null;
	}

	start() {
		if (this.proc) return this.readyPromise;

		const args = [PI_CLI_PATH, "--mode", "rpc"];
		if (this.sessionFile && existsSync(this.sessionFile)) {
			args.push("--session", this.sessionFile);
		}

		this.proc = spawn(process.execPath, args, {
			cwd: this.cwd,
			env: {
				...process.env,
				FORCE_COLOR: "0",
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.proc.stdout.setEncoding("utf-8");
		this.proc.stdout.on("data", (chunk) => {
			this.handleStdoutChunk(chunk);
		});

		this.proc.stderr.setEncoding("utf-8");
		this.proc.stderr.on("data", (chunk) => {
			const text = chunk.toString();
			this.stderrLines.push(text);
			if (this.stderrLines.length > 100) this.stderrLines.shift();
			broadcastEvent({
				type: "worker_stderr",
				workerId: this.workerId,
				text,
			});
		});

		this.proc.on("error", (error) => {
			for (const pending of this.pendingRequests.values()) {
				clearTimeout(pending.timer);
				pending.reject(error);
			}
			this.pendingRequests.clear();
			this.proc = null;
			this.isStreaming = false;
			broadcastEvent({ type: "worker_error", workerId: this.workerId, error: error.message });
		});
		this.proc.stdin.on("error", () => {}); // write callbacks report pipe failures to the requester

		this.proc.on("exit", (code, signal) => {
			for (const [, pending] of this.pendingRequests) {
				clearTimeout(pending.timer);
				pending.reject(new Error(`Pi RPC process exited (${code ?? signal})`));
			}
			this.pendingRequests.clear();
			this.proc = null;
			this.isStreaming = false;
			broadcastEvent({
				type: "worker_exit",
				workerId: this.workerId,
				code,
				signal,
			});
		});

		this.readyPromise = this.refreshState();
		return this.readyPromise;
	}

	handleStdoutChunk(chunk) {
		this.stdoutBuffer += chunk;
		let newlineIdx = this.stdoutBuffer.indexOf("\n");
		while (newlineIdx !== -1) {
			let line = this.stdoutBuffer.slice(0, newlineIdx);
			if (line.endsWith("\r")) {
				line = line.slice(0, -1);
			}
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
			if (line.length > 0) {
				this.handleJsonLine(line);
			}
			newlineIdx = this.stdoutBuffer.indexOf("\n");
		}
	}

	handleJsonLine(line) {
		let record;
		try {
			record = JSON.parse(line);
		} catch (err) {
			return;
		}

		// 1. Command response
		if (record.type === "response" && record.id && this.pendingRequests.has(record.id)) {
			const pending = this.pendingRequests.get(record.id);
			this.pendingRequests.delete(record.id);
			clearTimeout(pending.timer);
			pending.resolve(record);
			return;
		}

		// 2. Track lifecycle state locally
		if (record.type === "agent_start") {
			this.isStreaming = true;
		} else if (record.type === "agent_settled") {
			this.isStreaming = false;
			this.activeTools.clear();
			// Refresh state & stats in background
			this.refreshState().catch(() => {});
		} else if (record.type === "tool_execution_start") {
			this.activeTools.set(record.toolCallId, {
				toolCallId: record.toolCallId,
				toolName: record.toolName,
				args: record.args,
				startedAt: Date.now(),
			});
		} else if (record.type === "tool_execution_end") {
			this.activeTools.delete(record.toolCallId);
		} else if (record.type === "extension_ui_request") {
			if (record.method === "setStatus") {
				if (record.statusText) {
					this.statusEntries[record.statusKey] = record.statusText;
				} else {
					delete this.statusEntries[record.statusKey];
				}
			} else if (record.method === "setWidget") {
				if (record.widgetLines) {
					this.widgets[record.widgetKey] = {
						lines: record.widgetLines,
						placement: record.widgetPlacement || "aboveEditor",
					};
				} else {
					delete this.widgets[record.widgetKey];
				}
			}
		}

		// 3. Broadcast to GUI
		broadcastEvent({
			type: "rpc_event",
			workerId: this.workerId,
			cwd: this.cwd,
			event: record,
		});
	}

	async sendCommand(commandObj, timeoutMs = 60000) {
		if (!this.proc) {
			await this.start();
		}
		const id = commandObj.id || `req-${randomUUID()}`;
		const payload = { ...commandObj, id };
		const line = `${JSON.stringify(payload)}\n`;

		return new Promise((resolvePromise, rejectPromise) => {
			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				rejectPromise(new Error(`RPC command ${commandObj.type} timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			this.pendingRequests.set(id, {
				resolve: resolvePromise,
				reject: rejectPromise,
				timer,
			});

			this.proc.stdin.write(line, (err) => {
				if (err) {
					clearTimeout(timer);
					this.pendingRequests.delete(id);
					rejectPromise(err);
				}
			});
		});
	}

	sendRawRecord(recordObj) {
		if (!this.proc) return;
		this.proc.stdin.write(`${JSON.stringify(recordObj)}\n`);
	}

	async refreshState() {
		const res = await this.sendCommand({ type: "get_state" });
		if (res && res.success && res.data) {
			this.lastState = res.data;
			this.isStreaming = Boolean(res.data.isStreaming);
			if (res.data.sessionFile) {
				this.sessionFile = res.data.sessionFile;
			}
		}
		return this.lastState;
	}

	stop() {
		if (this.proc) {
			this.proc.kill("SIGTERM");
			this.proc = null;
		}
	}
}

const workers = new Map();

function getOrCreateWorker({ workerId, cwd, sessionFile }) {
	if (workerId && workers.has(workerId)) {
		return workers.get(workerId);
	}
	// Check if there's already a worker for this exact sessionFile
	if (sessionFile) {
		for (const w of workers.values()) {
			if (w.sessionFile === sessionFile) return w;
		}
	}
	const id = workerId || `thread-${randomUUID().slice(0, 8)}`;
	const resolvedCwd = cwd && existsSync(cwd) ? resolve(cwd) : loadWorkspaces()[0] || process.cwd();
	const worker = new RpcWorker({
		workerId: id,
		cwd: resolvedCwd,
		sessionFile: sessionFile || null,
	});
	workers.set(id, worker);
	return worker;
}

// =============================================================================
// Workspace File & Git Inspector Helpers
// =============================================================================

const IGNORED_DIRS = new Set([".git", "node_modules", ".next", "dist", ".artifacts", ".DS_Store"]);

function listWorkspaceFiles(cwd, relDir = "") {
	const baseDir = resolve(cwd);
	const targetDir = resolve(baseDir, relDir);
	if (!targetDir.startsWith(baseDir) || !existsSync(targetDir)) {
		return [];
	}
	const entries = readdirSync(targetDir, { withFileTypes: true });
	const items = [];
	for (const entry of entries) {
		if (entry.name === ".DS_Store" || entry.name === ".git") continue;
		const fullPath = join(targetDir, entry.name);
		const relativePath = relative(baseDir, fullPath);
		const isDir = entry.isDirectory();
		let size = 0;
		if (!isDir) {
			try {
				size = statSync(fullPath).size;
			} catch {
				size = 0;
			}
		}
		items.push({
			name: entry.name,
			path: relativePath,
			isDirectory: isDir,
			isIgnoredHeavy: IGNORED_DIRS.has(entry.name),
			size,
		});
	}
	items.sort((a, b) => {
		if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return items;
}

function searchWorkspaceFilesFlat(cwd, query = "", limit = 60) {
	const baseDir = resolve(cwd);
	const results = [];
	const lowerQuery = query.toLowerCase();

	function walk(dir, depth) {
		if (depth > 5 || results.length >= limit) return;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (results.length >= limit) break;
			if (IGNORED_DIRS.has(entry.name)) continue;
			const full = join(dir, entry.name);
			const rel = relative(baseDir, full);
			if (entry.isDirectory()) {
				walk(full, depth + 1);
			} else if (!lowerQuery || rel.toLowerCase().includes(lowerQuery)) {
				results.push(rel);
			}
		}
	}

	walk(baseDir, 0);
	return results;
}

async function getGitStatus(cwd) {
	try {
		const [branchRes, statusRes, diffStatRes] = await Promise.all([
			execFileAsync("git", ["branch", "--show-current"], { cwd, timeout: 5000 }).catch(() => ({ stdout: "" })),
			execFileAsync("git", ["status", "--porcelain", "-uall"], { cwd, timeout: 8000 }),
			execFileAsync("git", ["diff", "--numstat", "HEAD"], { cwd, timeout: 8000 }).catch(() => ({ stdout: "" })),
		]);

		const numstatMap = new Map();
		for (const line of diffStatRes.stdout.split("\n")) {
			if (!line.trim()) continue;
			const [added, deleted, file] = line.split("\t");
			if (file) {
				numstatMap.set(file.trim(), {
					added: added === "-" ? 0 : Number(added) || 0,
					deleted: deleted === "-" ? 0 : Number(deleted) || 0,
				});
			}
		}

		const files = [];
		for (const line of statusRes.stdout.split("\n")) {
			if (line.length < 4) continue;
			const status = line.slice(0, 2).trim();
			let filePath = line.slice(3).trim();
			if (filePath.includes(" -> ")) {
				filePath = filePath.split(" -> ").pop().trim();
			}
			if (filePath.startsWith('"') && filePath.endsWith('"')) {
				filePath = filePath.slice(1, -1);
			}
			const stats = numstatMap.get(filePath) || { added: 0, deleted: 0 };
			files.push({
				status,
				path: filePath,
				added: stats.added,
				deleted: stats.deleted,
			});
		}

		return {
			isGitRepo: true,
			branch: branchRes.stdout.trim() || "HEAD",
			files,
		};
	} catch {
		return {
			isGitRepo: false,
			branch: null,
			files: [],
		};
	}
}

async function getGitDiff(cwd, filePath) {
	const baseDir = resolve(cwd);
	try {
		const args = ["diff", "HEAD"];
		if (filePath) {
			args.push("--", filePath);
		}
		const { stdout } = await execFileAsync("git", args, {
			cwd: baseDir,
			maxBuffer: 4 * 1024 * 1024,
			timeout: 8000,
		});
		if (stdout.trim()) {
			return { diff: stdout };
		}
		// If empty diff (e.g. untracked new file), build synthetic diff for preview
		if (filePath) {
			const fullPath = resolve(baseDir, filePath);
			if (fullPath.startsWith(baseDir) && existsSync(fullPath)) {
				const content = readFileSync(fullPath, "utf-8").slice(0, 100_000);
				const lines = content.split("\n").map((l) => `+${l}`).join("\n");
				return {
					diff: `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${content.split("\n").length} @@\n${lines}`,
				};
			}
		}
		return { diff: "" };
	} catch (err) {
		return { diff: "", error: err.message };
	}
}

// =============================================================================
// HTTP API & Static Server
// =============================================================================

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
};

function readRequestBody(req) {
	return new Promise((resolvePromise, rejectPromise) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf-8");
				resolvePromise(raw ? JSON.parse(raw) : {});
			} catch (err) {
				rejectPromise(err);
			}
		});
		req.on("error", rejectPromise);
	});
}

function sendJson(res, status, data) {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
	const pathname = url.pathname;

	try {
		// SSE stream
		if (req.method === "GET" && pathname === "/api/events") {
			res.writeHead(200, {
				"Content-Type": "text/event-stream; charset=utf-8",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
			});
			res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
			sseClients.add(res);
			req.on("close", () => {
				sseClients.delete(res);
			});
			return;
		}

		// Bootstrap info (workspaces, persisted sessions, active workers)
		if (req.method === "GET" && pathname === "/api/bootstrap") {
			const workspaces = loadWorkspaces();
			const sessions = scanAllSessions();
			const activeWorkers = Array.from(workers.values()).map((w) => ({
				workerId: w.workerId,
				cwd: w.cwd,
				sessionFile: w.sessionFile,
				isStreaming: w.isStreaming,
				lastState: w.lastState,
				statusEntries: w.statusEntries,
				widgets: w.widgets,
			}));
			return sendJson(res, 200, {
				piCliPath: PI_CLI_PATH,
				workspaces,
				sessions,
				activeWorkers,
			});
		}

		// Add workspace (by path or native macOS folder picker)
		if (req.method === "POST" && pathname === "/api/workspaces") {
			const body = await readRequestBody(req);
			let targetPath = body.path;
			if (body.pickNative && process.platform === "darwin") {
				try {
					const { stdout } = await execFileAsync("osascript", [
						"-e",
						'POSIX path of (choose folder with prompt "Select Project Workspace for Pi Desktop:")',
					]);
					targetPath = stdout.trim();
				} catch {
					return sendJson(res, 200, { cancelled: true, workspaces: loadWorkspaces() });
				}
			}
			if (!targetPath || !existsSync(targetPath)) {
				return sendJson(res, 400, { error: `Directory does not exist: ${targetPath}` });
			}
			const resolved = resolve(targetPath);
			const current = loadWorkspaces();
			const updated = saveWorkspaces([resolved, ...current]);
			return sendJson(res, 200, { added: resolved, workspaces: updated });
		}

		// Create or connect a Thread Worker
		if (req.method === "POST" && pathname === "/api/thread/connect") {
			const body = await readRequestBody(req);
			const worker = getOrCreateWorker({
				workerId: body.workerId,
				cwd: body.cwd,
				sessionFile: body.sessionFile,
			});
			await worker.start();
			const [stateRes, messagesRes, modelsRes, thinkingRes, statsRes, commandsRes] = await Promise.all([
				worker.sendCommand({ type: "get_state" }),
				worker.sendCommand({ type: "get_messages" }),
				worker.sendCommand({ type: "get_available_models" }),
				worker.sendCommand({ type: "get_available_thinking_levels" }),
				worker.sendCommand({ type: "get_session_stats" }),
				worker.sendCommand({ type: "get_commands" }),
			]);

			const authProviders = getAuthenticatedProviders();
			const allModels = modelsRes?.data?.models || [];
			for (const response of [stateRes, messagesRes, modelsRes, thinkingRes, statsRes, commandsRes]) {
				if (!response?.success) throw new Error(response?.error || "Could not initialize Pi RPC");
			}

			// Sort models so authenticated providers appear first
			const sortedModels = [...allModels].sort((a, b) => {
				const aAuth = authProviders.includes(a.provider) ? 0 : 1;
				const bAuth = authProviders.includes(b.provider) ? 0 : 1;
				if (aAuth !== bAuth) return aAuth - bAuth;
				return `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`);
			});

			if (stateRes?.data) {
				worker.lastState = stateRes.data;
				if (stateRes.data.sessionFile) {
					worker.sessionFile = stateRes.data.sessionFile;
				}
			}

			return sendJson(res, 200, {
				workerId: worker.workerId,
				cwd: worker.cwd,
				sessionFile: worker.sessionFile,
				isStreaming: worker.isStreaming,
				activeTools: Array.from(worker.activeTools.values()),
				statusEntries: worker.statusEntries,
				widgets: worker.widgets,
				state: stateRes?.data || null,
				messages: messagesRes?.data?.messages || [],
				models: sortedModels,
				authenticatedProviders: authProviders,
				thinkingLevels: thinkingRes?.data?.levels || ["off"],
				stats: statsRes?.data || null,
				commands: commandsRes?.data?.commands || [],
			});
		}

		// Send any RPC command to a Thread Worker
		if (req.method === "POST" && pathname === "/api/thread/rpc") {
			const body = await readRequestBody(req);
			const { workerId, command } = body;
			if (!workerId || !workers.has(workerId)) {
				return sendJson(res, 404, { error: "Thread worker not found" });
			}
			const worker = workers.get(workerId);
			const response = await worker.sendCommand(command, body.timeoutMs || 120000);
			return sendJson(res, 200, response);
		}

		// Respond to an extension_ui_request dialog
		if (req.method === "POST" && pathname === "/api/thread/ui-response") {
			const body = await readRequestBody(req);
			const { workerId, response } = body;
			if (!workerId || !workers.has(workerId)) {
				return sendJson(res, 404, { error: "Thread worker not found" });
			}
			const worker = workers.get(workerId);
			worker.sendRawRecord({
				type: "extension_ui_response",
				...response,
			});
			return sendJson(res, 200, { ok: true });
		}

		// Workspace file tree
		if (req.method === "GET" && pathname === "/api/files") {
			const cwd = url.searchParams.get("cwd") || process.cwd();
			const dir = url.searchParams.get("dir") || "";
			return sendJson(res, 200, {
				cwd,
				dir,
				items: listWorkspaceFiles(cwd, dir),
			});
		}

		// Quick file search for @mention
		if (req.method === "GET" && pathname === "/api/files/search") {
			const cwd = url.searchParams.get("cwd") || process.cwd();
			const q = url.searchParams.get("q") || "";
			return sendJson(res, 200, {
				files: searchWorkspaceFilesFlat(cwd, q),
			});
		}

		// Read a workspace file
		if (req.method === "GET" && pathname === "/api/file") {
			const cwd = resolve(url.searchParams.get("cwd") || process.cwd());
			const relPath = url.searchParams.get("path") || "";
			const fullPath = resolve(cwd, relPath);
			if (!fullPath.startsWith(cwd) || !existsSync(fullPath)) {
				return sendJson(res, 404, { error: "File not found" });
			}
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				return sendJson(res, 400, { error: "Path is a directory" });
			}
			const maxBytes = 512 * 1024;
			const raw = readFileSync(fullPath);
			const truncated = raw.byteLength > maxBytes;
			const content = (truncated ? raw.subarray(0, maxBytes) : raw).toString("utf-8");
			return sendJson(res, 200, {
				path: relPath,
				size: stat.size,
				truncated,
				content,
			});
		}

		// Git status
		if (req.method === "GET" && pathname === "/api/git-status") {
			const cwd = url.searchParams.get("cwd") || process.cwd();
			const status = await getGitStatus(cwd);
			return sendJson(res, 200, status);
		}

		// Git diff
		if (req.method === "GET" && pathname === "/api/git-diff") {
			const cwd = url.searchParams.get("cwd") || process.cwd();
			const file = url.searchParams.get("file") || "";
			const diff = await getGitDiff(cwd, file);
			return sendJson(res, 200, diff);
		}

		// Static files
		const staticPath = pathname === "/" ? "/index.html" : pathname;
		const resolvedFile = resolve(PUBLIC_DIR, `.${staticPath}`);
		if (resolvedFile.startsWith(PUBLIC_DIR) && existsSync(resolvedFile) && statSync(resolvedFile).isFile()) {
			const ext = extname(resolvedFile);
			res.writeHead(200, {
				"Content-Type": MIME_TYPES[ext] || "application/octet-stream",
				"Cache-Control": "no-store",
			});
			res.end(readFileSync(resolvedFile));
			return;
		}

		sendJson(res, 404, { error: "Not found" });
	} catch (err) {
		sendJson(res, 500, { error: err?.message || String(err) });
	}
});

server.listen(PORT, HOST, () => {
	console.log(`Pi Desktop Backend running at http://${HOST}:${PORT}`);
	console.log(`Using Pi CLI: ${PI_CLI_PATH}`);
});

process.on("SIGINT", () => {
	for (const w of workers.values()) w.stop();
	process.exit(0);
});
process.on("SIGTERM", () => {
	for (const w of workers.values()) w.stop();
	process.exit(0);
});
