# Fractonica for iPhone, iPad and Mac

The Fractonica clock as native apps: everything the web app does, rebuilt in SwiftUI for the system it runs on,
plus a timer, a stopwatch, alerts, a Focus mode and widgets. Dark, quiet and precise: teal for the period glyphs,
gold for the solar sync, one colour per level. Pure mode (Settings, or P on a keyboard) says everything in
Fractonica terms only, with no Gregorian dates, Earth units or percentages.

## What is in it

**Screens.** *Now*, the clock face (journal or watch). *Cycles*: Rings, the concentric dial of every cycle; Ladder,
one row per depth with Up next; Wave, the harmonic geometry as a you-are-here map; Timeline, zoomable from the whole
catalogue down to seconds. *Calendar*: Converter (Gregorian ⇄ Saros position, address, glyphs, solar sync), Month
and Diary (the printable diary of a Delta). *Clock*: Timer and Stopwatch counted on the ladder, and Alerts.
*Sound* plays the hierarchy as a just-intonation chord with bells at the thresholds. *Jump* goes to any moment you
type ("next ε", "2031-06-01 14:30 Tokyo", "Delta Trifracton Node"). The transport (moment, back to live, previous /
next cycle, play a time-lapse at any speed) is always at hand.

| | |
|---|---|
| **iPhone** | Tabs Now · Cycles · Calendar · Clock, and Jump as the search tab. The transport rides above the tab bar; Sound, Focus and Settings sit in Now's toolbar |
| **iPad** | Every screen in a sidebar (or a top tab bar), the transport at the bottom; full keyboard shortcuts and pointer support |
| **Mac** | The same sidebar in a window, the transport in the toolbar, menu commands with the web app's keys (Space, N, [ ], P, M, ⌘K, ⌘1…9), a Settings window, Focus in a full-screen window of its own, and the live clock in the menu bar ("34η 29ι") with quick actions |
| **Widgets** | Home Screen, desktop and StandBy: the journal face, the clock, Up next, the rings, an extra-large overview on iPad and Mac; the Helion Arc (the Helion's double arc with the running Preon riding it as a wave) there and on the Lock Screen; Lock Screen accessories on iPhone and iPad; Focus and Timer controls in Control Center |
| **Live Activities** | A running timer or stopwatch on the Lock Screen and in the Dynamic Island (iPhone) |
| **Notifications** | Alerts: choose the moments you want to hear about — turnovers and quarters of any level, the solar sync, eclipses — with lead times, sounds and quiet hours. Timers ring through Focus modes (time-sensitive) |
| **Focus** | The clock as a vivid full-screen animation of many combined harmonics in four styles, with a breathing cue and an optional session; it follows Reduce Motion |
| **Siri and Shortcuts** | "What's the Fractonica time?", Open Focus, Open a screen |

## Build and run

Requirements: Xcode 27, [XcodeGen](https://github.com/yonaskolb/XcodeGen). The iPhone and iPad app (with its widgets)
runs from iOS 18.6: Liquid Glass and the tab bar's accessory on iOS 26 and later, that system's own equivalents on iOS
18. The Mac app needs macOS 26. There are no third-party dependencies.

```sh
cd ios
xcodegen generate          # Fractonica.xcodeproj from project.yml (the project is not committed)
open Fractonica.xcodeproj
```

Schemes: **Fractonica** (iPhone and iPad, with the widgets) and **FractonicaMac** (Mac, with the widgets). Signing
uses team `G23G724G3D`; pick your own team in Signing & Capabilities if you build for a device with another account.
The build copies the web app's `fractonica.js` and `src/` into the bundle for the Diary.

From the command line, without signing (simulator) or signed ad hoc (Mac):

```sh
ios/scripts/build.sh ios      # or mac, kit, all; DERIVED_DATA=… to choose where products go
ios/scripts/shoot.sh /tmp/now.png -FXTab now -FXTime 1791460800 -FXZone UTC   # simulator screenshot
ios/scripts/shoot.sh --runtime iOS-18-6 --type "iPhone 16 Pro" --device "Fractonica 18" /tmp/now18.png -FXTab now
```

Launch arguments (`-FXTab`, `-FXTime`, `-FXPure`, `-FXZone`, `-FXLink`, `-FXRate`, and each feature's own) put the
app into a given state for screenshots; ARCHITECTURE.md lists them.

## Tests

```sh
swift test --package-path ios/FractonicaKit     # the engine's golden tests against the JavaScript (or build.sh kit)
ios/scripts/check.sh all                        # the app's logic checks (every Checks folder)
ios/Widgets/Checks/Render/render.sh /tmp/widgets   # every widget family rendered to contact sheets on the Mac
```

The engine's fixtures are generated from the web app's own modules (from the repository root, with Node):
`node ios/scripts/make-fixtures.mjs`, `node ios/scripts/make-fuzz-fixtures.mjs` and
`node ios/scripts/make-jump-fixtures.mjs`. The app icon comes from `swift ios/scripts/make-icon.swift`.

## Folders

| Path | |
|---|---|
| `FractonicaKit/` | The clock engine (Swift package): cycles, glyphs, notation, Earth time, jump grammars |
| `Fractonica/App/` | Entry point, layouts, scenes, menu commands, links, notifications, launch arguments |
| `Fractonica/Core/` | Shared state and parts: clock, settings, router, wording, transport, toasts, haptics |
| `Fractonica/Features/` | One folder per screen or feature; `Intents` holds Siri and Shortcuts |
| `Shared/` | Theme, backdrop, glyph views, screens and links, the timer's Live Activity, shared by app and widgets |
| `Widgets/` | The widget extension for iOS and macOS |
| `Support/` | Info.plists and entitlements, generated from `project.yml` |
| `scripts/` | build, screenshots, checks, fixture and icon generators |

How it fits together, and the rules for working on it: [ARCHITECTURE.md](ARCHITECTURE.md). The web app at the
repository root is the functional reference (README.md, SPEC.md, docs/design).
