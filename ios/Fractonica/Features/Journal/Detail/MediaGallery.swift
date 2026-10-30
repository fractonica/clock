import AVKit
import SwiftUI

/// An entry's photos and videos full screen: swipe between them (arrows and ← → on the Mac), pinch or double-tap a
/// photo to zoom, videos in the system player; swipe up or down to put it away (not while a photo is zoomed).
struct MediaGallery: View {
    let visuals: [BlobRef]
    let words: Wording
    let time: Double

    @Environment(\.dismiss) private var dismiss
    @State private var index: Int
    /// The drag under way (springing back when it ends or is taken over by the paging) and, once it dismisses, the
    /// page's flight away, in points.
    @GestureState(resetTransaction: Transaction(animation: .snappy)) private var pull = Pull()
    @State private var flight: CGFloat = 0
    @State private var zoomed = false

    /// A drag's direction, fixed by its first movement (only a vertical one dismisses), and how far down it is.
    private struct Pull: Equatable {
        var axis: Axis?
        var y: CGFloat = 0
    }

    private var drag: CGFloat { flight != 0 ? flight : pull.y }

    /// A drag this far (or a flick heading this far) dismisses.
    private static let dismissDistance: CGFloat = 110
    private static let dismissFlick: CGFloat = 320

    init(visuals: [BlobRef], start: Int, words: Wording, time: Double) {
        self.visuals = visuals
        self.words = words
        self.time = time
        _index = State(initialValue: min(max(0, start), max(0, visuals.count - 1)))
    }

    var body: some View {
        let pull = min(1, abs(drag) / 400)
        ZStack {
            Color.black.opacity(1 - 0.8 * pull).ignoresSafeArea()
            pages
                .offset(y: drag)
                .scaleEffect(1 - 0.12 * pull)
                .simultaneousGesture(dismissDrag, including: zoomed ? .subviews : .all)
        }
        .overlay(alignment: .top) { topBar.opacity(1 - 2 * pull) }
        .onChange(of: index) { zoomed = false }
        #if os(macOS)
        .overlay { arrows }
        .onKeyPress(.leftArrow) { step(-1); return .handled }
        .onKeyPress(.rightArrow) { step(1); return .handled }
        .onKeyPress(.escape) { dismiss(); return .handled }
        #endif
        .preferredColorScheme(.dark)
    }

    @ViewBuilder
    private var pages: some View {
        #if os(iOS)
        TabView(selection: $index) {
            ForEach(Array(visuals.enumerated()), id: \.element.hash) { i, blob in
                page(blob, active: i == index).tag(i)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: visuals.count > 1 ? .automatic : .never))
        .ignoresSafeArea()
        #else
        if visuals.indices.contains(index) {
            page(visuals[index], active: true)
                .id(visuals[index].hash)
                .transition(.opacity)
        }
        #endif
    }

    @ViewBuilder
    private func page(_ blob: BlobRef, active: Bool) -> some View {
        if blob.role == "video" {
            GalleryVideo(blob: blob, active: active)
        } else {
            ZoomableImage(blob: blob, active: active, zoomed: $zoomed)
        }
    }

    /// Up or down puts the gallery away: the page follows the finger and shrinks, the black thins to the entry under
    /// it; let go short of the distance and it springs back.
    private var dismissDrag: some Gesture {
        DragGesture(minimumDistance: 14)
            .updating($pull) { value, pull, _ in
                if pull.axis == nil {
                    pull.axis = abs(value.translation.height) > abs(value.translation.width) ? .vertical : .horizontal
                }
                pull.y = pull.axis == .vertical ? value.translation.height : 0
            }
            .onEnded { value in
                let t = value.translation
                guard abs(t.height) > abs(t.width),
                      abs(t.height) > Self.dismissDistance || abs(value.predictedEndTranslation.height) > Self.dismissFlick
                else { return }
                withAnimation(.easeOut(duration: 0.2)) { flight = t.height < 0 ? -1200 : 1200 } completion: {
                    var quiet = Transaction()
                    quiet.disablesAnimations = true
                    withTransaction(quiet) { dismiss() }
                }
            }
    }

