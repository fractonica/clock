#!/usr/bin/env swift
// Renders the app icon into the asset catalog:
//
//     swift ios/scripts/make-icon.swift            (from any directory)
//
// A large 3-stroke CBT phase glyph (SPEC §4, §9: state 20 of 52, value 6 on the falling branch, so it shows a bar,
// both curves and the derivative dot) in teal with a soft glow, inside a thin ring of the fourteen level colours
// (violet α … amber ξ, src/core/theme.js), on the app's near-black background. iOS gets one full-bleed opaque
// 1024 px square (the system masks it); macOS gets the rounded-square icon on the standard grid in every size.
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let iconSet = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("Fractonica/Resources/Assets.xcassets/AppIcon.appiconset")

// MARK: Colours

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

/// HSL(268 − level·238/13, 68 %, 64 %): the level colour of the web app.
func levelColor(_ level: Int) -> CGColor {
    let hue = (268 - Double(level) * 238 / 13).rounded() / 360
    let s = 0.68, l = 0.64
    let c = (1 - abs(2 * l - 1)) * s
    let h = hue * 6
    let x = c * (1 - abs(h.truncatingRemainder(dividingBy: 2) - 1))
    let (r, g, b): (Double, Double, Double) = h < 1 ? (c, x, 0) : h < 2 ? (x, c, 0) : h < 3 ? (0, c, x) : h < 4 ? (0, x, c) : h < 5 ? (x, 0, c) : (c, 0, x)
    let m = l - c / 2
    return CGColor(srgbRed: r + m, green: g + m, blue: b + m, alpha: 1)
}

let background = rgb(0x07090D)
let teal = rgb(0x4FD1C5)

// MARK: Glyph (SPEC §9.1, design units, y down, least significant trit at the top)

/// Balanced-ternary trits of `value`, least significant first.
func trits(_ value: Int, strokes: Int) -> [Int] {
    var v = value, out: [Int] = []
    for _ in 0..<strokes {
        var r = v % 3
        if r == 2 { r = -1 } else if r == -2 { r = 1 }
        out.append(r)
        v = (v - r) / 3
    }
    return out
}

func glyphPath(value: Int, strokes: Int) -> CGPath {
    let path = CGMutablePath()
    for (i, t) in trits(value, strokes: strokes).enumerated() {
        let y = CGFloat(3 * i)
        path.move(to: CGPoint(x: 0, y: y))
        path.addLine(to: CGPoint(x: 0, y: y + 3))
        switch t {
        case 0:
            path.move(to: CGPoint(x: -1, y: y))
            path.addLine(to: CGPoint(x: 1, y: y))
        default:
            let d = CGFloat(t)
            path.move(to: CGPoint(x: 0, y: y))
            path.addCurve(to: CGPoint(x: d, y: y + d), control1: CGPoint(x: 0, y: y), control2: CGPoint(x: 0, y: y + d))
            path.addCurve(to: CGPoint(x: 2 * d, y: y), control1: CGPoint(x: 2 * d, y: y + d), control2: CGPoint(x: 2 * d, y: y))
        }
    }
    return path
}

// MARK: Drawing

