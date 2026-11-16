// ============================================================================
// Pi Desktop — OpenAI Codex Design Client
// ============================================================================

const state = {
	workspaces: [],
	currentWorkspace: "",
	persistedSessions: [],
	currentWorkerId: null,
	messages: [],
	streamingAssistant: null,
	toolExecutions: new Map(),
	models: [],
	thinkingLevels: ["off", "minimal", "low", "medium", "high"],
	commands: [],
	sessionState: null,
	sessionStats: null,
	currentBrowseDir: "",
	selectedPreviewFile: "",
	selectedDiffFile: "",
	isRunning: false,
	isConnecting: true,
	isSending: false,
	eventsConnected: false,
	connectionVersion: 0,
	statusError: "",
	runStatus: "",
	pendingPrompt: null,
	queuedInputs: [],
	activeWorkers: [],
};

const els = {
	leftSidebar: document.getElementById("leftSidebar"),
	toggleSidebarBtn: document.getElementById("toggleSidebarBtn"),
	themeToggleBtn: document.getElementById("themeToggleBtn"),
	workspaceDropdownWrap: document.getElementById("workspaceDropdownWrap"),
	workspacePickerBtn: document.getElementById("workspacePickerBtn"),
	workspacePickerLabel: document.getElementById("workspacePickerLabel"),
	workspaceDropdownMenu: document.getElementById("workspaceDropdownMenu"),
	workspaceOptionsList: document.getElementById("workspaceOptionsList"),
	composerStatus: document.getElementById("composerStatus"),
	reconnectBtn: document.getElementById("reconnectBtn"),
	addWorkspaceBtn: document.getElementById("addWorkspaceBtn"),
	newThreadBtn: document.getElementById("newThreadBtn"),
	threadList: document.getElementById("threadList"),
	rpcConnectionDot: document.getElementById("rpcConnectionDot"),
	sidebarStatsText: document.getElementById("sidebarStatsText"),

	threadRunIndicator: document.getElementById("threadRunIndicator"),
	threadTitleInput: document.getElementById("threadTitleInput"),
	contextMeterLabel: document.getElementById("contextMeterLabel"),
	compactBtn: document.getElementById("compactBtn"),
	toggleInspectorBtn: document.getElementById("toggleInspectorBtn"),
	diffSummaryBadge: document.getElementById("diffSummaryBadge"),
	closeInspectorBtn: document.getElementById("closeInspectorBtn"),
	refreshGitBtn: document.getElementById("refreshGitBtn"),
	extensionWidgetsBar: document.getElementById("extensionWidgetsBar"),

	timelineScroll: document.getElementById("timelineScroll"),
	timelineInner: document.getElementById("timelineInner"),

	autocompletePopover: document.getElementById("autocompletePopover"),
	bashDrawer: document.getElementById("bashDrawer"),
	bashCommandInput: document.getElementById("bashCommandInput"),
	bashOutputPre: document.getElementById("bashOutputPre"),
	runBashBtn: document.getElementById("runBashBtn"),

	promptInput: document.getElementById("promptInput"),
	repoQuickPill: document.getElementById("repoQuickPill"),
	composerRepoLabel: document.getElementById("composerRepoLabel"),
	composerBranchLabel: document.getElementById("composerBranchLabel"),

	modelDropdownWrap: document.getElementById("modelDropdownWrap"),
	modelPickerBtn: document.getElementById("modelPickerBtn"),
	modelPickerLabel: document.getElementById("modelPickerLabel"),
	modelDropdownMenu: document.getElementById("modelDropdownMenu"),
	modelSearchInput: document.getElementById("modelSearchInput"),
	modelOptionsList: document.getElementById("modelOptionsList"),

	thinkingDropdownWrap: document.getElementById("thinkingDropdownWrap"),
	thinkingPickerBtn: document.getElementById("thinkingPickerBtn"),
	thinkingPickerLabel: document.getElementById("thinkingPickerLabel"),
	thinkingDropdownMenu: document.getElementById("thinkingDropdownMenu"),
	thinkingOptionsList: document.getElementById("thinkingOptionsList"),

	toggleBashBtn: document.getElementById("toggleBashBtn"),
	abortBtn: document.getElementById("abortBtn"),
	sendPromptBtn: document.getElementById("sendPromptBtn"),

	inspectorPanel: document.getElementById("inspectorPanel"),
	tabBtnChanges: document.getElementById("tabBtnChanges"),
	tabBtnFiles: document.getElementById("tabBtnFiles"),
	tabPanelChanges: document.getElementById("tabPanelChanges"),
	tabPanelFiles: document.getElementById("tabPanelFiles"),

	changedFilesList: document.getElementById("changedFilesList"),
	diffViewer: document.getElementById("diffViewer"),

	currentDirBreadcrumb: document.getElementById("currentDirBreadcrumb"),
	upDirBtn: document.getElementById("upDirBtn"),
	fileTreeList: document.getElementById("fileTreeList"),
	insertFileMentionBtn: document.getElementById("insertFileMentionBtn"),
	fileCodeContent: document.getElementById("fileCodeContent"),

	extensionModalBackdrop: document.getElementById("extensionModalBackdrop"),
	extModalTitle: document.getElementById("extModalTitle"),
	extModalBody: document.getElementById("extModalBody"),
	extModalFooter: document.getElementById("extModalFooter"),
	toastContainer: document.getElementById("toastContainer"),
};

// ============================================================================
// Utilities & Markdown Renderer
// ============================================================================

function escapeHtml(str) {
	return String(str ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function renderMarkdown(text) {
	if (!text) return "";
	const codeBlocks = [];
	let out = String(text).replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
		const idx = codeBlocks.length;
		const cleanLang = escapeHtml(lang || "code");
		const cleanCode = escapeHtml(code.replace(/\n$/, ""));
		codeBlocks.push(
			`<div class="code-block-card"><div class="code-block-header"><span>${cleanLang}</span></div><pre><code>${cleanCode}</code></pre></div>`,
		);
		return `\u0000CODEBLOCK_${idx}\u0000`;
	});

	out = escapeHtml(out);
	out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
	out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	out = out.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
	out = out.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
	out = out.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
	out = out.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

	const paragraphs = out.split(/\n{2,}/).map((block) => {
		const trimmed = block.trim();
		if (!trimmed) return "";
		if (/^<(h[1-4]|div)/.test(trimmed) || /^\u0000CODEBLOCK_\d+\u0000$/.test(trimmed)) {
			return trimmed;
		}
		const lines = trimmed.split("\n");
		if (lines.every((l) => /^[-*]\s+/.test(l.trim()))) {
			const items = lines.map((l) => `<li>${l.trim().replace(/^[-*]\s+/, "")}</li>`).join("");
			return `<ul>${items}</ul>`;
		}
		return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
	});

	return paragraphs
		.join("\n")
		.replace(/\u0000CODEBLOCK_(\d+)\u0000/g, (_, idx) => codeBlocks[Number(idx)] || "");
}

function showToast(message, durationMs = 2400) {
	const item = document.createElement("div");
	item.className = "toast-item";
	item.textContent = message;
	els.toastContainer.appendChild(item);
	setTimeout(() => item.remove(), durationMs);
}

