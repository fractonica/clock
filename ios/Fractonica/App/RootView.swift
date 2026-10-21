import SwiftUI

/// The window's content: the iPhone layout (tabs, with grouped screens behind segmented controls) in compact width,
/// the sidebar layout (every screen listed) on iPad and Mac. It also owns what is presented over the screens — Focus
/// full screen, Settings, Sound on iPhone, time travel — the window-wide toasts and the app's links (`AppLink`).
struct RootView: View {
    @Environment(AppRouter.self) private var router
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #else
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    #endif

    var body: some View {
        layout
            .toastOverlay()
            .modifier(Presentations())
            .onChange(of: isCompact, initial: true) { _, compact in
                router.isCompact = compact
                router.openLaunchLink()
            }
            .onChange(of: settings.pure, initial: true) { _, pure in
                store.adoptPlayRate(pure: pure)
            }
            .onChange(of: store.revision) {
                if store.lastChange == .edge {
                    toasts.show(store.time() <= store.catalogue.lowerBound ? "Time-lapse stopped at the start of the catalogue" : "Time-lapse stopped at the end of the catalogue")
                }
            }
            .onOpenURL { url in
                if let link = AppLink(url: url) { router.open(link) }
            }
            #if os(macOS)
            // Focus and Settings are windows of their own on macOS; a request made while this window was closed is
            // honoured when it opens.
            .onChange(of: router.isFocusPresented, initial: true) { _, presented in
                guard presented else { return }
                router.isFocusPresented = false
                openWindow(id: WindowID.focus)
            }
            .onChange(of: router.isSettingsPresented, initial: true) { _, presented in
                guard presented else { return }
                router.isSettingsPresented = false
                openSettings()
            }
            #endif
    }

    private var isCompact: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    @ViewBuilder
    private var layout: some View {
        #if os(iOS)
        if isCompact { CompactRoot() } else { SidebarRoot() }
        #else
        SidebarRoot()
        #endif
    }
}

// MARK: - iPhone

#if os(iOS)
/// Now | Cycles | Calendar | Clock, and Jump as the search tab; the transport rides in the tab bar's bottom accessory.
private struct CompactRoot: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        TabView(selection: tabBinding) {
            Tab(Screen.now.title, systemImage: Screen.now.systemImage, value: CompactTab.now) {
                ScreenStack(screen: .now)
            }
            Tab(ScreenGroup.cycles.title, systemImage: ScreenGroup.cycles.systemImage, value: CompactTab.group(.cycles)) {
                GroupStack(group: .cycles)
            }
            Tab(ScreenGroup.calendar.title, systemImage: ScreenGroup.calendar.systemImage, value: CompactTab.group(.calendar)) {
                GroupStack(group: .calendar)
            }
            Tab(ScreenGroup.clock.title, systemImage: ScreenGroup.clock.systemImage, value: CompactTab.group(.clock)) {
                GroupStack(group: .clock)
            }
            Tab(Screen.jump.title, systemImage: Screen.jump.systemImage, value: CompactTab.jump, role: .search) {
                ScreenStack(screen: .jump)
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory { TransportBar() }
    }

    /// The tab of the selected screen; choosing a group's tab shows the segment it showed last.
    private var tabBinding: Binding<CompactTab> {
        Binding(
            get: { CompactTab(router.selection) },
            set: { tab in
                switch tab {
                case .now: router.selection = .now
                case .jump: router.selection = .jump
                case .group(let group): router.selection = router.screen(in: group)
                }
            }
        )
    }
}

/// The tabs of the iPhone layout.
private enum CompactTab: Hashable {
    case now, jump
    case group(ScreenGroup)

    init(_ screen: Screen) {
        switch screen {
        case .jump: self = .jump
        default: self = screen.group.map(CompactTab.group) ?? .now
        }
    }
}

/// A group's tab: its screens behind a segmented control in the navigation bar, in one navigation stack.
private struct GroupStack: View {
    let group: ScreenGroup

    @Environment(AppRouter.self) private var router

    var body: some View {
        let screen = router.screen(in: group)
        NavigationStack {
            ScreenContent(screen: screen)
                .screenChrome(screen)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) {
                        Picker(group.title, selection: Binding(get: { router.screen(in: group) }, set: { router.show($0) })) {
                            ForEach(group.screens) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .fixedSize()
                    }
                }
        }
    }
}
#endif

// MARK: - iPad and Mac

/// Every screen in a sidebar (or a tab bar with sections on iPad when the sidebar is hidden).
private struct SidebarRoot: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selection) {
            tab(.now)
            TabSection(ScreenGroup.cycles.title) {
                tab(.rings)
                tab(.ladder)
                tab(.wave)
                tab(.timeline)
            }
            TabSection(ScreenGroup.calendar.title) {
                tab(.converter)
                tab(.month)
                tab(.diary)
            }
            tab(.sound)
            TabSection(ScreenGroup.clock.title) {
                tab(.timer)
                tab(.stopwatch)
                tab(.alerts)
            }
            tab(.focus)
            Tab(Screen.jump.title, systemImage: Screen.jump.systemImage, value: Screen.jump, role: .search) {
                ScreenStack(screen: .jump)
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabViewSidebarBottomBar { SidebarFooter() }
        #if os(iOS)
        .tabViewBottomAccessory { TransportBar() }
        #endif
    }

