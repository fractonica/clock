import SwiftUI

/// An entry's Markdown, rendered: the blocks from `MarkdownBlock.parse` laid out as SwiftUI views, inline syntax by
/// `AttributedString(markdown:)` (emphasis, strong, code spans, links, strikethrough), line breaks kept.
struct MarkdownView: View {
    let blocks: [MarkdownBlock]
    var bodyFont: Font = .body

    init(_ source: String, bodyFont: Font = .body) {
        blocks = MarkdownBlock.parse(source)
        self.bodyFont = bodyFont
    }

    init(blocks: [MarkdownBlock], bodyFont: Font = .body) {
        self.blocks = blocks
        self.bodyFont = bodyFont
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                BlockView(block: block, bodyFont: bodyFont)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
}

private struct BlockView: View {
    let block: MarkdownBlock
    let bodyFont: Font

    var body: some View {
        switch block {
        case .heading(let level, let text):
            Text(markdownInline(text))
                .font(headingFont(level))
                .foregroundStyle(Theme.ink)
                .padding(.top, level <= 2 ? 6 : 2)
                .accessibilityAddTraits(.isHeader)
        case .paragraph(let text):
            Text(markdownInline(text))
                .font(bodyFont)
                .foregroundStyle(Theme.ink)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        marker(ordered: ordered, number: start + i, item: item)
                            .frame(minWidth: 18, alignment: .trailing)
                        Text(markdownInline(item.text))
                            .font(bodyFont)
                            .foregroundStyle(item.task == true ? Theme.ink3 : Theme.ink)
                            .strikethrough(item.task == true, color: Theme.ink3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.leading, CGFloat(item.depth) * 20)
                }
            }
        case .quote(let inner):
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(Theme.teal.opacity(0.7))
                    .frame(width: 3)
                MarkdownView(blocks: inner, bodyFont: bodyFont)
                    .foregroundStyle(Theme.ink2)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .code(_, let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(verbatim: text)
                    .font(.code(14))
                    .foregroundStyle(Theme.ink)
                    .padding(12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel2, in: .rect(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line, lineWidth: 1))
        case .rule:
            Rectangle().fill(Theme.line2).frame(height: 1).padding(.vertical, 4)
        }
    }

    @ViewBuilder
    private func marker(ordered: Bool, number: Int, item: MarkdownListItem) -> some View {
        if let done = item.task {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(done ? Theme.teal : Theme.ink3)
                .font(bodyFont)
        } else if ordered {
            Text(verbatim: "\(number).")
                .font(bodyFont.monospacedDigit())
                .foregroundStyle(Theme.ink2)
        } else {
            Text(verbatim: item.depth % 2 == 0 ? "•" : "◦")
                .font(bodyFont)
                .foregroundStyle(Theme.teal)
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.weight(.bold)
        case 2: .title3.weight(.semibold)
        default: .headline
        }
    }
}

/// Inline Markdown as an attributed string; the text as it is when it does not parse.
func markdownInline(_ text: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
    var result = (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    for run in result.runs where run.inlinePresentationIntent?.contains(.code) == true {
        result[run.range].font = .code(15)
        result[run.range].backgroundColor = Theme.panel3
    }
    for run in result.runs where run.link != nil {
        result[run.range].foregroundColor = Theme.teal
    }
    return result
}