async function readApiResponse(res) {
	if (!res.ok) {
		const text = await res.text();
		let message = text;
		try { message = JSON.parse(text).error || text; } catch {}
		throw new Error(message || `请求失败（${res.status}）`);
	}
	return res.json();
}

async function apiGet(url) {
	return readApiResponse(await fetch(url));
}

async function apiPost(url, body) {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return readApiResponse(res);
}

async function sendRpc(command, timeoutMs = 120000) {
	if (!state.currentWorkerId) throw new Error("任务尚未连接，请稍候或重新连接");
	return apiPost("/api/thread/rpc", {
		workerId: state.currentWorkerId,
		command,
		timeoutMs,
	});
}

// ============================================================================
// SSE Event Stream
// ============================================================================

function renderConnectionStatus() {
	const ready = Boolean(state.currentWorkerId) && !state.isConnecting && state.eventsConnected;
	els.sendPromptBtn.disabled = !ready || state.isSending;
	els.modelPickerBtn.disabled = !ready || state.isRunning;
	els.thinkingPickerBtn.disabled = !ready || state.isRunning;
	els.newThreadBtn.disabled = state.isConnecting || state.isSending;
	els.rpcConnectionDot.classList.toggle("online", ready);
	let label = "已就绪";
	const queuedCount = state.queuedInputs.length;
	if (state.isConnecting) label = "正在连接任务…";
	else if (!state.eventsConnected) label = "连接中断，正在重连；输入已保留";
	else if (state.statusError) label = state.statusError;
	else if (state.isSending) label = "正在发送…";
	else if (state.isRunning) {
		label = state.runStatus || "正在等待模型回复…";
		if (queuedCount > 0) label += `（排队 ${queuedCount} 条）`;
	} else if (!state.currentWorkerId) label = "任务未连接，请重新连接";
	else if (queuedCount > 0) label = `已就绪 · ${queuedCount} 条消息排队中，下次运行时送达`;
	els.composerStatus.textContent = label;
	els.composerStatus.classList.toggle("error", Boolean(state.statusError));
	els.reconnectBtn.classList.toggle("hidden", state.isConnecting || (!state.statusError && Boolean(state.currentWorkerId)));
	els.sidebarStatsText.textContent = ready && !state.isRunning && !state.isSending && !state.statusError
		? state.statsLabel || "已就绪" : label;
}

function reportError(error) {
	state.statusError = error?.message || String(error);
	renderConnectionStatus();
	showToast(state.statusError, 6000);
}

function connectEventStream() {
	const es = new EventSource("/api/events");
	let openedBefore = false;
	es.onopen = () => {
		state.eventsConnected = true;
		renderConnectionStatus();
		if (openedBefore && state.currentWorkerId && !state.isConnecting) {
			connectThread({ workerId: state.currentWorkerId, cwd: state.currentWorkspace,
				sessionFile: state.sessionState?.sessionFile });
		}
		openedBefore = true;
	};
	es.onerror = () => {
		state.eventsConnected = false;
		renderConnectionStatus();
	};
	es.onmessage = (evt) => {
		try {
			const payload = JSON.parse(evt.data);
			if (payload.type === "rpc_event") {
				handleWorkerRpcEvent(payload.workerId, payload.event);
			} else if (["worker_exit", "worker_error"].includes(payload.type) && payload.workerId === state.currentWorkerId) {
				state.currentWorkerId = null;
				setStreamingUI(false);
				reportError(new Error("任务进程已退出，请重新连接"));
			}
		} catch (error) {
			console.error("Event processing failed", error);
			reportError(error);
		}
	};
}

function handleWorkerRpcEvent(workerId, event) {
	if (workerId !== state.currentWorkerId) return;

	switch (event.type) {
		case "agent_start":
			state.statusError = "";
			state.runStatus = "正在等待模型回复…";
			setStreamingUI(true);
			break;
		case "auto_retry_start":
			state.runStatus = `连接失败，正在重试（${event.attempt || 1}）…`;
			renderConnectionStatus();
			break;
		case "auto_retry_end":
			if (event.success === false) reportError(new Error(event.finalError || "模型请求失败，请检查所选模型和网络连接"));
			break;
		case "agent_settled":
			setStreamingUI(false);
			state.streamingAssistant = null;
			settlePendingInputs();
			refreshGitInspector().catch(reportError);
			break;
		case "queue_update":
			state.queuedInputs = [...(event.steering || []), ...(event.followUp || [])];
			if (state.pendingPrompt && state.queuedInputs.includes(state.pendingPrompt.content)) {
				state.pendingPrompt = null;
			}
			renderConnectionStatus();
			renderTimeline(true);
			break;
		case "message_start": {
			const msg = event.message;
			if (!msg) break;
			if (msg.role === "user") {
				const text = userMessageText(msg);
				if (state.pendingPrompt && state.pendingPrompt.content === text) state.pendingPrompt = null;
				const queuedIndex = state.queuedInputs.indexOf(text);
				if (queuedIndex !== -1) state.queuedInputs.splice(queuedIndex, 1);
				state.messages.push(msg);
				renderConnectionStatus();
				renderTimeline(true);
			} else if (msg.role === "assistant") {
				state.streamingAssistant = {
					role: "assistant",
					content: Array.isArray(msg.content) ? [...msg.content] : [],
					model: msg.model || state.sessionState?.model?.id || "assistant",
				};
				renderTimeline(true);
			}
			break;
		}
		case "message_update": {
			state.runStatus = "正在生成回复…";
			renderConnectionStatus();
			if (!state.streamingAssistant) {
				state.streamingAssistant = { role: "assistant", content: [] };
			}
			const ame = event.assistantMessageEvent;
			if (ame) {
				const idx = typeof ame.contentIndex === "number" ? ame.contentIndex : 0;
				while (state.streamingAssistant.content.length <= idx) {
					state.streamingAssistant.content.push({ type: "text", text: "" });
				}
				if (ame.type === "text_start") {
					state.streamingAssistant.content[idx] = { type: "text", text: "" };
				} else if (ame.type === "text_delta") {
					const block = state.streamingAssistant.content[idx];
					if (block?.type === "text") block.text += ame.delta || "";
					else state.streamingAssistant.content[idx] = { type: "text", text: ame.delta || "" };
				} else if (ame.type === "text_end") {
					state.streamingAssistant.content[idx] = { type: "text", text: ame.content || "" };
				} else if (ame.type === "thinking_start") {
					state.streamingAssistant.content[idx] = { type: "thinking", thinking: "" };
				} else if (ame.type === "thinking_delta") {
					const block = state.streamingAssistant.content[idx];
					if (block?.type === "thinking") block.thinking += ame.delta || "";
					else state.streamingAssistant.content[idx] = { type: "thinking", thinking: ame.delta || "" };
				} else if (ame.type === "thinking_end") {
					state.streamingAssistant.content[idx] = { type: "thinking", thinking: ame.content || "" };
				} else if (ame.type === "toolcall_start") {
					state.streamingAssistant.content[idx] = {
						type: "toolCall",
						id: ame.id,
						name: ame.toolName,
						arguments: {},
					};
				} else if (ame.type === "toolcall_end" && ame.toolCall) {
					state.streamingAssistant.content[idx] = ame.toolCall;
				}
			}
			renderTimeline(true);
			break;
		}
		case "message_end": {
			const msg = event.message;
			if (!msg) break;
			if (msg.role === "assistant") {
				state.streamingAssistant = null;
				state.messages.push(msg);
				if (msg.errorMessage) reportError(new Error(msg.errorMessage));
			} else if (msg.role === "toolResult") {
				state.messages.push(msg);
			}
			renderTimeline(true);
			break;
		}
		case "tool_execution_start":
			state.toolExecutions.set(event.toolCallId, {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				status: "running",
			});
			renderTimeline(true);
			break;
		case "tool_execution_update": {
			const prev = state.toolExecutions.get(event.toolCallId) || {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
			};
			prev.partialResult = event.partialResult;
			prev.status = "running";
			state.toolExecutions.set(event.toolCallId, prev);
			renderTimeline(true);
			break;
		}
		case "tool_execution_end": {
			const prev = state.toolExecutions.get(event.toolCallId) || {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
			};
			prev.result = event.result;
			prev.isError = event.isError;
			prev.durationMs = event.durationMs;
			prev.status = event.isError ? "error" : "done";
			state.toolExecutions.set(event.toolCallId, prev);
			renderTimeline(true);
			if (["edit", "write", "bash"].includes(String(event.toolName).toLowerCase())) {
				refreshGitInspector();
			}
			break;
		}
		case "session_info_changed":
			els.threadTitleInput.value = event.name || "";
			refreshBootstrapList();
			break;
		case "thinking_level_changed":
			if (event.level) {
				if (state.sessionState) state.sessionState.thinkingLevel = event.level;
				els.thinkingPickerLabel.textContent = event.level;
				renderThinkingDropdownOptions();
			}
			break;
		case "extension_ui_request":
			handleExtensionUiRequest(event);
			break;
	}
}

