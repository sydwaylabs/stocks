import AppKit
import WebKit
import UniformTypeIdentifiers
import Security

//
// A native window host for a Stream Deck plugin.
//
// It knows nothing about the plugin: the page talks to the plugin's local HTTP server, and the
// plugin kills this process once the window closes or the idle timeout elapses. So this is only a
// correctly-sized, correctly-placed window that loads a URL and takes keyboard focus — plus save
// and open panels, which a Node process cannot show for itself.
//
// It accepts Chrome's own flag spelling (`--app=<url>`, `--window-size=W,H`) so it is a drop-in
// substitute for the browser fallback, with no branching on the plugin side.
//
//   host --app=<url> [--window-size=W,H] [--title=<text>] [--no-focus]
//   host --save-panel [--name=<filename>] [--prompt=<text>] [--file-type=<ext>]
//   host --open-panel [--prompt=<text>] [--file-type=<ext>]
//   host --collection-key
//
// Exits non-zero on a bad invocation; exits 0 when the window closes or a panel is answered.
//
// `--no-focus` shows the window without asking for key status at all. For a window the user just
// asked for, taking focus is right; for one that appears unbidden — a timer going off while
// somebody is typing — it is not, because the keystroke in flight would be swallowed.
//
// Everything here that looks fussy — the non-activating panel, the double focus pass, the
// pre-paint background colour, the retry ladder on the panels — is the hard-won part. See
// references/native-window.md for what each one is defending against.
//

/// Diagnostics go to stderr, which the plugin forwards to its log. A separate process is
/// otherwise completely silent about why it did nothing.
private let hostName = (CommandLine.arguments.first as NSString?)?.lastPathComponent ?? "host"

private func log(_ message: String) {
    FileHandle.standardError.write("\(hostName): \(message)\n".data(using: .utf8)!)
}

private func flagValue(_ name: String) -> String? {
    for arg in CommandLine.arguments where arg.hasPrefix("--\(name)=") {
        return String(arg.dropFirst(name.count + 3))
    }
    return nil
}

/**
 * The page's own background — keep this in sync with `--bg` in the page's CSS.
 *
 * Every surface visible before the HTML paints is set to this, so the window opens already the
 * right colour. Nothing here may use a dynamic system colour: the page is always dark, while
 * NSColor.windowBackgroundColor resolves to #FFFFFF under the light appearance — which shows as a
 * white flash on a Mac set to Light mode.
 */
private let pageBackground = NSColor(srgbRed: 0x33 / 255.0, green: 0x33 / 255.0, blue: 0x33 / 255.0, alpha: 1)

/// Fraction of leftover vertical space placed above the window. 0.5 is dead centre.
private let verticalBias: CGFloat = 0.35
private let defaultSize = CGSize(width: 900, height: 740)

private func requestedContentSize() -> CGSize {
    guard let raw = flagValue("window-size") else { return defaultSize }
    let parts = raw.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard parts.count == 2, parts[0] > 0, parts[1] > 0 else { return defaultSize }
    return CGSize(width: parts[0], height: parts[1])
}

// MARK: - window

/**
 * A web view that responds to the click that arrives while its window is not key.
 *
 * A panel opened under --no-focus floats over another application without taking focus, so *every* click on
 * it is a first click. AppKit's default is to spend that click on making the window key and
 * deliver nothing to the content, which would leave the panel's buttons dead until the second
 * press — and reads exactly like a window that has hung.
 */