    private func tab(_ screen: Screen) -> some TabContent<Screen> {
        Tab(screen.title, systemImage: screen.systemImage, value: screen) {
            ScreenStack(screen: screen)
        }
    }
}

/// Pure mode, Focus and Settings at the foot of the sidebar.
private struct SidebarFooter: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router

    var body: some View {
        HStack(spacing: 8) {
            Toggle(isOn: Bindable(settings).pure) {
                Label("Pure mode", systemImage: "character.book.closed")
            }
            .toggleStyle(.button)
            .help("Pure mode: Fractonica terms only (P)")
            Spacer()
            Button("Focus", systemImage: Screen.focus.systemImage) { router.show(.focus) }
                .labelStyle(.iconOnly)
                .help("Focus mode, full screen")
            #if os(iOS)
            Button("Settings", systemImage: Screen.settings.systemImage) { router.show(.settings) }
                .labelStyle(.iconOnly)
            #else
            SettingsLink {
                Label("Settings", systemImage: Screen.settings.systemImage)
            }
            .labelStyle(.iconOnly)
            .help("Settings (⌘,)")
            #endif
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

// MARK: - Screens

/// The view of each screen. Feature screens take no parameters: they read the clock, settings and router from the
/// environment.
struct ScreenContent: View {
    let screen: Screen

    var body: some View {
        switch screen {
        case .now: NowScreen()
        case .rings: RingsScreen()
        case .ladder: LadderScreen()
        case .wave: WaveScreen()
        case .timeline: TimelineScreen()
        case .converter: ConverterScreen()
        case .month: MonthScreen()
        case .diary: DiaryScreen()
        case .sound: SoundScreen()
        case .timer: TimerScreen()
        case .stopwatch: StopwatchScreen()
        case .alerts: AlertsScreen()
        case .focus: FocusScreen()
        case .jump: JumpScreen()
        case .settings: SettingsScreen()
        }
    }
}

/// One screen in its own navigation stack, on the app's backdrop, with the shared toolbar.
private struct ScreenStack: View {
    let screen: Screen

    var body: some View {
        NavigationStack {
            ScreenContent(screen: screen)
                .screenChrome(screen)
        }
    }
}

extension View {
    /// The backdrop and the toolbar items every screen shares: on iOS, Sound (iPhone), Focus and Settings on Now; on
    /// macOS, the transport, Focus and Settings in every window toolbar.
    fileprivate func screenChrome(_ screen: Screen) -> some View {
        modifier(ScreenChrome(screen: screen))
    }
}

private struct ScreenChrome: ViewModifier {
    let screen: Screen

    @Environment(AppRouter.self) private var router

    func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { Backdrop() }
            .toolbar {
                #if os(iOS)
                if screen == .now {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        if router.isCompact {
                            Button(Screen.sound.title, systemImage: Screen.sound.systemImage) { router.show(.sound) }
                        }
                        Button(Screen.focus.title, systemImage: Screen.focus.systemImage) { router.show(.focus) }
                        Button(Screen.settings.title, systemImage: Screen.settings.systemImage) { router.show(.settings) }
                    }
                }
                #else
                ToolbarItem(placement: .principal) {
                    TransportControls()
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button(Screen.focus.title, systemImage: Screen.focus.systemImage) { router.show(.focus) }
                        .help("Focus mode, full screen (⇧⌘F)")
                    SettingsLink {
                        Label("Settings", systemImage: Screen.settings.systemImage)
                    }
                    .help("Settings (⌘,)")
                }
                #endif
            }
    }
}

// MARK: - Presentations

/// What the root presents over the screens on iOS (macOS opens windows instead; see `RootView`).
private struct Presentations: ViewModifier {
    @Environment(AppRouter.self) private var router

    func body(content: Content) -> some View {
        #if os(iOS)
        @Bindable var router = router
        content
            .sheet(isPresented: $router.isTransportPresented) {
                TransportPanel()
                    .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $router.isSoundPresented) {
                NavigationStack {
                    SoundScreen()
                        .background { Backdrop() }
                        .toolbar { SheetDoneButton() }
                }
                .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $router.isSettingsPresented) {
                NavigationStack {
                    SettingsScreen()
                        .toolbar { SheetDoneButton() }
                }
            }
            .fullScreenCover(isPresented: $router.isFocusPresented) {
                FocusScreen()
                    .background { Backdrop() }
                    .environment(\.isImmersive, true)
            }
        #else
        content
        #endif
    }
}

#if os(iOS)
/// The confirmation button of a sheet that has no other way to close on iPad.
private struct SheetDoneButton: ToolbarContent {
    @Environment(\.dismiss) private var dismiss

    var body: some ToolbarContent {
        ToolbarItem(placement: .confirmationAction) {
            Button("Done", systemImage: "checkmark") { dismiss() }
        }
    }
}
#endif