// ============================================================================
// Extension UI Dialogs
// ============================================================================

function handleExtensionUiRequest(req) {
	if (req.method === "notify") {
		showToast(req.message || "Notification");
		return;
	}
	if (req.method === "set_editor_text") {
		els.promptInput.value = req.text || "";
		return;
	}
	if (req.method === "setWidget") {
		if (Array.isArray(req.widgetLines) && req.widgetLines.length > 0) {
			els.extensionWidgetsBar.textContent = req.widgetLines.join("\n");
			els.extensionWidgetsBar.classList.remove("hidden");
		} else {
			els.extensionWidgetsBar.classList.add("hidden");
		}
		return;
	}

	if (!["select", "confirm", "input", "editor"].includes(req.method)) return;

	els.extModalTitle.textContent = req.title || "Confirm";
	els.extModalBody.innerHTML = "";
	els.extModalFooter.innerHTML = "";
	els.extensionModalBackdrop.classList.remove("hidden");

	const closeAndSend = async (responseFields) => {
		els.extensionModalBackdrop.classList.add("hidden");
		await apiPost("/api/thread/ui-response", {
			workerId: state.currentWorkerId,
			response: { id: req.id, ...responseFields },
		});
	};

	if (req.method === "confirm") {
		const p = document.createElement("p");
		p.textContent = req.message || "";
		els.extModalBody.appendChild(p);

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "pill-action-btn";
		cancelBtn.textContent = "Cancel";
		cancelBtn.onclick = () => closeAndSend({ confirmed: false });

		const okBtn = document.createElement("button");
		okBtn.className = "diff-toggle-btn";
		okBtn.textContent = "Confirm";
		okBtn.onclick = () => closeAndSend({ confirmed: true });
		els.extModalFooter.append(cancelBtn, okBtn);
	} else if (req.method === "select") {
		for (const opt of req.options || []) {
			const btn = document.createElement("button");
			btn.className = "pill-action-btn";
			btn.style.textAlign = "left";
			btn.textContent = opt;
			btn.onclick = () => closeAndSend({ value: opt });
			els.extModalBody.appendChild(btn);
		}
		const cancelBtn = document.createElement("button");
		cancelBtn.className = "pill-action-btn";
		cancelBtn.textContent = "Cancel";
		cancelBtn.onclick = () => closeAndSend({ cancelled: true });
		els.extModalFooter.appendChild(cancelBtn);
	} else if (req.method === "input" || req.method === "editor") {
		const inputEl =
			req.method === "editor" ? document.createElement("textarea") : document.createElement("input");
		if (req.method === "editor") {
			inputEl.rows = 5;
			inputEl.value = req.prefill || "";
		} else {
			inputEl.placeholder = req.placeholder || "";
		}
		els.extModalBody.appendChild(inputEl);

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "pill-action-btn";
		cancelBtn.textContent = "Cancel";
		cancelBtn.onclick = () => closeAndSend({ cancelled: true });

		const okBtn = document.createElement("button");
		okBtn.className = "diff-toggle-btn";
		okBtn.textContent = "Submit";
		okBtn.onclick = () => closeAndSend({ value: inputEl.value });
		els.extModalFooter.append(cancelBtn, okBtn);
		setTimeout(() => inputEl.focus(), 50);
	}
}

// ============================================================================
// Tasks & Workspaces
// ============================================================================

async function refreshBootstrapList() {
	const data = await apiGet("/api/bootstrap");
	state.workspaces = data.workspaces || [];
	state.persistedSessions = data.sessions || [];
	state.activeWorkers = data.activeWorkers || [];
	if (!state.currentWorkspace && state.workspaces.length > 0) {
		state.currentWorkspace = state.workspaces[0];
	}
	renderWorkspaceSelect();
	renderThreadList();
}

function renderWorkspaceSelect() {
	els.workspaceOptionsList.innerHTML = "";
	for (const ws of state.workspaces) {
		const selected = ws === state.currentWorkspace;
		const option = document.createElement("button");
		option.type = "button";
		option.className = `dropdown-option-item${selected ? " selected" : ""}`;
		option.title = ws;
		option.innerHTML = `<span class="dropdown-option-main">
			<span class="dropdown-option-title">${escapeHtml(ws.split("/").filter(Boolean).pop() || ws)}</span>
			<span class="dropdown-option-sub">${escapeHtml(ws)}</span></span>
			<span class="dropdown-option-check">${selected ? "✓" : ""}</span>`;
		option.onclick = () => {
			closeWorkspaceMenu();
			if (selected) return;
			const active = state.activeWorkers.find((w) => w.cwd === ws);
			connectThread({ workerId: active?.workerId, cwd: ws });
		};
		els.workspaceOptionsList.appendChild(option);
	}
	const repoName = (state.currentWorkspace || "").split("/").filter(Boolean).pop() || "workspace";
	els.composerRepoLabel.textContent = repoName;
	els.workspacePickerLabel.textContent = repoName;
	els.workspacePickerBtn.title = state.currentWorkspace || "切换或添加本地代码库";
}

function closeWorkspaceMenu() {
	els.workspaceDropdownMenu.classList.add("hidden");
	els.workspacePickerBtn.setAttribute("aria-expanded", "false");
}