final class ClickThroughWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class WindowController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var parentWatch: Timer?
    /// False under `--no-focus`: show the window, but leave the keyboard where it was.
    private var takeFocus = true

    func show(url: URL, contentSize: CGSize) {
        takeFocus = !CommandLine.arguments.contains("--no-focus")
        let config = WKWebViewConfiguration()
        // Nothing is persisted between invocations — the window is a view onto the plugin's state.
        config.websiteDataStore = .nonPersistent()
        // Tells the page it is hosted natively so it skips the resizeTo/moveTo correction it needs
        // under Chrome. Those calls exist only because Chrome ignores its geometry flags; here the
        // window is already correct, and resizeTo() would size the *outer* frame and cost the
        // content the height of the title bar. At documentStart so it lands before the page's own
        // head script runs.
        config.userContentController.addUserScript(WKUserScript(
            source: "window.__nativeHost = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        // Lets a page whose content grows and shrinks — a list somebody is adding to — ask for the
        // window to fit it: `window.webkit.messageHandlers.resize.postMessage({ height })`. Pages
        // that never send it are sized once by --window-size, as before.
        config.userContentController.add(self, name: "resize")

        webView = ClickThroughWebView(frame: NSRect(origin: .zero, size: contentSize), configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // Also the colour shown before the first paint, so it must be the page's own.
        if #available(macOS 12.0, *) { webView.underPageBackgroundColor = pageBackground }

        /*
         * An NSPanel with .nonactivatingPanel, not an NSWindow.
         *
         * Measured on macOS 26: NSApp.activate(ignoringOtherApps:) is simply refused when another
         * application is frontmost, so a plain window opened with appActive=false and
         * keyWindow=false and every keystroke went to the app the user came from. Clicking the
         * window was the only way to give it focus. That is cooperative activation, added in
         * macOS 14, and no amount of activating harder gets around it.
         *
         * A non-activating panel takes key status **without** its application becoming active,
         * which is the behaviour this window wanted all along: it is transient, floating over
         * whatever is being worked in, and should not bring an app forward.
         */
        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: contentSize),
            styleMask: [.titled, .closable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        /*
         * The property deciding whether the panel takes key status eagerly or only when a control
         * demands it — so it is what --no-focus actually turns on. Ordering the panel front
         * without calling makeKey is not enough on its own: measured, the panel came up with
         * keyWindow=true anyway, because AppKit gives key status to the frontmost window of an
         * app that has become active. With this set, a panel of buttons never asks for it.
         */
        panel.becomesKeyOnlyIfNeeded = !takeFocus
        // The panel must survive its own app not being active, which is now the normal case.
        panel.hidesOnDeactivate = false
        window = panel
        window.delegate = self
        window.contentView = webView
        window.title = flagValue("title") ?? "Plugin"
        // Chromeless look while keeping the close button and a draggable region.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.backgroundColor = pageBackground
        // Pins the frame to the dark appearance too. The page is always dark, so leaving this to
        // follow the system drew light traffic lights and a light titlebar over a dark page on a
        // Mac set to Light mode.
        window.appearance = NSAppearance(named: .darkAqua)
        // Float above the app being worked in, which keeps its keyboard focus context.
        window.level = .floating
        window.isReleasedWhenClosed = false
        // contentRect is the *content* area and AppKit adds the title bar above it, so the page
        // gets exactly the height asked for — unlike Chrome, where resizeTo() sizes the outer
        // frame and silently eats ~32px.
        //
        // .fullSizeContentView is deliberately NOT used: it makes the frame equal contentRect,
        // reintroducing that shortfall and sliding the page header under the traffic lights.

        position(window, contentSize: contentSize)
        webView.load(URLRequest(url: url))

        /*
         * Order matters, and one pass is not enough.
         *
         * Ordering front and taking key is enough for a non-activating panel; activating is the
         * part macOS refuses, and asking for it anyway only adds a failed request.
         * orderFrontRegardless is deliberate: an accessory app is not guaranteed to be active
         * here, and the ordinary ordering call does nothing when it is not.
         */
        window.orderFrontRegardless()
        if takeFocus {
            window.makeKeyAndOrderFront(nil)
            /*
             * A key window is not enough: the web view has to be first responder or keystrokes stop
             * at the window and never reach the page. That is what made the window open
             * unresponsive when the previously focused app had a web input field focused, while a
             * plain text document was fine. Clicking fixed it, because clicking is what was setting
             * first responder.
             */
            window.makeFirstResponder(webView)
            DispatchQueue.main.async { [weak self] in
                self?.window?.makeKey()
                self?.focusWebView()
            }
        }
        // Reported rather than reasoned about: activation behaviour depends on what the *other*
        // application is doing and cannot be reproduced from a shell. One line here settles in a
        // minute what guessing does not.
        // Twice: immediately, and again once activation has settled. The first reading is taken
        // before AppKit has finished deciding, and a panel that looks right at once can still end
        // up key a moment later.
        for delay in [0.0, 1.2] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, let window = self.window else { return }
            log("focus: takeFocus=\(self.takeFocus) appActive=\(NSApp.isActive)"
                + " keyWindow=\(window.isKeyWindow)"
                + " firstResponder=\(String(describing: type(of: window.firstResponder)))"
                + " frontmostApp=\(NSWorkspace.shared.frontmostApplication?.localizedName ?? "?")")
            }
        }
        watchParent()
    }

    /**
     * Resizes the content to the height the page asked for, keeping the top edge where it is.
     *
     * The top stays put because that is where the pointer and the eye are: a window that grew
     * upwards would move the row somebody had just clicked out from under them. It grows down, and
     * is clamped to the screen — a page cannot push the window off the bottom of the display, where
     * nothing could be reached. Width is the page's business only at launch.
     */
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "resize", let window = window,
              let body = message.body as? [String: Any],
              let requested = (body["height"] as? NSNumber)?.doubleValue,
              requested.isFinite, requested > 0 else { return }

        let area = (window.screen ?? NSScreen.main)?.visibleFrame
        let current = window.contentRect(forFrameRect: window.frame)
        var frame = window.frameRect(forContentRect: NSRect(x: 0, y: 0, width: current.width, height: CGFloat(requested.rounded())))
        let top = window.frame.maxY
        if let area {
            frame.size.height = min(frame.size.height, area.height)
            // Keep the top, unless growing down would leave the bottom off screen; then slide up.
            let y = max(area.minY, top - frame.size.height)
            frame.origin = NSPoint(x: window.frame.origin.x, y: y)
        } else {
            frame.origin = NSPoint(x: window.frame.origin.x, y: top - frame.size.height)
        }
        if abs(frame.size.height - window.frame.size.height) < 1 { return }
        log("resize: asked \(Int(requested)) content, frame now \(Int(frame.size.width))x\(Int(frame.size.height))")
        window.setFrame(frame, display: true, animate: false)
    }

    /**
     * Exits when the plugin that spawned this window goes away.
     *
     * The page talks to a server owned by the plugin process. If that process restarts or crashes,
     * this window is re-parented to launchd and left on screen with every control hitting a dead
     * server — visible, but inert. Nothing else notices: the plugin cannot clean up a child it no
     * longer knows about, and the page cannot tell a closed server from a slow one.
     */
    private func watchParent() {
        let originalParent = getppid()
        parentWatch = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            if getppid() != originalParent {
                log("plugin process went away; closing")
                NSApp.terminate(nil)
            }
        }
    }

    /// Centres horizontally and biases above centre, on the screen the mouse is on — not the main
    /// display, or it opens on the wrong monitor.
    private func position(_ window: NSWindow, contentSize: CGSize) {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        guard let area = screen?.visibleFrame else { window.center(); return }

        var frameSize = window.frame.size  // includes the title bar

        // A window larger than the display is not merely ugly: the bias below turns negative and
        // pushes the overflow off the bottom edge, where the content cannot be reached and cannot
        // be scrolled to either, because the scroll container is inside the part that is off
        // screen. Clamping first costs a scrollbar on a small display and nothing on a large one.
        // `visibleFrame` already excludes the menu bar and the Dock.
        if frameSize.width > area.width || frameSize.height > area.height {
            frameSize.width = min(frameSize.width, area.width)
            frameSize.height = min(frameSize.height, area.height)
            window.setFrame(NSRect(origin: window.frame.origin, size: frameSize), display: false)
            log("clamped to screen: \(Int(frameSize.width))x\(Int(frameSize.height))")
        }

        let x = area.midX - frameSize.width / 2
        // AppKit's origin is bottom-left, so a bias measured from the top inverts here.
        let topGap = (area.height - frameSize.height) * verticalBias
        let y = area.maxY - frameSize.height - topGap
        window.setFrameOrigin(NSPoint(x: x.rounded(), y: y.rounded()))

        // Reported so placement bugs are visible. They are otherwise undiagnosable without
        // Accessibility permission to inspect the window externally.
        let f = window.frame
        let c = window.contentLayoutRect
        log("frame \(Int(f.width))x\(Int(f.height)) at \(Int(f.origin.x)),\(Int(f.origin.y))"
            + " | content \(Int(c.width))x\(Int(c.height))"
            + " | screen \(Int(area.width))x\(Int(area.height))")
    }

    func windowWillClose(_ notification: Notification) {
        // The page's beforeunload handler tells the plugin before we go.
        NSApp.terminate(nil)
    }

    /// The page calls window.close() on Escape.
    func webViewDidClose(_ webView: WKWebView) {
        NSApp.terminate(nil)
    }

    /**
     * Re-asserts first responder once the page exists.
     *
     * The page focuses its own field as soon as it marks itself ready, and that only lands if the
     * web view is first responder at the time. Setting it when the window is created is not always
     * enough, because the load finishes afterwards.
     */
    private func focusWebView() {
        guard window != nil, webView != nil else { return }
        if window.firstResponder !== webView { window.makeFirstResponder(webView) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Skipped under --no-focus: the page loading is not a reason to take the keyboard from
        // whatever the user is typing into.
        if takeFocus { focusWebView() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        log("navigation failed: \(error.localizedDescription)")
        NSApp.terminate(nil)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        log("could not load page: \(error.localizedDescription)")
        NSApp.terminate(nil)
    }
}

// MARK: - file panels

//
// The save and open panels, behind `--save-panel` and `--open-panel`.
//
// The plugin cannot show these itself: a Node process is not an application. Doing it with
// osascript works but costs about **two seconds** every time — a bare `osascript -e 'return 1'` is
// ~50ms, while adding `activate` measured 2.09s, because the tool has to register itself as a
// foreground application first. Without `activate` the panel opens *behind* the window, which
// reads as an application that has frozen. This host is already an app, so it pays none of that.
//

/// Centres a panel on the display the mouse is on, matching where the window opens.
private func positionOnActiveScreen(_ window: NSWindow) {
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    guard let area = screen?.visibleFrame else { window.center(); return }
    let size = window.frame.size
    let x = area.midX - size.width / 2
    let y = area.maxY - size.height - (area.height - size.height) * verticalBias
    window.setFrameOrigin(NSPoint(x: x.rounded(), y: y.rounded()))
}

private func runFilePanel(saving: Bool) -> String? {
    let app = NSApplication.shared
    /*
     * .regular here, unlike the window, which is .accessory.
     *
     * Save and open panels are hosted out of process by macOS, so .nonactivatingPanel inserted
     * into their style mask never reaches the real window and they still depend on the app
     * activating. An accessory app is background and macOS refuses to let it take focus from
     * whatever is frontmost: measured with VS Code frontmost, five attempts over a second all
     * failed with appActive=false, while the same code succeeded under Chrome, which evidently
     * yields.
     *
     * A regular app is one macOS expects to come forward. The cost is a Dock icon for as long as
     * the dialog is up, which is what any application showing a save panel looks like anyway.
     */
    app.setActivationPolicy(.regular)
    app.activate(ignoringOtherApps: true)

    func present(_ panel: NSSavePanel) {
        panel.styleMask.insert(.nonactivatingPanel)
        panel.level = .modalPanel
        /*
         * Asked for several times, not once.
         *
         * runModal starts its own modal run loop, so a single block scheduled beforehand can fire
         * before the panel is really presented, and the request to become key is then dropped. One
         * attempt worked often enough to look fixed and failed often enough to be reported again.
         * Each attempt gives up immediately once the panel holds key status, so the usual case is
         * a single pass.
         *
         * The save panel took key from makeKey alone while the open panel needed ordering front as
         * well, which is why both are asked for. Placement is explicit because ordering a panel
         * front is what pre-empts AppKit's own, leaving it in the bottom-left corner.
         */
        var placed = false
        for delay in [0.0, 0.06, 0.15, 0.35, 0.7] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                if !placed {
                    positionOnActiveScreen(panel)
                    placed = true
                }
                guard !panel.isKeyWindow else { return }
                NSApp.activate(ignoringOtherApps: true)
                panel.makeKeyAndOrderFront(nil)
            }
        }
        // Silent when it works, so the log stays clean; says so when it does not, because the
        // symptom on screen is only that clicking is needed, and that is easy to misread.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            if !panel.isKeyWindow {
                log("panel never took keyboard focus: appActive=\(NSApp.isActive)")
            }
        }
    }

    let prompt = flagValue("prompt") ?? (saving ? "Save" : "Open")
    // Restricting the type saves the user from an obvious mistake. It is not a security boundary —
    // the file is validated properly once read.
    let ext = flagValue("file-type") ?? "json"
    let types: [UTType] = [UTType(filenameExtension: ext) ?? .json]

    if saving {
        let panel = NSSavePanel()
        panel.message = prompt
        panel.nameFieldStringValue = flagValue("name") ?? "export.\(ext)"
        panel.allowedContentTypes = types
        panel.canCreateDirectories = true
        present(panel)
        return panel.runModal() == .OK ? panel.url?.path : nil
    }
    let panel = NSOpenPanel()
    panel.message = prompt
    panel.allowedContentTypes = types
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    present(panel)
    return panel.runModal() == .OK ? panel.url?.path : nil
}

