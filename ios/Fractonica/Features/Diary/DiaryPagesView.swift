import SwiftUI

/// Every page of the diary as thumbnails under its section (index, ephemeris, each Nuclide …): tap one to turn to it.
/// Thumbnails are drawn by the web renderer on demand, as they scroll into view.
struct DiaryPagesView: View {
    let model: DiaryModel

    @Environment(\.dismiss) private var dismiss

    private struct Group: Identifiable {
        var title: String
        var pages: [DiaryPlan.Page]
        var id: Int { pages.first?.no ?? 0 }
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(model.plan.map { "\($0.pages.count) pages" } ?? "Pages")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
                .background { Backdrop() }
        }
        #if os(macOS)
        .frame(minWidth: 640, minHeight: 560)
        #endif
    }

    @ViewBuilder
    private var content: some View {
        if let plan = model.plan {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 92, maximum: 132), spacing: 14, alignment: .top)],
                              alignment: .leading, spacing: 16, pinnedViews: [.sectionHeaders]) {
                        ForEach(groups(plan)) { group in
                            Section {
                                ForEach(group.pages) { page in
                                    Button {
                                        model.go(to: page.no, smooth: false)
                                        Haptics.play(.selection)
                                        dismiss()
                                    } label: {
                                        DiaryThumbnail(model: model, page: page, aspect: plan.size.width / plan.size.height,
                                                       current: model.pair.contains(page.no), shown: model.shownPage == page.no)
                                    }
                                    .buttonStyle(.plain)
                                    .id(page.no)
                                }
                            } header: {
                                Text(group.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Theme.ink)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 8)
                                    .padding(.horizontal, 4)
                                    .background(Theme.background.opacity(0.92))
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .onAppear { proxy.scrollTo(model.page, anchor: .center) }
            }
        } else {
            ProgressView("Planning the diary…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// Pages grouped by the plan's sections; pages before the first section (a cover) open the book.
    private func groups(_ plan: DiaryPlan) -> [Group] {
        var out: [Group] = []
        var key: Int?
        for page in plan.pages {
            let section = plan.section(at: page.no)
            let k = section?.page ?? 0
            if k != key {
                out.append(Group(title: section?.title ?? "Cover", pages: []))
                key = k
            }
            out[out.count - 1].pages.append(page)
        }
        return out
    }
}

/// One page as a small picture with its number; the page on show is outlined, the page of the displayed moment dotted.
struct DiaryThumbnail: View {
    let model: DiaryModel
    let page: DiaryPlan.Page
    let aspect: Double
    var current = false
    var shown = false

    @State private var image: Image?
    @Environment(\.displayScale) private var scale

    var body: some View {
        VStack(spacing: 5) {
            ZStack(alignment: .topTrailing) {
                Rectangle()
                    .fill(.white)
                    .overlay { image?.resizable().interpolation(.high) }
                    .aspectRatio(aspect, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: 2))
                    .shadow(color: .black.opacity(0.45), radius: 5, y: 3)
                    .overlay {
                        RoundedRectangle(cornerRadius: 3)
                            .strokeBorder(current ? Theme.teal : .clear, lineWidth: 2)
                            .padding(-3)
                    }
                if shown {
                    Circle().fill(Theme.cursor).frame(width: 8, height: 8).padding(5)
                        .accessibilityHidden(true)
                }
            }
            Text(page.no, format: .number.grouping(.never))
                .font(.reading(11, weight: current ? .semibold : .regular))
                .foregroundStyle(current ? Theme.teal : Theme.ink3)
        }
        .task(id: page.no) {
            guard image == nil else { return }
            let pixels = Int(132 * max(scale, 2))
            if let data = await model.thumbnail(page: page.no, pixels: pixels) {
                image = DiaryImage.image(data)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Page \(page.title)")
        .accessibilityAddTraits(current ? [.isSelected, .isButton] : .isButton)
    }
}