function renderThreadList() {
	const workspaceSessions = state.persistedSessions.filter(
		(s) => !state.currentWorkspace || s.cwd === state.currentWorkspace,
	);
	els.threadList.innerHTML = "";

	if (workspaceSessions.length === 0) {
		const empty = document.createElement("div");
		empty.className = "empty-hint";
		empty.textContent = "No tasks yet";
		els.threadList.appendChild(empty);
		return;
	}

	const repoShort = (state.currentWorkspace || "").split("/").filter(Boolean).pop() || "repo";

	for (const sess of workspaceSessions) {
		const item = document.createElement("div");
		const isActive = state.sessionState?.sessionFile === sess.sessionFile;
		item.className = `task-item${isActive ? " active" : ""}`;

		const row1 = document.createElement("div");
		row1.className = "task-item-row1";

		const title = document.createElement("span");
		title.className = "task-item-title";
		title.textContent = sess.name || "Untitled task";

		const time = document.createElement("span");
		time.className = "task-item-time";
		time.textContent = new Date(sess.updatedAtMs).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		});

		row1.append(title, time);

		const row2 = document.createElement("div");
		row2.className = "task-item-row2";
		row2.innerHTML = `<span>${escapeHtml(repoShort)}</span><span>${sess.messageCount} turns</span>`;

		item.append(row1, row2);
		item.onclick = () =>
			connectThread({
				cwd: sess.cwd || state.currentWorkspace,
				sessionFile: sess.sessionFile,
			});
		els.threadList.appendChild(item);
	}
}

async function connectThread({ workerId, cwd, sessionFile }) {
	const targetCwd = cwd || state.currentWorkspace;
	const version = ++state.connectionVersion;
	state.isConnecting = true;
	state.statusError = "";
	renderConnectionStatus();
	try {
	const data = await apiPost("/api/thread/connect", {
		workerId,
		cwd: targetCwd,
		sessionFile,
	});

	if (version !== state.connectionVersion) return;
	state.isConnecting = false;
	state.pendingPrompt = null;
	state.queuedInputs = [];
	state.currentWorkerId = data.workerId;
	localStorage.setItem("pi-desktop-thread", JSON.stringify({ workerId: data.workerId, cwd: data.cwd, sessionFile: data.state?.sessionFile }));
	state.currentWorkspace = data.cwd;
	state.sessionState = data.state;
	state.messages = data.messages || [];
	state.models = data.models || [];
	state.thinkingLevels = data.thinkingLevels || ["off"];
	state.sessionStats = data.stats;
	state.commands = data.commands || [];
	state.streamingAssistant = null;
	state.toolExecutions.clear();

	for (const msg of state.messages) {
		if (msg.role === "toolResult" && msg.toolCallId) {
			state.toolExecutions.set(msg.toolCallId, {
				toolCallId: msg.toolCallId,
				toolName: msg.toolName,
				result: msg,
				isError: msg.isError,
				status: msg.isError ? "error" : "done",
			});
		}
	}

	setStreamingUI(Boolean(data.isStreaming));
	els.threadTitleInput.value = data.state?.sessionName || "";
	renderModelAndThinkingControls();
	renderStatsAndContext();
	renderTimeline(true);
	renderWorkspaceSelect();
	await refreshBootstrapList();
	await Promise.all([refreshGitInspector(), loadFileTree("")]);
	} catch (error) {
		if (version === state.connectionVersion) reportError(error);
	} finally {
		if (version === state.connectionVersion) {
			state.isConnecting = false;
			renderConnectionStatus();
		}
	}
}

async function refreshThreadSnapshot() {
	if (!state.currentWorkerId) return;
	const workerId = state.currentWorkerId;
	const version = state.connectionVersion;
	const [stateRes, messagesRes, statsRes] = await Promise.all([
		sendRpc({ type: "get_state" }),
		sendRpc({ type: "get_messages" }),
		sendRpc({ type: "get_session_stats" }),
	]);
	if (workerId !== state.currentWorkerId || version !== state.connectionVersion) return;
	if (stateRes?.data) {
		state.sessionState = stateRes.data;
		setStreamingUI(Boolean(stateRes.data.isStreaming));
		els.threadTitleInput.value = stateRes.data.sessionName || "";
		renderModelAndThinkingControls();
		localStorage.setItem("pi-desktop-thread", JSON.stringify({ workerId, cwd: state.currentWorkspace, sessionFile: stateRes.data.sessionFile }));
	}
	if (messagesRes?.data?.messages) {
		state.messages = messagesRes.data.messages;
		reconcileDeliveredInputs();
		for (const msg of state.messages) {
			if (msg.role === "toolResult" && msg.toolCallId) {
				const existing = state.toolExecutions.get(msg.toolCallId) || {};
				state.toolExecutions.set(msg.toolCallId, {
					...existing,
					toolCallId: msg.toolCallId,
					toolName: msg.toolName,
					result: msg,
					isError: msg.isError,
					status: msg.isError ? "error" : "done",
				});
			}
		}
	}
	if (statsRes?.data) state.sessionStats = statsRes.data;
	renderStatsAndContext();
	renderTimeline(false);
	await refreshBootstrapList();
}

function setStreamingUI(isStreaming) {
	state.isRunning = isStreaming;
	els.threadRunIndicator.classList.toggle("hidden", !isStreaming);
	els.abortBtn.classList.toggle("hidden", !isStreaming);
	if (!isStreaming) state.runStatus = "";
	renderConnectionStatus();
}

function renderModelDropdownOptions(filterQuery = "") {
	els.modelOptionsList.innerHTML = "";
	const currentModel = state.sessionState?.model;
	const models = state.models.length > 0 ? state.models : currentModel ? [currentModel] : [];
	const q = filterQuery.trim().toLowerCase();

	const filtered = models.filter(
		(m) =>
			!q ||
			(m.name && m.name.toLowerCase().includes(q)) ||
			(m.id && m.id.toLowerCase().includes(q)) ||
			(m.provider && m.provider.toLowerCase().includes(q)),
	);

	if (filtered.length === 0) {
		els.modelOptionsList.innerHTML = `<div class="empty-hint" style="padding:14px;">无匹配模型</div>`;
		return;
	}

	for (const m of filtered) {
		const isSelected = Boolean(
			currentModel && m.provider === currentModel.provider && m.id === currentModel.id,
		);
		const item = document.createElement("div");
		item.className = `dropdown-option-item${isSelected ? " selected" : ""}`;
		item.innerHTML = `
			<div class="dropdown-option-main">
				<span class="dropdown-option-title">${escapeHtml(m.name || m.id)}</span>
				<span class="dropdown-option-sub">${escapeHtml(m.provider)} · ${escapeHtml(m.id)}</span>
			</div>
			<span class="dropdown-option-check">${isSelected ? "✓" : ""}</span>
		`;
		item.onclick = async () => {
			els.modelDropdownMenu.classList.add("hidden");
			els.modelPickerBtn.classList.remove("open");
			const res = await sendRpc({ type: "set_model", provider: m.provider, modelId: m.id });
			if (res?.success) {
				if (state.sessionState) state.sessionState.model = res.data || m;
				els.modelPickerLabel.textContent = m.name || m.id;
				const thRes = await sendRpc({ type: "get_available_thinking_levels" });
				if (thRes?.data?.levels) {
					state.thinkingLevels = thRes.data.levels;
				}
				renderModelAndThinkingControls();
			}
		};
		els.modelOptionsList.appendChild(item);
	}
}