/// Draws the icon artwork into `rect` (a square) of `context` (y up).
func drawArtwork(in context: CGContext, rect: CGRect) {
    let size = rect.width
    let center = CGPoint(x: rect.midX, y: rect.midY)

    context.setFillColor(background)
    context.fill(rect)
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    func glow(_ color: CGColor, at point: CGPoint, radius: CGFloat) {
        let gradient = CGGradient(colorsSpace: space, colors: [color, color.copy(alpha: 0)!] as CFArray, locations: [0, 1])!
        context.drawRadialGradient(gradient, startCenter: point, startRadius: 0, endCenter: point, endRadius: radius, options: [])
    }
    glow(rgb(0x4FD1C5, 0.16), at: CGPoint(x: rect.minX + 0.1 * size, y: rect.maxY + 0.05 * size), radius: 0.95 * size)
    glow(rgb(0x8AB4FF, 0.10), at: CGPoint(x: rect.maxX, y: rect.minY - 0.05 * size), radius: 0.8 * size)

    // the level ring: fourteen arcs, α at the top, clockwise
    let ringRadius = 0.385 * size
    let gap = 2.4 * Double.pi / 180
    let sweep = 2 * Double.pi / 14
    context.setLineWidth(0.016 * size)
    context.setLineCap(.round)
    for level in 0..<14 {
        let start = Double.pi / 2 - Double(level) * sweep - gap / 2
        let end = start - sweep + gap
        context.setStrokeColor(levelColor(level))
        context.addArc(center: center, radius: ringRadius, startAngle: start, endAngle: end, clockwise: true)
        context.strokePath()
    }

    // the glyph: state 20 of 52 (value 6, falling, dotted), centred on its bounds x ∈ [−2.15, 2.15], y ∈ [−2.2, 9.15]
    let unit = 0.52 * size / 11.35
    let thickness: CGFloat = 0.42
    context.saveGState()
    context.translateBy(x: center.x, y: center.y + (9.15 - 2.2) / 2 * unit)
    context.scaleBy(x: unit, y: -unit)
    context.setShadow(offset: .zero, blur: 0.05 * size, color: rgb(0x4FD1C5, 0.55))
    context.setStrokeColor(teal)
    context.setFillColor(teal)
    context.setLineWidth(thickness)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.addPath(glyphPath(value: 6, strokes: 3))
    context.strokePath()
    context.addEllipse(in: CGRect(x: -0.3, y: -1.75 - 0.3, width: 0.6, height: 0.6))
    context.fillPath()
    context.restoreGState()
}

func makeContext(_ pixels: Int, opaque: Bool) -> CGContext {
    CGContext(
        data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
    )!
}

func write(_ image: CGImage, _ name: String) {
    let url = iconSet.appendingPathComponent(name)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(url.path)") }
    print("wrote \(url.path)")
}

func resized(_ image: CGImage, to pixels: Int) -> CGImage {
    let ctx = makeContext(pixels, opaque: false)
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: pixels, height: pixels))
    return ctx.makeImage()!
}

try FileManager.default.createDirectory(at: iconSet, withIntermediateDirectories: true)

// iOS: full bleed, opaque
let ios = makeContext(1024, opaque: true)
drawArtwork(in: ios, rect: CGRect(x: 0, y: 0, width: 1024, height: 1024))
write(ios.makeImage()!, "AppIcon-iOS.png")

// macOS: an 824 px rounded square on the 1024 grid with a soft shadow
let mac = makeContext(1024, opaque: false)
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)
mac.saveGState()
mac.setShadow(offset: CGSize(width: 0, height: -10), blur: 28, color: CGColor(gray: 0, alpha: 0.45))
mac.addPath(shape)
mac.setFillColor(background)
mac.fillPath()
mac.restoreGState()
mac.saveGState()
mac.addPath(shape)
mac.clip()
drawArtwork(in: mac, rect: tile)
mac.restoreGState()
mac.addPath(shape)
mac.setStrokeColor(CGColor(gray: 1, alpha: 0.08))
mac.setLineWidth(2)
mac.strokePath()
let macImage = mac.makeImage()!

var images: [[String: String]] = [["filename": "AppIcon-iOS.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"]]
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = points * scale
        let name = "AppIcon-mac-\(pixels).png"
        write(pixels == 1024 ? macImage : resized(macImage, to: pixels), name)
        images.append(["filename": name, "idiom": "mac", "scale": "\(scale)x", "size": "\(points)x\(points)"])
    }
}
let contents: [String: Any] = ["images": images, "info": ["author": "xcode", "version": 1]]
let json = try JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys])
try json.write(to: iconSet.appendingPathComponent("Contents.json"))
print("wrote \(iconSet.appendingPathComponent("Contents.json").path)")
