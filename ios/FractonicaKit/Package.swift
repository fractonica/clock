// swift-tools-version: 6.0
//
// FractonicaKit: the Fractonica clock engine for the native iOS and macOS apps and their widgets.
// A dependency-free port of the web app's clock model (src/core/model.js on top of fractonica.js), its pure-mode
// notation (src/core/pure.js), Earth-time formatting (src/core/format.js) and the journal face reading
// (src/ui/face/journal.js). Golden fixtures generated from that JavaScript keep the two in lock step.
import PackageDescription

let package = Package(
    name: "FractonicaKit",
    // String versions: the `.v26` constants need tools version 6.2.
    platforms: [.iOS("18.6"), .macOS("26.0")],
    products: [
        .library(name: "FractonicaKit", targets: ["FractonicaKit"]),
    ],
    targets: [
        .target(name: "FractonicaKit"),
        .testTarget(
            name: "FractonicaKitTests",
            dependencies: ["FractonicaKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