function renderThinkingDropdownOptions() {
	els.thinkingOptionsList.innerHTML = "";
	const currentLevel = state.sessionState?.thinkingLevel || "medium";
	els.thinkingPickerLabel.textContent = currentLevel;

	for (const lvl of state.thinkingLevels) {
		const isSelected = lvl === currentLevel;
		const item = document.createElement("div");
		item.className = `dropdown-option-item${isSelected ? " selected" : ""}`;
		item.innerHTML = `
			<span class="dropdown-option-title">${escapeHtml(lvl)}</span>
			<span class="dropdown-option-check">${isSelected ? "✓" : ""}</span>
		`;
		item.onclick = async () => {
			els.thinkingDropdownMenu.classList.add("hidden");
			els.thinkingPickerBtn.classList.remove("open");
			if (state.sessionState) state.sessionState.thinkingLevel = lvl;
			els.thinkingPickerLabel.textContent = lvl;
			renderThinkingDropdownOptions();
			await sendRpc({ type: "set_thinking_level", level: lvl });
		};
		els.thinkingOptionsList.appendChild(item);
	}
}

function renderModelAndThinkingControls() {
	const currentModel = state.sessionState?.model;
	els.modelPickerLabel.textContent = currentModel
		? currentModel.name || currentModel.id
		: state.models[0]?.name || state.models[0]?.id || "选择模型";

	renderModelDropdownOptions(els.modelSearchInput?.value || "");
	renderThinkingDropdownOptions();
}

function renderStatsAndContext() {
	const stats = state.sessionStats;
	if (!stats) return;
	const totalTokens = stats.tokens?.total || 0;
	const cost = Number(stats.cost || 0).toFixed(3);
	state.statsLabel = totalTokens > 0 ? `${totalTokens.toLocaleString()} tok · $${cost}` : "已就绪";
	renderConnectionStatus();

	const pct = Math.min(100, Math.round(stats.contextUsage?.percent || 0));
	els.contextMeterLabel.textContent = `${pct}% context`;
}

// ============================================================================
// Codex Timeline & Step Trace Rendering
// ============================================================================

function formatToolVerbAndTarget(name, args) {
	const lower = String(name || "tool").toLowerCase();
	const target =
		args?.file_path ||
		args?.path ||
		args?.command ||
		args?.pattern ||
		(typeof Object.values(args || {})[0] === "string" ? Object.values(args)[0] : "");

	if (lower === "read") return { verb: "Read", target };
	if (lower === "edit") return { verb: "Edited", target };
	if (lower === "write") return { verb: "Wrote", target };
	if (lower === "bash") return { verb: "Ran", target };
	return { verb: name || "Tool", target };
}

function extractResultText(resultObj) {
	if (!resultObj) return "";
	const content = resultObj.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c) => c && c.type === "text")
			.map((c) => c.text)
			.join("\n");
	}
	return JSON.stringify(resultObj, null, 2);
}

function createThinkingStepElement(thinkingText, isLive) {
	const step = document.createElement("div");
	step.className = "trace-step";

	const header = document.createElement("div");
	header.className = "trace-step-header";
	header.innerHTML = `
		<span class="trace-step-verb">Thought</span>
		<span class="trace-step-target">${escapeHtml(thinkingText.split("\n")[0].slice(0, 72))}</span>
		<span class="trace-step-meta ${isLive ? "running" : ""}">${isLive ? "thinking..." : ""}</span>
	`;

	const body = document.createElement("div");
	body.className = `trace-step-body${isLive ? "" : " hidden"}`;
	body.textContent = thinkingText;

	header.onclick = () => body.classList.toggle("hidden");
	step.append(header, body);
	return step;
}

function createToolStepElement(toolCall) {
	const exec = state.toolExecutions.get(toolCall.id) || {
		toolName: toolCall.name,
		args: toolCall.arguments,
		status: "pending",
	};

	const { verb, target } = formatToolVerbAndTarget(
		toolCall.name || exec.toolName,
		toolCall.arguments || exec.args,
	);

	const step = document.createElement("div");
	step.className = "trace-step";

	const header = document.createElement("div");
	header.className = "trace-step-header";

	let metaText = "";
	let metaCls = "trace-step-meta";
	if (exec.status === "running") {
		metaText = "running...";
		metaCls += " running";
	} else if (exec.isError) {
		metaText = "failed";
		metaCls += " error";
	} else if (exec.durationMs) {
		metaText = `${exec.durationMs}ms`;
	}

	header.innerHTML = `
		<span class="trace-step-verb">${escapeHtml(verb)}</span>
		<span class="trace-step-target">${escapeHtml(target)}</span>
		<span class="${metaCls}">${escapeHtml(metaText)}</span>
	`;

	const body = document.createElement("div");
	body.className = "trace-step-body hidden";
	const outputText = extractResultText(exec.result || exec.partialResult);
	const argsText = JSON.stringify(toolCall.arguments || exec.args || {}, null, 2);
	body.textContent = outputText ? `${outputText}` : argsText;

	header.onclick = () => body.classList.toggle("hidden");
	step.append(header, body);
	return step;
}

function renderAssistantTurn(msg, isLive = false) {
	const wrapper = document.createElement("div");
	wrapper.className = "msg-assistant";

	const blocks = Array.isArray(msg.content) ? msg.content : [];
	let currentStepList = null;

	for (const block of blocks) {
		if (!block) continue;
		if (block.type === "thinking" && block.thinking) {
			if (!currentStepList) {
				currentStepList = document.createElement("div");
				currentStepList.className = "step-trace-list";
				wrapper.appendChild(currentStepList);
			}
			currentStepList.appendChild(createThinkingStepElement(block.thinking, isLive));
		} else if (block.type === "toolCall") {
			if (!currentStepList) {
				currentStepList = document.createElement("div");
				currentStepList.className = "step-trace-list";
				wrapper.appendChild(currentStepList);
			}
			currentStepList.appendChild(createToolStepElement(block));
		} else if (block.type === "text" && block.text) {
			currentStepList = null;
			const prose = document.createElement("div");
			prose.className = "md-prose";
			prose.innerHTML = renderMarkdown(block.text);
			wrapper.appendChild(prose);
		}
	}

	if (msg.errorMessage) {
		const errDiv = document.createElement("div");
		errDiv.style.color = "var(--red)";
		errDiv.style.fontSize = "13px";
		errDiv.textContent = msg.errorMessage;
		wrapper.appendChild(errDiv);
	}

	return wrapper;
}

function userMessageText(msg) {
	if (typeof msg.content === "string") return msg.content;
	return (msg.content || [])
		.filter((c) => c?.type === "text")
		.map((c) => c.text)
		.join("\n");
}

// Drop queued/pending entries whose text is already in the transcript, mirroring
// how the engine drains its steer queue when a message is delivered.
function reconcileDeliveredInputs() {
	const delivered = new Set(state.messages.filter((m) => m.role === "user").map(userMessageText));
	state.queuedInputs = state.queuedInputs.filter((text) => !delivered.has(text));
	if (state.pendingPrompt && delivered.has(state.pendingPrompt.content)) state.pendingPrompt = null;
}