    private var topBar: some View {
        HStack {
            if visuals.count > 1 || caption != nil {
                Text(verbatim: [visuals.count > 1 ? "\(index + 1) / \(visuals.count)" : nil, caption].compactMap { $0 }.joined(separator: "  ·  "))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .glassSurface(.regular, in: .capsule)
            }
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .glassSurface(.regular.interactive(), in: .circle)
            .accessibilityLabel("Close")
            .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    /// What a moment's photo is: "Back · 1λ before", "Front" (from its name, `back@-1`, `front`).
    private var caption: String? {
        guard visuals.indices.contains(index), let name = visuals[index].name, let p = MomentCaptures.parse(name),
              ["front", "back", "camera"].contains(p.camera) else { return nil }
        return [p.camera.capitalized, p.offset.map(MomentCaptures.offsetLabel)].compactMap { $0 }.joined(separator: " · ")
    }

    #if os(macOS)
    private var arrows: some View {
        HStack {
            arrow("chevron.left", -1).opacity(index > 0 ? 1 : 0)
            Spacer()
            arrow("chevron.right", 1).opacity(index < visuals.count - 1 ? 1 : 0)
        }
        .padding(.horizontal, 16)
    }

    private func arrow(_ name: String, _ direction: Int) -> some View {
        Button { step(direction) } label: {
            Image(systemName: name).font(.system(size: 18, weight: .semibold)).foregroundStyle(.white).frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .glassSurface(.regular.interactive(), in: .circle)
    }
    #endif

    private func step(_ direction: Int) {
        let next = index + direction
        guard visuals.indices.contains(next) else { return }
        withAnimation(.snappy) { index = next }
    }
}

/// A photo that pinches and double-taps to zoom (up to 5×) and pans while zoomed.
private struct ZoomableImage: View {
    let blob: BlobRef
    /// The page on screen: leaving it unzooms it.
    let active: Bool
    /// Whether the page on screen is zoomed (the gallery's dismissing drag waits until it is not).
    @Binding var zoomed: Bool

    @State private var scale: CGFloat = 1
    @State private var baseScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var baseOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            BlobImage(blob: blob, points: max(geo.size.width, geo.size.height) * 2, contentMode: .fit, fetchesFull: true)
                .frame(width: geo.size.width, height: geo.size.height)
                .scaleEffect(scale)
                .offset(offset)
                .gesture(magnify)
                .simultaneousGesture(scale > 1 ? pan : nil)
                .onTapGesture(count: 2) {
                    withAnimation(.snappy) {
                        if scale > 1 { reset() } else { scale = 2.5; baseScale = 2.5 }
                    }
                }
                .accessibilityLabel("Photo")
                .accessibilityAddTraits(.isImage)
        }
        .ignoresSafeArea()
        .onChange(of: scale > 1.01) { _, isZoomed in if active { zoomed = isZoomed } }
        .onChange(of: active) { _, isActive in if !isActive { reset() } }
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in scale = min(5, max(1, baseScale * value.magnification)) }
            .onEnded { _ in
                baseScale = scale
                if scale <= 1.01 { withAnimation(.snappy) { reset() } }
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(width: baseOffset.width + value.translation.width, height: baseOffset.height + value.translation.height)
            }
            .onEnded { _ in baseOffset = offset }
    }

    private func reset() {
        scale = 1
        baseScale = 1
        offset = .zero
        baseOffset = .zero
    }
}

/// A video in the system player; it pauses when its page is left.
private struct GalleryVideo: View {
    let blob: BlobRef
    let active: Bool

    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            if let player {
                VideoPlayer(player: player)
            } else {
                BlobImage(blob: blob, points: 900, contentMode: .fit)
            }
        }
        .task {
            guard player == nil else { return }
            var url = JournalStore.shared.blobFile(blob.hash)
            if url == nil, let fetch = JournalHooks.fetchBlob { url = try? await fetch(blob.hash) }
            guard let url else { return }
            JournalAudioPlayer.shared.pause()
            JournalAudioPlayer.activateSession()
            player = AVPlayer(url: url)
        }
        .onChange(of: active) { _, isActive in if !isActive { player?.pause() } }
        .onDisappear { player?.pause() }
    }
}
