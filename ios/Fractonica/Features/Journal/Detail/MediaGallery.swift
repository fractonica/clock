import AVKit
import SwiftUI

/// An entry's photos and videos full screen: swipe between them (arrows and ← → on the Mac), pinch or double-tap a
/// photo to zoom, videos in the system player.
struct MediaGallery: View {
    let visuals: [BlobRef]
    let words: Wording
    let time: Double

    @Environment(\.dismiss) private var dismiss
    @State private var index: Int

    init(visuals: [BlobRef], start: Int, words: Wording, time: Double) {
        self.visuals = visuals
        self.words = words
        self.time = time
        _index = State(initialValue: min(max(0, start), max(0, visuals.count - 1)))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            pages
        }
        .overlay(alignment: .top) { topBar }
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
            ZoomableImage(blob: blob)
        }
    }

    private var topBar: some View {
        HStack {
            if visuals.count > 1 {
                Text(verbatim: "\(index + 1) / \(visuals.count)")
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

    @State private var scale: CGFloat = 1
    @State private var baseScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var baseOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            BlobImage(blob: blob, points: max(geo.size.width, geo.size.height) * 2, contentMode: .fit)
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
        .onAppear {
            if player == nil, let url = JournalStore.shared.blobFile(blob.hash) {
                JournalAudioPlayer.shared.pause()
                JournalAudioPlayer.activateSession()
                player = AVPlayer(url: url)
            }
        }
        .onChange(of: active) { _, isActive in if !isActive { player?.pause() } }
        .onDisappear { player?.pause() }
    }
}