// After a run settles, decide what happened to messages the user sent mid-run.
// Kept if the engine still queues them (pendingMessageCount); restored to the
// composer if the engine settled without delivering them, so input is never lost.
async function settlePendingInputs() {
	const workerId = state.currentWorkerId;
	const version = state.connectionVersion;
	try {
		await refreshThreadSnapshot();
	} catch (error) {
		if (workerId === state.currentWorkerId && version === state.connectionVersion) reportError(error);
		return;
	}
	if (workerId !== state.currentWorkerId || version !== state.connectionVersion) return;
	reconcileDeliveredInputs();
	if ((state.sessionState?.pendingMessageCount || 0) > 0) {
		renderConnectionStatus();
		renderTimeline(false);
		return;
	}
	const lost = [];
	if (state.pendingPrompt) lost.push(state.pendingPrompt.content);
	lost.push(...state.queuedInputs);
	if (lost.length === 0) return;
	state.pendingPrompt = null;
	state.queuedInputs = [];
	const draft = els.promptInput.value.trim();
	els.promptInput.value = draft ? `${lost.join("\n")}\n${draft}` : lost.join("\n");
	reportError(new Error("任务已结束，部分消息未送达，已放回输入框"));
	renderTimeline(false);
	renderConnectionStatus();
}

function renderBashExecution(msg) {
	const wrap = document.createElement("div");
	wrap.className = "bash-exec-block";
	const head = document.createElement("button");
	head.type = "button";
	head.className = "bash-exec-head";
	head.textContent = `$ ${msg.command}${msg.exitCode ? ` · exit ${msg.exitCode}` : ""}${msg.truncated ? " · 截断" : ""}`;
	const out = document.createElement("pre");
	out.className = "bash-exec-out";
	out.textContent = msg.output || "(no output)";
	head.onclick = () => wrap.classList.toggle("collapsed");
	wrap.appendChild(head);
	wrap.appendChild(out);
	return wrap;
}

function renderTimeline(scrollToBottom = false) {
	els.timelineInner.innerHTML = "";

	const visibleMessages = state.messages.filter(
		(m) => m.role === "user" || m.role === "assistant" || m.role === "bashExecution",
	);
	if (state.pendingPrompt) visibleMessages.push(state.pendingPrompt);
	for (const text of state.queuedInputs) visibleMessages.push({ role: "user", content: text, queued: true });

	if (visibleMessages.length === 0 && !state.streamingAssistant) {
		const hero = document.createElement("div");
		hero.className = "codex-empty-hero";
		hero.innerHTML = `
			<h1 class="codex-empty-title">What are we coding next?</h1>
			<div class="codex-starter-pills">
				<button class="codex-starter-pill" data-prompt="Explain the architecture and key modules of this codebase">Explain codebase</button>
				<button class="codex-starter-pill" data-prompt="Review uncommitted git changes for bugs and edge cases">Review git diff</button>
				<button class="codex-starter-pill" data-prompt="Run checks or tests and fix any failing issues">Run checks &amp; fix</button>
				<button class="codex-starter-pill" data-prompt="Find and simplify duplicated or overly complex logic">Refactor &amp; simplify</button>
			</div>
		`;
		for (const pill of hero.querySelectorAll(".codex-starter-pill")) {
			pill.onclick = () => {
				els.promptInput.value = pill.getAttribute("data-prompt") || "";
				els.promptInput.focus();
			};
		}
		els.timelineInner.appendChild(hero);
		return;
	}

	for (const msg of visibleMessages) {
		if (msg.role === "user") {
			const u = document.createElement("div");
			u.className = msg.queued ? "msg-user queued" : "msg-user";
			u.textContent =
				typeof msg.content === "string"
					? msg.content
					: (msg.content || [])
							.filter((c) => c?.type === "text")
							.map((c) => c.text)
							.join("\n");
			els.timelineInner.appendChild(u);
		} else if (msg.role === "assistant") {
			els.timelineInner.appendChild(renderAssistantTurn(msg, false));
		} else if (msg.role === "bashExecution") {
			els.timelineInner.appendChild(renderBashExecution(msg));
		}
	}

	if (state.streamingAssistant) {
		els.timelineInner.appendChild(renderAssistantTurn(state.streamingAssistant, true));
	}

	if (scrollToBottom) {
		els.timelineScroll.scrollTop = els.timelineScroll.scrollHeight;
	}
}

// ============================================================================
// Right Diff & File Review Pane
// ============================================================================

async function refreshGitInspector() {
	if (!state.currentWorkspace) return;
	const data = await apiGet(`/api/git-status?cwd=${encodeURIComponent(state.currentWorkspace)}`);
	els.composerBranchLabel.textContent = data.isGitRepo ? data.branch || "HEAD" : "local";

	const files = data.files || [];
	let totalAdd = 0;
	let totalDel = 0;
	for (const f of files) {
		totalAdd += f.added || 0;
		totalDel += f.deleted || 0;
	}

	if (files.length > 0) {
		els.diffSummaryBadge.innerHTML = `<span class="add">+${totalAdd}</span><span class="del">-${totalDel}</span>`;
	} else {
		els.diffSummaryBadge.textContent = "Diff";
	}

	els.changedFilesList.innerHTML = "";
	if (files.length === 0) {
		els.changedFilesList.innerHTML = `<div class="empty-hint">Working tree clean</div>`;
		els.diffViewer.innerHTML = `<div class="empty-hint">No uncommitted changes</div>`;
		return;
	}

	for (const f of files) {
		const row = document.createElement("div");
		row.className = `file-row${state.selectedDiffFile === f.path ? " active" : ""}`;
		row.innerHTML = `
			<span class="file-row-path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>
			<span class="diff-stat">
				${f.added ? `<span class="add">+${f.added}</span>` : ""}
				${f.deleted ? `<span class="del">-${f.deleted}</span>` : ""}
			</span>
		`;
		row.onclick = () => loadFileDiff(f.path);
		els.changedFilesList.appendChild(row);
	}

	if (!state.selectedDiffFile && files.length > 0) {
		loadFileDiff(files[0].path);
	}
}

async function loadFileDiff(filePath) {
	state.selectedDiffFile = filePath;
	const res = await apiGet(
		`/api/git-diff?cwd=${encodeURIComponent(state.currentWorkspace)}&file=${encodeURIComponent(filePath)}`,
	);
	els.diffViewer.innerHTML = "";
	if (!res.diff) return;
	for (const line of res.diff.split("\n")) {
		const div = document.createElement("div");
		let cls = "diff-line";
		if (line.startsWith("+") && !line.startsWith("+++")) cls += " add";
		else if (line.startsWith("-") && !line.startsWith("---")) cls += " del";
		else if (line.startsWith("@@")) cls += " hunk";
		div.className = cls;
		div.textContent = line;
		els.diffViewer.appendChild(div);
	}
}

