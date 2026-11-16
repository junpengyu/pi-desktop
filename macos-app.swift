import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var backendProcess: Process?
    let port: Int = 4317

    func applicationDidFinishLaunching(_ notification: Notification) {
        startBackendIfNeeded()
        setupMenu()
        setupWindow()
        waitForServerAndLoad(retries: 35)
    }

    func startBackendIfNeeded() {
        let env = ProcessInfo.processInfo.environment
        // The generated app bundle lives beside server.mjs in the checkout.
        let defaultDesktopDir = Bundle.main.bundleURL.deletingLastPathComponent().path
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
            + nvmNodes + ["/opt/homebrew/bin/node", "/usr/local/bin/node"] + pathNodes

        guard let nodePath = nodeCandidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }),
              FileManager.default.fileExists(atPath: serverScript) else {
            return
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodePath)
        proc.arguments = [serverScript]
        proc.currentDirectoryURL = URL(fileURLWithPath: desktopDir)

        var procEnv = env
        let nodeBinDir = URL(fileURLWithPath: nodePath).deletingLastPathComponent().path
        let extraPaths = "\(nodeBinDir):\(userHome)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        procEnv["PATH"] = "\(extraPaths):\(env["PATH"] ?? "")"
        procEnv["PI_DESKTOP_PORT"] = String(port)
        proc.environment = procEnv

        do {
            try proc.run()
            self.backendProcess = proc
        } catch {
            NSLog("Failed to spawn Pi Desktop backend: \(error)")
        }
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
        appMenu.addItem(withTitle: "Reload Interface", action: #selector(reloadWebView), keyEquivalent: "r")
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
