# Fractonica for iPhone, iPad and Mac

Native SwiftUI apps for the Fractonica clock, with widgets on both platforms. The web app at the repository root
(index.html, src/**, fractonica.js) is the functional reference and stays untouched; README.md, SPEC.md (§15 is pure
mode) and docs/design/*.md describe what each screen does. Everything native lives in this folder.

Toolchain: Xcode 27, Swift 6 language mode with complete strict concurrency, iOS 26.0 / macOS 26.0 deployment
(Liquid Glass, the `Tab` API, `tabViewBottomAccessory`). No third-party dependencies. There is no default actor
isolation: annotate stores `@MainActor`; every FractonicaKit type is `Sendable`.

## Layout

| Path | What | Compiled into |
|---|---|---|
| `FractonicaKit/` | The clock engine, a Swift package with golden tests against the JavaScript (its README) | everything |
| `Fractonica/App/` | Entry point, root layouts, scenes, menu commands, launch hooks, links, notifications | iOS + macOS app |
| `Fractonica/Core/` | Shared app state and UI parts: the clock, settings, router, wording, transport, toasts, haptics | iOS + macOS app |
| `Fractonica/Features/<Feature>/` | One folder per feature, with its screen(s) | iOS + macOS app |
| `Fractonica/Resources/` | App asset catalog (icon, accent, launch colour) | iOS + macOS app |
| `Shared/` | Theme, backdrop, glyph views, `Screen`, `AppLink`, the timer's `ActivityAttributes` | apps + widget extensions |
| `Widgets/` | The WidgetKit extension (clock widgets; the timer's Live Activity on iOS) | iOS + macOS widgets |
| `Support/` | Info.plists and entitlements, **generated** by xcodegen from project.yml | — |
| `project.yml` | XcodeGen spec: the only source of the Xcode project, plists and entitlements | — |
| `scripts/` | build.sh, shoot.sh, check.sh, fixture generators, icon generator, copy-web.sh | — |

Targets: `Fractonica` (iOS app, iPhone + iPad) embeds `FractonicaWidgets`; `FractonicaMac` (macOS app) embeds
`FractonicaWidgetsMac`. Both widget extensions compile the same `Widgets/` + `Shared/` sources (`#if os(iOS)` for
Live Activities). Bundle ids: app.fractonica.clock and app.fractonica.clock.widgets. The generated
`Fractonica.xcodeproj` and `build/` are git-ignored. Folders named `Checks` anywhere in the sources are excluded from
every target (see "Logic checks").

The build copies the web app's `fractonica.js` and `src/` into the app bundle as `web/` (scripts/copy-web.sh, a
pre-build phase), for the Diary's WKWebView: `Bundle.main.url(forResource: "web", withExtension: nil)` holds
`fractonica.js` and `src/…` in the repository's relative layout.

## The engine: FractonicaKit

`import FractonicaKit`. Times are Unix seconds (`Double`), levels zero-based (depth = level + 1, η is level 6). Readings
are `nil` outside the catalogue (1613 … 2857, `clock.tMin … clock.tMax`) and never extrapolated. See
FractonicaKit/README.md for what is ported from which JavaScript and the numerics.

| API | Use |
|---|---|
| `FractonicaClock.shared` | The one clock (thread-safe, cached). `level(at:_:strokes:)` → `LevelReading` (cycle, local, phase, progress, quarter, glyph index, start/end/remaining, `next` threshold, five `thresholds`); `odometer(at:_:strokes:digits:)`; `solar(at:)`, `solarSync(number:)`; `levelInfo(_:)` (letter, factor, siblings, `meanSeconds`); `cycle(level:index:)`, `cycle(at:level:)` → `CycleFacts` with `events`; `boundaries(level:from:to:limit:)`; `upcomingEnds(after:fromLevel:toLevel:count:)`; `stateOccurrences(…)`; `address(at:)`, `pathToCycle`, `cycleToPath`; `position(at:)`, `time(atPosition:)`; `tMin`, `tMax`, `clamp`, `inRange`, `catalogue` (eclipse times) |
| `Notation` (`Notation.standard`) | Pure-mode words (SPEC §15): `dateText`, `clockText`, `stamp`, `cycleName`, `nameAt`, `duration`, `countdown`, `between`, `cycleLength`, `rates`, `rateLabel`, `blinks`, `units`, `levelKind`, `Notation.pair(_:)` (the 256-state phase pair) |
| `Journal` | The journal face reading (`Journal.reading(at:unit:)`), `arcPoint`, `ordinal` |
| `EarthFormatter`, `EarthTime` | Earth time in a zone, exactly as src/core/format.js prints it (`date`, `time`, `long`, `short`, `label`, `tag`, `iso`, `parseInput`, `duration`, `countdown`) |
| `GlyphState`, `GlyphGeometry` | The CBT phase glyphs: state facts and the library's path geometry (`cgPath(index:strokes:)`) |
| `Fractonica` | Constants: `sequence`, `maxLevel` (13, the deepest level the UI shows), `supportedLevels`, `periodName(_:)`, `quarterNames` |

Cost (release, Apple silicon): 14 levels + 14 odometers ≈ 25 µs per frame; `upcomingEnds` and wide `boundaries`
queries are much heavier — compute them on change or at ≤ 4 Hz, never per frame.

## Core: the shared state and parts

Every screen reads the same four objects from the environment; non-view code uses their `shared` instances.

```swift
@Environment(ClockStore.self) private var store
@Environment(AppSettings.self) private var settings
@Environment(AppRouter.self) private var router
@Environment(ToastCenter.self) private var toasts
```

### ClockStore — the displayed time (src/core/store.js, time half)

`live` shows the device clock; `travel` shows `t0 + rate · (now − real0)`: rate 0 paused, 1 real speed from an
offset, anything else a time-lapse (negative runs backwards). Travel is clamped to the catalogue and a time-lapse stops
exactly at the edge it runs into (`lastChange == .edge`; the root shows a toast).

| Member | |
|---|---|
| `time(at: Date = .now) -> Double` | The displayed time. Cheap; screens get it through `ClockTimeline` instead of calling it on their own schedule |
| `isLive`, `isPlaying`, `isPaused`, `mode`, `rate`, `catalogue` | State |
| `travel(to:rate:)` | Show a moment; `rate` nil keeps a running time-lapse, else pauses there |
| `shift(by:)`, `goLive()`, `setRate(_:)`, `pause()`, `play()`, `togglePlay()` | Moving (`play` returns the `Edge` instead when standing at it) |
| `step(level:direction:)` | Previous / next cycle of a level, exactly src/main.js `stepCycle`; returns the `Edge` when there is nowhere to go |
| `playRate`, `chosenRate`, `direction`, `selectSpeed(_:)`, `setDirection(_:)` | The transport's speed choice |
| `revision`, `lastChange` (`.launch .jump .cycle .rate .pause .live .edge`) | Bumped on every discontinuity, never during continuous playback: `.onChange(of: store.revision)` to resynchronise audio or restart an animation |
| `clock` | The `FractonicaClock` |

Real-world features (timers, stopwatch, notifications, Focus sessions) run on the **device** clock (`Date.now`), never
on the displayed time; they may *read* the clock at real now (`clock.level(at: Date.now.timeIntervalSince1970, …)`).

### ClockTimeline — the only way to redraw with the clock

```swift
ClockTimeline(.periodic(1)) { t in Text(settings.wording.time(t)).font(.reading(34)) }   // a readout
ClockTimeline(.periodic(0.25)) { t in … }                                               // countdowns at 4 Hz
ClockTimeline(.animation) { t in Canvas { context, size in draw(t, context, size) } }   // moving graphics
ClockTimeline(.continuous) { t in … }                // every frame even while paused (motion of its own: Focus)
```

`.periodic(s)` fires when the *displayed* time crosses a multiple of `s` (live: on the second; during a time-lapse at
most 30 Hz; never while paused). `.animation` runs every display frame and idles while paused. All stop in the
background. Pick the slowest cadence that keeps the finest visible thing honest (ν changes every ~311 ms, λ every
~7.8 s, the η pair every ~71 s). Never run your own `Timer` for the clock. Content that needs the real instant (an
animation that runs while the clock is paused) reads `Date.now`, which is the tick's moment.

### AppSettings — what screens share (src/core/store.js, settings half)

Persisted in UserDefaults (`settings.v1`, one JSON value); every write is validated like the web store (invalid values
are ignored, never saved; `minDepth ≤ maxDepth` is kept). Bind with `Bindable(settings).pure` or `@Bindable var
settings = settings` inside `body`.

| Setting | Values | Meaning |
|---|---|---|
| `pure` | Bool, false | Pure mode: Fractonica terms only (no Gregorian dates, Earth units, percentages) |
| `zone` | IANA id or nil (system) | Earth times' zone; `timeZone` gives the `TimeZone` |
| `faceMode` | `.journal` / `.watch` | The Now screen's face |
| `journalUnit` | 0 … 6, 5 | The journal face's first unit (`Journal.units`) |
| `topDepth` | 2 … 11, 7 | Upper period of the watch face |
| `selectedLevel` | 0 … 13, 6 | The level highlighted everywhere and stepped by ◀︎ ▶︎ |
| `minDepth`, `maxDepth` | 1 … 14, 1 and 10 | Depth range of rings, ladder and timeline lanes |
| `showLetters` | Bool, false | Watch face period letters |
| `haptics` | Bool, true | Haptic feedback |

A feature's own preferences (timer presets, alert rules, sound mix …) belong to the feature: its own `@MainActor
@Observable` store in its folder, persisted under its own UserDefaults key prefixed with the feature name
(`timer.`, `alerts.`, `sound.` …) or in a file in Application Support.

### Wording — Earth or pure words (the `fmt` wrapper of src/main.js)

`let words = settings.wording` (reading it makes the view follow both pure mode and the zone). Going through it
guarantees pure mode never prints a Gregorian date or "3 h 20 min":

`date(t)`, `time(t)`, `dateTime(t)`, `long(t)`, `short(t)`, `label(t, relativeTo:)`, `day(t)`, `tag(t)`,
`duration(_:at:)`, `countdown(_:at:)`, `relative(_:to:)`, `rates`, `rateLabel(_:)`, `levelChip(_:)` ("η 7"),
`levelName(_:)`, `levelLabel(_:)`, `levelLength(_:)`; `words.earth` (`EarthFormatter` in the zone) and
`words.notation` for anything mode-specific.

### Theme, type and glyphs (Shared/)

- Colours: `Theme.background` #07090d, `background2`, `panel` #10161d, `panel2`, `panel3`, `line` #1f2a36, `line2`,
  `ink` #e7edf3, `ink2` #a3b1bf, `ink3` #7d8d9d; signals `teal` #4FD1C5 (period glyphs), `gold` #FFD60A (solar),
  `now` #ff5d73 (real now while travelling), `cursor` #8ab4ff (displayed time while travelling), `live` (green),
  `danger`, `tealDim`, `goldDim`; `Theme.levelColor(level, opacity:, lightness:)` = HSL(268 − min(level,13)·238/13,
  68 %, 64 %) and `Theme.levelHue`. No hex literals outside Theme.
- Type: `.font(.reading(size, weight:))` for anything that ticks (monospaced digits), `.font(.code(size))` for
  identifiers and stamps; system text styles (Dynamic Type) for everything else.
- `Backdrop()`: the canvas with the web app's two faint glows. Every screen already sits on it (see the shell);
  sheets and forms of your own: `.scrollContentBackground(.hidden).background { Backdrop() }`.
- Glyphs (identical to the library's `F.CBT` SVGs, pixel-snapped): `GlyphView(index:strokes:color:)`,
  `OdometerView(digits:strokes:color:spacing:)`, `PairView(fraction:color:height:)` (two 2-stroke glyphs, 256 states,
  SPEC §15.3); `GlyphShape` / `GlyphRowShape` to fill yourself; `GlyphLayout` to place glyphs inside a `Canvas`
  (`GlyphGeometry.cgPath` transformed by `layout.transform(glyph:)`, stroked at `layout.lineWidth`, round caps).

### Smaller parts

- `Haptics.play(.selection | .step | .success | .warning)` honours the Haptics setting (Taptic Engine on iOS, Force
  Touch trackpad on Mac). With `.sensoryFeedback`, gate it yourself: `.sensoryFeedback(.selection, trigger: x) { _, _
  in settings.haptics }`.
- `toasts.show("Link copied")` / `toasts.show(edge)`: a transient capsule at the top of the main window.
- Transport (Core/TransportBar.swift, TransportPanel.swift): the moment, Back to live, ◀︎ ▶︎ steps of the selected
  level, play / pause with a direction-and-speed menu, and the time-travel panel (date picker, step by any cycle,
  speed). It is the shell's; features never draw another global transport.

## The shell

### Screens and navigation

`Screen` (Shared/Screen.swift) lists every screen; its raw value is the id used in links and `-FXTab`:
`now rings ladder wave timeline converter month diary sound timer stopwatch alerts focus jump settings`.
`ScreenGroup` bundles `cycles` (rings ladder wave timeline), `calendar` (converter month diary) and `clock` (timer
stopwatch alerts).

| | iPhone (compact width) | iPad, Mac |
|---|---|---|
| Layout | Tabs Now · Cycles · Calendar · Clock · Jump (search role). A group's tab shows its screens behind a segmented control in the navigation bar's centre | `TabView(.sidebarAdaptable)`: every screen in the sidebar under its group; Sound and Focus are screens of their own; Jump is the search item. iPad can collapse the sidebar into a top tab bar |
| Transport | The tab bar's bottom accessory (Liquid Glass); minimised with the tab bar on scroll | iPad: bottom accessory. Mac: the window toolbar's centre |
| Now's toolbar | Sound, Focus, Settings | iPad: Focus, Settings. Mac: Focus, Settings in every screen's toolbar |
| Sound | A sheet over Now (medium / large) | A screen |
| Settings | A sheet | iPad: a sheet. Mac: the Settings window (⌘,) |
| Focus | A full-screen cover | iPad: a full-screen cover (and a sidebar screen). Mac: its own window that enters full screen (and a sidebar screen) |

`router.show(.timeline)` brings any screen forward in the right way for the layout (tab, segment, sheet, cover,
window); `router.selection` is the screen in the content area; `router.isCompact` tells which layout is up;
`router.open(AppLink)` travels to a link's moment and shows its screen. Jump is the `Tab(role: .search)` in both
layouts (and ⌘K): JumpScreen brings its own `.searchable` field, which iOS 26 shows in the tab bar's place on iPhone.

The shell gives every screen (`ScreenContent` in App/RootView.swift) its own `NavigationStack`, the backdrop, full
size and the shared toolbar items. A screen therefore:

- is a parameterless `View` reading the environment (the shell instantiates `NowScreen()` etc. — keep the stub's type
  name and initialiser);
- sets `.navigationTitle(Screen.x.title)` (shown large on iPad, in the Mac title bar; on iPhone a group's segmented
  control takes the title's place). Hide or inline it if the design wants the space;
- may add toolbar items: `.primaryAction` / `.topBarTrailing` (iOS) — never `.principal`, which belongs to the
  iPhone segmented control and the Mac transport;
- may push detail views (`NavigationLink`, `.navigationDestination`) and present its own sheets, popovers,
  inspectors and confirmation dialogs;
- lays content out inside the safe area (the navigation bar, the tab bar and the transport accessory on iPhone);
  scroll views run under the bars by themselves; only backgrounds go edge to edge.

`@Environment(\.isImmersive)` is true where a screen fills the display (Focus in its cover or window), false where it
is one screen in the window. Immersive screens offer their own way out with `@Environment(\.dismiss)` (it closes the
cover on iOS and the window on macOS).

### Links: AppLink (Shared/AppLink.swift)

`fractonica://<screen>[?t=<unix seconds>]`, registered as the app's URL scheme. Widgets use
`.widgetURL(AppLink(screen: .now).url)` or `Link(destination:)`; notifications carry one in `userInfo`
(`content.userInfo = AppLink(screen: .timer).userInfo`); App Intents can open one. The root view handles incoming
URLs (`.onOpenURL` → `router.open`). Unknown or empty screens open Now; `t` travels there, paused, clamped.

### Lifecycle hooks: FeatureHooks (App/FeatureHooks.swift)

Features that act outside their screens implement the hooks enum already in their folder (`AlertsHooks`,
`TimerHooks`, `SoundHooks`, `FocusHooks`; listed in `AppHooks.all`), all `@MainActor`, all optional:

| Hook | When |
|---|---|
| `launch()` | Once, after launch, before any window appears |
| `becameActive()` / `enteredBackground()` | Each time the app comes to the front / leaves it |
| `presentation(ofNotification identifier:) -> UNNotificationPresentationOptions?` | A notification arrives while the app is in front; return options for your own identifiers, nil for others. Unclaimed ones show as banner + sound |
| `open(_ notification: NotificationResponse) -> Bool` | The user tapped a notification or chose an action; return true when handled. Unhandled taps open the notification's `AppLink` |

`AlertsHooks.registerBackgroundTasks()` (iOS) is called while launching, before launch finishes, as BackgroundTasks
requires; Alerts registers its `BGAppRefreshTask` (`app.fractonica.clock.refresh`, already in Info.plist) there.

### Notifications

`NotificationRouter` (App/) is the one `UNUserNotificationCenter` delegate, installed while launching on both
platforms. Features never set the delegate. They post with identifier prefixes — `timer.` (Timer and Stopwatch),
`alert.` (Alerts) — attach an `AppLink`, request authorization themselves at a moment of intent, and share the
system's budget of 64 pending requests: Alerts keeps at most 60 `alert.` requests pending, so Timer always has room.

### macOS

- Scenes (App/FractonicaApp.swift, App/MacScenes.swift): the main `Window` ("main"), the Focus window ("focus",
  hidden title bar, opens full screen), `Settings`, and a `MenuBarExtra` showing the live minor clock ("34η 29ι")
  with a panel (reading, Open, Focus, Timer, pure mode, Quit). Open windows with `openWindow(id: WindowID.main)`.
- Menu commands (App/AppCommands.swift), mirroring the web app's keys: Space play / pause, N live, [ ] previous /
  next cycle, P pure mode, ⌘K Jump, ⇧⌘F Focus, ⌘1…⌘9 Now … Sound, ⌥⌘1…⌥⌘3 Timer, Stopwatch, Alerts, ⌘, Settings.
  Bare keys yield to a focused text field (verified with AppKit). A feature's own shortcuts go on its controls
  (`.keyboardShortcut`) or `.onKeyPress` inside its screen and must not reuse these.
- The app is sandboxed (user-selected files read-write, printing); widgets are sandboxed too. Dark appearance
  everywhere. No App Group: widgets configure themselves through their own App Intents, not the app's settings.

## Launch arguments (App/LaunchOptions.swift)

Read from UserDefaults' argument domain, never persisted; they work on iOS (simctl launch, shoot.sh) and macOS
(`open Fractonica.app --args …`).

| Argument | Effect |
|---|---|
| `-FXTab <screen>` | Open a screen (presented the way it normally appears) |
| `-FXTime <unix s>` | Travel there, paused (1791460800 is SPEC §12 vector A, 2026-10-08 12:00 UTC); clamped to the catalogue |
| `-FXPure 1\|0` | Pure mode for this launch |
| `-FXZone <IANA id>` | Time zone for this launch (UTC for reproducible shots) |
| `-FXLink <url>` | Open an `AppLink` as a widget or notification tap does; replaces `-FXTab`, its `t` replaces `-FXTime` |

## Info.plist keys and entitlements in place

iOS app: `UIBackgroundModes` audio + fetch, `BGTaskSchedulerPermittedIdentifiers` [app.fractonica.clock.refresh],
`NSSupportsLiveActivities`, `CFBundleURLTypes` (fractonica), dark `UIUserInterfaceStyle`, all orientations on iPad,
portrait + landscape on iPhone. macOS app: `CFBundleURLTypes`; entitlements app-sandbox, files.user-selected.read-write,
print. Widget extensions: the WidgetKit extension point (macOS: app-sandbox). Notifications, local audio output,
WKWebView with a custom scheme, `UIApplication.isIdleTimerDisabled` and haptics need nothing more.

## Logic checks (scripts/check.sh)

The app targets have no unit-test bundle. Pure logic (stores, schedulers, parsers, geometry, formatting) is checked
by small Swift programs compiled on the Mac against FractonicaKit and the app files they need:

```
ios/Fractonica/Features/Alerts/Checks/
  AlertsChecks.swift     @main type calling check(_:_:) …, then Checks.finish()
  sources                Fractonica/Features/Alerts/AlertRule.swift   (one path per line, relative to ios/, globs ok)
```

`ios/scripts/check.sh ios/Fractonica/Features/Alerts/Checks` builds and runs it (`all` runs every Checks folder).
Checks folders never ship (project.yml excludes them). Code that imports UIKit cannot be checked this way, so keep the
logic you check free of it. Example: Fractonica/Core/Checks (settings validation and persistence, the time model,
cycle stepping, edge stops, tick scheduling, links). Engine changes are tested with `swift test` in FractonicaKit.

## Feature agent checklist

1. **Your files.** Work in `Fractonica/Features/<YourFeature>/` (plus exactly the extra paths your brief lists).
   Replace your stub(s), keeping the type names and parameterless initialisers; add as many files as you like.
   Do not edit `App/`, `Core/`, `Shared/`, `Widgets/`, `project.yml`, `Support/`, `scripts/`, FractonicaKit or
   another feature's folder. If you need a shared change, write a local helper in your folder and put the exact
   change you would want (file, code, why) under "requests" in your report.
2. **Read the clock right.** `ClockTimeline` at the slowest honest cadence; engine readings at most once per level per
   frame; heavy queries on change or ≤ 4 Hz; nothing outside the catalogue (show a tidy out-of-range state); real-world
   timing on `Date.now`.
3. **Say it right.** All text through `settings.wording` (or `Notation` in pure mode): pure mode must contain no
   Gregorian date, zone, Earth unit or percentage. Colours from `Theme`, tickers in `.reading`, glyphs from the glyph
   views. Dynamic Type for UI text, accessibility labels on graphics, Reduce Motion respected, haptics via `Haptics`.
4. **Build both apps** (zero errors, no warnings in your files), with DerivedData in your scratch folder:
   ```
   export DERIVED_DATA=<scratchpad>/<agent>/dd
   ios/scripts/build.sh ios      # xcodegen + iOS app and widgets for the simulator (unsigned)
   ios/scripts/build.sh mac      # macOS app and widgets, ad-hoc signed
   ios/scripts/build.sh kit      # FractonicaKit tests, if you touched the kit
   ```
   It prints only diagnostics and the .app paths; full logs are in `$DERIVED_DATA/Logs/fx-*.log`.
5. **Look at it.** Screenshot your screen on your own simulator (never the default one), then Read every PNG:
   ```
   ios/scripts/shoot.sh --no-build --device "fx-<agent>" /path/shot.png -FXTab <screen> -FXTime 1791460800 -FXZone UTC
   ios/scripts/shoot.sh --no-build --device "fx-<agent>" /path/pure.png -FXTab <screen> -FXTime 1791460800 -FXPure 1
   ios/scripts/shoot.sh --no-build --device "fx-<agent>-ipad" --type "iPad Pro 13-inch (M5)" /path/ipad.png -FXTab <screen>
   ```
   Also try other instants (946684800, 2886085800, near `tMin` / `tMax`), live (no `-FXTime`) and `-FXLink`.
   `--wait N` gives slow screens time to settle. Launch the Mac app once:
   `open "$DERIVED_DATA/Build/Products/Debug/Fractonica.app" --args -FXTab <screen> -FXTime 1791460800`
   (quit it afterwards; `screencapture` needs Screen Recording permission and may be unavailable).
6. **Check the logic** in a `Checks` folder (above) and run it with `ios/scripts/check.sh`.
7. **Info.plist keys or entitlements.** First check "Info.plist keys and entitlements in place" above. If your feature
   truly needs another, request it: the target, the key or entitlement, its value and why, as the exact project.yml
   lines (`info.properties` or `entitlements.properties` of the target; never edit Support/*, which xcodegen
   rewrites). You may add it to project.yml locally to try it out, but revert it before committing
   (`git checkout -- ios/project.yml ios/Support`).
8. **Clean up.** Commit only your files; delete your simulators (`ios/scripts/shoot.sh --device "fx-<agent>" --delete`)
   and your DerivedData.