async function loadFileTree(relDir = "") {
	state.currentBrowseDir = relDir;
	els.currentDirBreadcrumb.textContent = `/${relDir}`;
	const data = await apiGet(
		`/api/files?cwd=${encodeURIComponent(state.currentWorkspace)}&dir=${encodeURIComponent(relDir)}`,
	);
	els.fileTreeList.innerHTML = "";

	for (const item of data.items || []) {
		const row = document.createElement("div");
		row.className = "file-row";
		row.innerHTML = `<span class="file-row-path">${item.isDirectory ? "▸ " : ""}${escapeHtml(item.name)}</span>`;
		row.onclick = async () => {
			if (item.isDirectory) {
				loadFileTree(item.path);
			} else {
				state.selectedPreviewFile = item.path;
				els.insertFileMentionBtn.classList.remove("hidden");
				const fileData = await apiGet(
					`/api/file?cwd=${encodeURIComponent(state.currentWorkspace)}&path=${encodeURIComponent(item.path)}`,
				);
				els.fileCodeContent.textContent = fileData.content || "";
			}
		};
		els.fileTreeList.appendChild(row);
	}
}

// ============================================================================
// Composer & Autocomplete
// ============================================================================

async function submitPrompt() {
	const draft = els.promptInput.value;
	const text = draft.trim();
	if (!text || state.isSending) return;
	if (state.isConnecting || !state.currentWorkerId || !state.eventsConnected) {
		showToast("连接尚未就绪，输入已保留，请稍候或重新连接", 5000);
		return;
	}
	if (state.pendingPrompt?.content === text || state.queuedInputs.includes(text)) {
		showToast("相同内容已在发送队列中", 4000);
		return;
	}
	const workerId = state.currentWorkerId;
	const wasRunning = state.isRunning;
	state.isSending = true;
	state.statusError = "";
	state.pendingPrompt = { role: "user", content: text };
	renderConnectionStatus();
	renderTimeline(true);
	els.autocompletePopover.classList.add("hidden");
	try {
		let steered = wasRunning;
		let res = await sendRpc({ type: "prompt", message: text,
			...(wasRunning ? { streamingBehavior: "steer" } : {}) });
		if (!res?.success && !wasRunning && /already processing|streamingBehavior/i.test(res?.error || "")) {
			// The UI thought the agent was idle but the engine is still streaming (for example
			// after an event-stream gap). Retry as a steering message instead of failing.
			steered = true;
			res = await sendRpc({ type: "prompt", message: text, streamingBehavior: "steer" });
		}
		if (!res?.success) throw new Error(res?.error || "发送失败");
		if (els.promptInput.value === draft) els.promptInput.value = "";
		if (workerId === state.currentWorkerId && steered) showToast("消息已加入当前任务");
	} catch (error) {
		if (workerId === state.currentWorkerId) {
			state.pendingPrompt = null;
			reportError(error);
			renderTimeline(false);
		}
	} finally {
		state.isSending = false;
		renderConnectionStatus();
	}
}

async function showFileAutocomplete(query = "") {
	const data = await apiGet(
		`/api/files/search?cwd=${encodeURIComponent(state.currentWorkspace)}&q=${encodeURIComponent(query)}`,
	);
	const files = data.files || [];
	if (files.length === 0) {
		els.autocompletePopover.classList.add("hidden");
		return;
	}
	els.autocompletePopover.innerHTML = "";
	for (const f of files.slice(0, 15)) {
		const row = document.createElement("div");
		row.className = "autocomplete-item";
		row.innerHTML = `<span>${escapeHtml(f)}</span>`;
		row.onclick = () => {
			const val = els.promptInput.value;
			els.promptInput.value = val.replace(/@[^\s@]*$/, `${f} `);
			els.autocompletePopover.classList.add("hidden");
			els.promptInput.focus();
		};
		els.autocompletePopover.appendChild(row);
	}
	els.autocompletePopover.classList.remove("hidden");
}

function showCommandAutocomplete(query = "") {
	const q = query.toLowerCase();
	const list = state.commands.filter((c) => !q || c.name.toLowerCase().includes(q));
	if (list.length === 0) {
		els.autocompletePopover.classList.add("hidden");
		return;
	}
	els.autocompletePopover.innerHTML = "";
	for (const cmd of list.slice(0, 15)) {
		const row = document.createElement("div");
		row.className = "autocomplete-item";
		row.innerHTML = `<span>/${escapeHtml(cmd.name)}</span><span class="autocomplete-desc">${escapeHtml(cmd.description || "")}</span>`;
		row.onclick = () => {
			els.promptInput.value = `/${cmd.name} `;
			els.autocompletePopover.classList.add("hidden");
			els.promptInput.focus();
		};
		els.autocompletePopover.appendChild(row);
	}
	els.autocompletePopover.classList.remove("hidden");
}

// ============================================================================
// Event Bindings
// ============================================================================

