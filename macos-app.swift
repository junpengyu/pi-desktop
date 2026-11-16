import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var backendProcess: Process?
    var piNodePath: String?
    var piCliPath: String?
    var checkingForUpdates = false
    let port: Int = 4317

    func applicationDidFinishLaunching(_ notification: Notification) {
        startBackendIfNeeded()
        setupMenu()
        setupWindow()
        waitForServerAndLoad(retries: 35)
    }

    func startBackendIfNeeded() {
        let env = ProcessInfo.processInfo.environment
        let resourcesDir = Bundle.main.resourceURL!.path
        let bundledDesktopDir = "\(resourcesDir)/desktop"
        let isBundled = FileManager.default.fileExists(atPath: "\(bundledDesktopDir)/server.mjs")
        let defaultDesktopDir = isBundled ? bundledDesktopDir : Bundle.main.bundleURL.deletingLastPathComponent().path
        let desktopDir = env["PI_DESKTOP_DIR"] ?? defaultDesktopDir
        let serverScript = "\(desktopDir)/server.mjs"
        let userHome = FileManager.default.homeDirectoryForCurrentUser.path
        let nvmRoot = env["NVM_DIR"] ?? "\(userHome)/.nvm"
        let nvmVersions = "\(nvmRoot)/versions/node"
        let nvmNodes = ((try? FileManager.default.contentsOfDirectory(atPath: nvmVersions)) ?? [])
            .sorted { $0.compare($1, options: .numeric) == .orderedDescending }
            .map { "\(nvmVersions)/\($0)/bin/node" }
        let pathNodes = (env["PATH"] ?? "").split(separator: ":").map { "\($0)/node" }
        let nodeCandidates = [env["PI_NODE_BIN"]].compactMap { $0 }
            + ["\(Bundle.main.bundleURL.path)/Contents/MacOS/node"]
            + nvmNodes + ["/opt/homebrew/bin/node", "/usr/local/bin/node"] + pathNodes

        guard let nodePath = nodeCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }),
              FileManager.default.fileExists(atPath: serverScript) else {
            showStartupError("缺少 Node.js 或应用资源，请重新安装完整的 Pi Desktop 应用。")
            return
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments = [serverScript]
        proc.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

        var procEnv = env
        let nodeBinDir = URL(fileURLWithPath: nodePath).deletingLastPathComponent().path
        let extraPaths = "\(nodeBinDir):\(userHome)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        procEnv["PATH"] = "\(extraPaths):\(env["PATH"] ?? "")"
        procEnv["PI_DESKTOP_PORT"] = String(port)
        procEnv["PI_DESKTOP_HOST"] = "127.0.0.1"
        procEnv["PI_TELEMETRY"] = "0"
        procEnv["PI_OFFLINE"] = "1"
        if isBundled { procEnv["PI_DESKTOP_BUNDLED"] = "1" }
        let bundledPi = "\(resourcesDir)/pi/packages/coding-agent/dist/bundle/cli.js"
        if env["PI_CLI_PATH"] == nil && FileManager.default.fileExists(atPath: bundledPi) {
            procEnv["PI_CLI_PATH"] = bundledPi
            procEnv["PI_PACKAGE_DIR"] = "\(resourcesDir)/pi/packages/coding-agent"
        }
        proc.environment = procEnv
        self.piNodePath = nodePath
        self.piCliPath = procEnv["PI_CLI_PATH"] ?? URL(fileURLWithPath: desktopDir)
            .deletingLastPathComponent().appendingPathComponent("pi/packages/coding-agent/dist/bundle/cli.js").path

        do {
            try proc.run()
            self.backendProcess = proc
        } catch {
            NSLog("Failed to spawn Pi Desktop backend: \(error)")
            showStartupError("无法启动本地服务：\(error.localizedDescription)")
        }
    }

    func showStartupError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Pi Desktop 启动失败"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    func setupMenu() {
        let mainMenu = NSMenu()
        NSApp.mainMenu = mainMenu

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Pi Codex", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "检查更新…", action: #selector(checkForUpdates), keyEquivalent: "").target = self
        appMenu.addItem(withTitle: "配置模型与登录…", action: #selector(configureModel), keyEquivalent: ",").target = self
        appMenu.addItem(withTitle: "Reload Interface", action: #selector(reloadWebView), keyEquivalent: "r").target = self
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    }

    func setupWindow() {
        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let width: CGFloat = min(1380, screenRect.width * 0.9)
        let height: CGFloat = min(860, screenRect.height * 0.88)
        let originX = screenRect.origin.x + (screenRect.width - width) / 2
        let originY = screenRect.origin.y + (screenRect.height - height) / 2

        let frame = NSRect(x: originX, y: originY, width: width, height: height)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Codex · Pi"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = false
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(calibratedRed: 0.05, green: 0.05, blue: 0.05, alpha: 1.0)
        window.minSize = NSSize(width: 900, height: 600)

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")

        window.contentView?.addSubview(webView)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func checkForUpdates() {
        guard !checkingForUpdates else { return }
        checkingForUpdates = true
        let url = URL(string: "https://github.com/junpengyu/pi-desktop/releases/latest")!
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = "HEAD"
        request.setValue("Pi-Desktop-Update-Check", forHTTPHeaderField: "User-Agent")
        // An ephemeral session sends no stored cookies or user/model data.
        let session = URLSession(configuration: .ephemeral)
        session.dataTask(with: request) { [weak self] _, response, error in
            defer { session.finishTasksAndInvalidate() }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.checkingForUpdates = false
                let alert = NSAlert()
                let code = (response as? HTTPURLResponse)?.statusCode
                let finalURL = response?.url
                let tag = finalURL?.lastPathComponent ?? ""
                let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
                guard error == nil, code == 200, finalURL?.scheme == "https", finalURL?.host == "github.com",
                      finalURL?.path == "/junpengyu/pi-desktop/releases/tag/\(tag)",
                      version.range(of: "^[0-9]+[.][0-9]+[.][0-9]+$", options: .regularExpression) != nil else {
                    alert.messageText = "暂时无法检查更新"
                    if let error = error {
                        alert.informativeText = "无法连接 GitHub：\(error.localizedDescription)\n请检查网络或系统代理，也可以直接查看发布页面。"
                    } else {
                        alert.informativeText = "GitHub 发布页面未返回有效版本（HTTP \(code ?? 0)）。请稍后重试或直接查看发布页面。"
                    }
                    alert.addButton(withTitle: "打开发布页面")
                    alert.addButton(withTitle: "取消")
                    if alert.runModal() == .alertFirstButtonReturn {
                        NSWorkspace.shared.open(URL(string: "https://github.com/junpengyu/pi-desktop/releases")!)
                    }
                    return
                }
                let current = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
                if version.compare(current, options: .numeric) != .orderedDescending {
                    alert.messageText = "已是最新版本"
                    alert.informativeText = "当前版本：\(current)"
                    alert.addButton(withTitle: "好")
                    alert.runModal()
                    return
                }
                #if arch(arm64)
                let architecture = "arm64"
                #else
                let architecture = "x64"
                #endif
                let filename = "Pi-Desktop-\(version)-macOS-\(architecture).zip"
                let downloadURL = URL(string: "https://github.com/junpengyu/pi-desktop/releases/download/\(tag)/\(filename)")
                alert.messageText = "发现新版本 \(version)"
                alert.informativeText = "当前版本：\(current)\n\n下载并解压后，退出应用，将新版 Pi Desktop.app 替换到“应用程序”目录。会话与认证仍保存在用户目录中。"
                alert.addButton(withTitle: downloadURL == nil ? "查看发布页面" : "下载更新")
                alert.addButton(withTitle: "稍后")
                if alert.runModal() == .alertFirstButtonReturn {
                    NSWorkspace.shared.open(downloadURL ?? URL(string: "https://github.com/junpengyu/pi-desktop/releases/latest")!)
                }
            }
        }.resume()
    }

    @objc func configureModel() {
        guard let node = piNodePath, let cli = piCliPath else { return }
        let quote: (String) -> String = { "'" + $0.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let command = "cd " + quote(FileManager.default.homeDirectoryForCurrentUser.path)
            + " && PI_TELEMETRY=0 PI_OFFLINE=1 " + quote(node) + " " + quote(cli)
        let escaped = command.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let script = "tell application \"Terminal\"\nactivate\ndo script \"\(escaped)\"\nend tell"
        var error: NSDictionary?
        NSAppleScript(source: script)?.executeAndReturnError(&error)
        if error != nil { showStartupError("无法打开模型配置终端，请检查系统的自动化权限。") }
    }

    @objc func reloadWebView() {
        webView.reload()
    }

    func waitForServerAndLoad(retries: Int) {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/bootstrap") else { return }
        let task = URLSession.shared.dataTask(with: url) { [weak self] _, response, _ in
            guard let self = self else { return }
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                DispatchQueue.main.async {
                    if let appUrl = URL(string: "http://127.0.0.1:\(self.port)/") {
                        self.webView.load(URLRequest(url: appUrl))
                    }
                }
            } else if retries > 0 {
                DispatchQueue.global().asyncAfter(deadline: .now() + 0.15) {
                    self.waitForServerAndLoad(retries: retries - 1)
                }
            } else {
                DispatchQueue.main.async {
                    self.showStartupError("本地服务未能启动，请检查 4317 端口是否被其他应用占用，然后重新打开应用。")
                }
            }
        }
        task.resume()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let proc = backendProcess, proc.isRunning {
            proc.terminate()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