// MARK: - collection key

// `--collection-key` prints the plugin's 32-byte key, base64, on stdout, minting it in the login
// keychain on first use. It seals the Finnhub API key in global settings.
//
// The key goes to **stdout, never argv**: arguments are visible to every process via `ps`. That
// is also why the plugin must not shell out to `security add-generic-password -w`.
//
// **What this is worth, measured rather than assumed.** The item is not access-controlled, and
// cannot be until the host is signed with a Developer ID. An unrelated binary reads an item like
// this with no prompt at all. Gating on user presence needs a `keychain-access-groups`
// entitlement (which needs a team identity), and a legacy ACL with an empty trusted-application
// list refuses *every* reader including this one. So the key buys exactly this: the secret is not
// in the Stream Deck profile, and a profile export, sync folder or backup carries ciphertext.

private let keyService = "com.sydwaylabs.stocks"   // the plugin id
private let keyAccount = "collection-key"

private func loadCollectionKey() -> Data? {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keyService,
        kSecAttrAccount as String: keyAccount,
        kSecReturnData as String: true,
    ]
    var out: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
    return out as? Data
}

private func createCollectionKey() -> Data? {
    var key = Data(count: 32)
    let generated = key.withUnsafeMutableBytes { buf -> OSStatus in
        guard let base = buf.baseAddress else { return errSecAllocate }
        return SecRandomCopyBytes(kSecRandomDefault, 32, base)
    }
    guard generated == errSecSuccess else {
        log("could not generate a collection key: \(generated)")
        return nil
    }
    let add: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keyService,
        kSecAttrAccount as String: keyAccount,
        kSecValueData as String: key,
        kSecAttrLabel as String: "\(keyService) collection key",
        // Deliberately ThisDeviceOnly: a key that synced to iCloud would put every sealed value
        // within reach of any device on the same account — wider than the profile it protects.
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    let status = SecItemAdd(add as CFDictionary, nil)
    // Two hosts can race on first use. A duplicate means the other one won, so take its key
    // rather than failing: minting a second would strand whatever the first has already sealed.
    if status == errSecDuplicateItem { return loadCollectionKey() }
    guard status == errSecSuccess else {
        log("could not store the collection key: \(status)")
        return nil
    }
    return key
}