function bindEvents() {
	// Theme toggle (Codex Dark / Codex Light)
	if (localStorage.getItem("codex-theme") === "light") {
		document.body.classList.add("theme-light");
	}
	els.themeToggleBtn.onclick = () => {
		const isLight = document.body.classList.toggle("theme-light");
		localStorage.setItem("codex-theme", isLight ? "light" : "dark");
	};

	// Sidebar collapse
	els.toggleSidebarBtn.onclick = () => {
		els.leftSidebar.classList.toggle("collapsed");
	};

	els.sendPromptBtn.onclick = submitPrompt;

	// IME (Pinyin etc.) guard. WebKit fires compositionend BEFORE the Enter
	// keydown that commits the composition, and composition keydowns can arrive
	// with isComposing=false / keyCode=229. Track composition state ourselves
	// and clear it one tick late so the committing Enter is never treated as
	// a send.
	let imeComposing = false;
	els.promptInput.addEventListener("compositionstart", () => {
		imeComposing = true;
	});
	els.promptInput.addEventListener("compositionend", () => {
		setTimeout(() => {
			imeComposing = false;
		}, 0);
	});
	els.promptInput.addEventListener("keydown", (e) => {
		const imeActive = imeComposing || e.isComposing || e.keyCode === 229;
		if (e.key === "Enter" && !e.shiftKey && !imeActive) {
			e.preventDefault();
			submitPrompt();
		} else if (e.key === "Escape") {
			els.autocompletePopover.classList.add("hidden");
		}
	});

	els.promptInput.addEventListener("input", () => {
		const val = els.promptInput.value;
		const atMatch = /@([^\s@]*)$/.exec(val);
		if (atMatch) {
			showFileAutocomplete(atMatch[1]);
			return;
		}
		const slashMatch = /^\/([^\s]*)$/.exec(val);
		if (slashMatch) {
			showCommandAutocomplete(slashMatch[1]);
			return;
		}
		els.autocompletePopover.classList.add("hidden");
	});

	els.toggleBashBtn.onclick = () => {
		const show = els.bashDrawer.classList.toggle("hidden");
		if (!els.bashDrawer.classList.contains("hidden")) {
			els.bashCommandInput.focus();
		} else {
			els.bashOutputPre.classList.add("hidden");
		}
	};

	const executeDirectBash = async () => {
		const command = els.bashCommandInput.value.trim();
		if (!command) return;
		els.bashCommandInput.value = "";
		els.bashOutputPre.classList.remove("hidden");
		els.bashOutputPre.textContent = `$ ${command}\n…`;
		els.runBashBtn.disabled = true;
		let res;
		try {
			res = await sendRpc({ type: "bash", command });
		} catch (error) {
			res = { success: false, error: error?.message || String(error) };
		} finally {
			els.runBashBtn.disabled = false;
		}
		if (res?.success) {
			const r = res.data || {};
			const parts = [`$ ${command}`, r.output || "(no output)"];
			if (r.exitCode) parts.push(`[exit ${r.exitCode}]`);
			if (r.truncated) parts.push("[输出过长已截断，完整输出已加入任务上下文]");
			els.bashOutputPre.textContent = parts.join("\n");
			refreshThreadSnapshot();
			refreshGitInspector();
		} else {
			els.bashOutputPre.textContent = `$ ${command}\n执行失败: ${res?.error || "error"}`;
		}
		els.bashCommandInput.focus();
	};

	els.runBashBtn.onclick = executeDirectBash;
	let bashImeComposing = false;
	els.bashCommandInput.addEventListener("compositionstart", () => {
		bashImeComposing = true;
	});
	els.bashCommandInput.addEventListener("compositionend", () => {
		setTimeout(() => {
			bashImeComposing = false;
		}, 0);
	});
	els.bashCommandInput.addEventListener("keydown", (e) => {
		const imeActive = bashImeComposing || e.isComposing || e.keyCode === 229;
		if (e.key === "Enter" && !imeActive) executeDirectBash();
		if (e.key === "Escape") {
			els.bashDrawer.classList.add("hidden");
			els.bashOutputPre.classList.add("hidden");
		}
	});

	els.abortBtn.onclick = async () => {
		await sendRpc({ type: "clear_queue" });
		await sendRpc({ type: "abort" });
	};

	els.newThreadBtn.onclick = () => connectThread({ cwd: state.currentWorkspace });
	els.reconnectBtn.onclick = () => connectThread({ workerId: state.currentWorkerId,
		cwd: state.currentWorkspace, sessionFile: state.sessionState?.sessionFile });
	els.workspacePickerBtn.onclick = (event) => {
		event.stopPropagation();
		els.modelDropdownMenu.classList.add("hidden");
		els.thinkingDropdownMenu.classList.add("hidden");
		const hidden = els.workspaceDropdownMenu.classList.toggle("hidden");
		els.workspacePickerBtn.setAttribute("aria-expanded", String(!hidden));
	};

	const pickWorkspace = async () => {
		closeWorkspaceMenu();
		const res = await apiPost("/api/workspaces", { pickNative: true });
		if (res.added) {
			state.workspaces = res.workspaces;
			state.currentWorkspace = res.added;
			await connectThread({ cwd: res.added });
		}
	};
	els.addWorkspaceBtn.onclick = pickWorkspace;
	els.repoQuickPill.onclick = pickWorkspace;

	els.modelPickerBtn.onclick = (e) => {
		e.stopPropagation();
		els.thinkingDropdownMenu.classList.add("hidden");
		els.thinkingPickerBtn.classList.remove("open");
		const isHidden = els.modelDropdownMenu.classList.toggle("hidden");
		els.modelPickerBtn.classList.toggle("open", !isHidden);
		if (!isHidden) {
			els.modelSearchInput.value = "";
			renderModelDropdownOptions("");
			setTimeout(() => els.modelSearchInput.focus(), 20);
		}
	};

	els.modelSearchInput.onclick = (e) => e.stopPropagation();
	els.modelSearchInput.addEventListener("input", () => {
		renderModelDropdownOptions(els.modelSearchInput.value);
	});

	els.thinkingPickerBtn.onclick = (e) => {
		e.stopPropagation();
		els.modelDropdownMenu.classList.add("hidden");
		els.modelPickerBtn.classList.remove("open");
		const isHidden = els.thinkingDropdownMenu.classList.toggle("hidden");
		els.thinkingPickerBtn.classList.toggle("open", !isHidden);
	};

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			closeWorkspaceMenu();
			els.modelDropdownMenu.classList.add("hidden");
			els.thinkingDropdownMenu.classList.add("hidden");
		}
	});
	document.addEventListener("click", (e) => {
		if (!els.workspaceDropdownWrap.contains(e.target)) closeWorkspaceMenu();
		if (!els.modelDropdownWrap.contains(e.target)) {
			els.modelDropdownMenu.classList.add("hidden");
			els.modelPickerBtn.classList.remove("open");
		}
		if (!els.thinkingDropdownWrap.contains(e.target)) {
			els.thinkingDropdownMenu.classList.add("hidden");
			els.thinkingPickerBtn.classList.remove("open");
		}
	});

	els.threadTitleInput.addEventListener("keydown", async (e) => {
		if (e.key === "Enter") {
			e.target.blur();
			await sendRpc({ type: "set_session_name", name: els.threadTitleInput.value.trim() });
			refreshBootstrapList();
		}
	});

	els.compactBtn.onclick = async () => {
		showToast("Compacting context...");
		const res = await sendRpc({ type: "compact" });
		if (res?.success) {
			showToast("Context compacted");
			refreshThreadSnapshot();
		}
	};

	const toggleInspector = () => {
		const hidden = els.inspectorPanel.classList.toggle("hidden");
		els.toggleInspectorBtn.classList.toggle("active", !hidden);
	};
	els.toggleInspectorBtn.onclick = toggleInspector;
	els.closeInspectorBtn.onclick = toggleInspector;
	els.refreshGitBtn.onclick = refreshGitInspector;

	els.tabBtnChanges.onclick = () => {
		els.tabBtnChanges.classList.add("active");
		els.tabBtnFiles.classList.remove("active");
		els.tabPanelChanges.classList.remove("hidden");
		els.tabPanelFiles.classList.add("hidden");
	};

	els.tabBtnFiles.onclick = () => {
		els.tabBtnFiles.classList.add("active");
		els.tabBtnChanges.classList.remove("active");
		els.tabPanelFiles.classList.remove("hidden");
		els.tabPanelChanges.classList.add("hidden");
	};

	els.upDirBtn.onclick = () => {
		if (!state.currentBrowseDir) return;
		const parts = state.currentBrowseDir.split("/").filter(Boolean);
		parts.pop();
		loadFileTree(parts.join("/"));
	};

	els.insertFileMentionBtn.onclick = () => {
		if (!state.selectedPreviewFile) return;
		els.promptInput.value += `${els.promptInput.value ? " " : ""}${state.selectedPreviewFile} `;
		els.promptInput.focus();
	};
}

async function init() {
	bindEvents();
	renderConnectionStatus();
	connectEventStream();
	await refreshBootstrapList();
	let saved;
	try { saved = JSON.parse(localStorage.getItem("pi-desktop-thread") || "null"); } catch {}
	const active = state.activeWorkers.find((w) => w.workerId === saved?.workerId);
	await connectThread(active ? { workerId: active.workerId, cwd: active.cwd }
		: saved?.sessionFile && state.persistedSessions.some((s) => s.sessionFile === saved.sessionFile)
			? saved : { cwd: state.currentWorkspace });
}

window.addEventListener("unhandledrejection", (event) => {
	reportError(event.reason);
	event.preventDefault();
});
init().catch((error) => {
	state.isConnecting = false;
	reportError(error);
});