// MARK: - entry point

/// Prints the 32-byte key that seals secrets in settings; see src/lib/secret-store.ts.
if CommandLine.arguments.contains("--collection-key") {
    guard let key = loadCollectionKey() ?? createCollectionKey() else { exit(3) }
    FileHandle.standardOutput.write(key.base64EncodedString().data(using: .utf8)!)
    exit(0)
}

/*
 * Panel modes need AppKit but no web view, and exit as soon as the dialog is answered. Cancelling
 * prints nothing and still exits 0, so the caller reads an empty result rather than a failure.
 */
if CommandLine.arguments.contains("--save-panel") || CommandLine.arguments.contains("--open-panel") {
    let saving = CommandLine.arguments.contains("--save-panel")
    if let path = runFilePanel(saving: saving) {
        FileHandle.standardOutput.write(path.data(using: .utf8)!)
    }
    exit(0)
}

guard let raw = flagValue("app"), let url = URL(string: raw), url.scheme != nil else {
    FileHandle.standardError.write("""
        usage: \(hostName) --app=<url> [--window-size=W,H] [--title=<text>] [--no-focus]
               \(hostName) --save-panel [--name=<filename>] [--prompt=<text>] [--file-type=<ext>]
               \(hostName) --open-panel [--prompt=<text>] [--file-type=<ext>]
               \(hostName) --collection-key

        """.data(using: .utf8)!)
    exit(2)
}

let app = NSApplication.shared
// .accessory, not .regular: a transient window should not register as a full application. The
// regular policy adds a Dock icon and the whole app-launch ceremony, which is what makes opening
// feel like a second of loading. Accessory windows can still become key and take keyboard focus.
app.setActivationPolicy(.accessory)

/*
 * AppKit routes the standard editing shortcuts through the Edit menu's key equivalents, so without
 * a menu bar Cmd+V, Cmd+X and Cmd+Z simply do nothing inside a text field — the keystroke reaches
 * nothing that handles it, and the field sits there unchanged.
 *
 * Undo and Redo are addressed by name because they are the field editor's own, not NSText's.
 *
 * The menu itself is never shown: the window is the only UI.
 */
let mainMenu = NSMenu()
let editItem = NSMenuItem()
mainMenu.addItem(editItem)
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
redo.keyEquivalentModifierMask = [.command, .shift]
editMenu.addItem(redo)
editMenu.addItem(NSMenuItem.separator())
for (title, selector, key) in [
    ("Cut", #selector(NSText.cut(_:)), "x"),
    ("Copy", #selector(NSText.copy(_:)), "c"),
    ("Paste", #selector(NSText.paste(_:)), "v"),
    ("Select All", #selector(NSText.selectAll(_:)), "a"),
] {
    editMenu.addItem(NSMenuItem(title: title, action: selector, keyEquivalent: key))
}
editMenu.addItem(NSMenuItem.separator())
editMenu.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
editItem.submenu = editMenu
app.mainMenu = mainMenu

let controller = WindowController()
controller.show(url: url, contentSize: requestedContentSize())
app.run()
