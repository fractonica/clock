import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Moment Settings › Calls: how calls ring — the system's alarms, or real calls pushed by a dispatch — and the dispatch:
/// whether one is paired with the hub, whether it is about, how its last call went, and the way to pair one (a code
/// and the command that takes it). Alert mode keeps the pairing: choosing calls again needs no new code.
struct DispatchSection: View {
    @State private var moments = MomentStore.shared
    @State private var dispatch = MomentDispatch.shared
    @State private var pairing = false

    var body: some View {
        @Bindable var moments = moments
        Section {
            Picker("Ring as", selection: $moments.settings.calls) {
                ForEach(MomentCallMode.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            // (a sheet on the Section itself does not present)
            .sheet(isPresented: $pairing) {
                DispatchPairSheet()
            }
            if moments.settings.calls == .dispatch {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    status(now: context.date.timeIntervalSince1970)
                }
            }
        } header: {
            Text("Calls")
        } footer: {
            Text(footer)
        }
    }

    @ViewBuilder
    private func status(now: Double) -> some View {
        if !dispatch.hasHub {
            Label("Calls go through your hub: pair the app with it first (Journal › Settings › Hub).", systemImage: "server.rack")
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
        } else if let d = dispatch.current {
            LabeledContent("Dispatch") {
                HStack(spacing: 6) {
                    Circle().fill(d.isOnline(at: now) ? Theme.teal : Theme.now).frame(width: 8, height: 8)
                    Text(d.isOnline(at: now) ? "\(d.name) · online" : "\(d.name) · seen \(ago(d.seen, now: now))")
                }
            }
            if !d.canPush {
                Label("\(d.apns): put your APNs auth key (AuthKey_….p8) in dispatch/ on that computer and start the dispatch again.",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(Theme.gold)
            }
            if let last = d.last {
                LabeledContent("Last call", value: last.ok ? "\(last.title ?? "rang") · \(ago(last.at, now: now))"
                                                         : "failed (\(last.reason ?? String(last.status))) · \(ago(last.at, now: now))")
            }
            if dispatch.pushToken == nil {
                Label("Waiting for this phone's push token…", systemImage: "hourglass")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
            } else if let next = dispatch.published?.calls.first(where: { $0.until > now }) {
                LabeledContent("Next call", value: AppSettings.shared.wording.relative(next.at, to: now))
            }
            Button("Pair Another Dispatch") { pairing = true }
                .font(.footnote)
        } else {
            Button {
                pairing = true
            } label: {
                Label("Pair a Dispatch", systemImage: "antenna.radiowaves.left.and.right")
            }
            Text("Until a dispatch is paired, alarms ring the calls.")
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
        }
    }

    private var footer: String {
        switch moments.settings.calls {
        case .alarms:
            "Alarms ring a call with the phone locked: Answer opens it picked up, Stop declines it."
        case .dispatch:
            "A dispatch (fractonica-dispatch, on a computer that reaches your hub) pushes each call at its first ring, and the phone rings it as a call — locked or not. Answer, then open Fractonica from the call to film; Decline declines it. Alarms again turns the calls off and keeps the dispatch paired."
        }
    }

    private func ago(_ t: Double, now: Double) -> String {
        let s = max(0, now - t)
        if s < 90 { return "just now" }
        if s < 5400 { return "\(Int((s / 60).rounded())) min ago" }
        if s < 2 * 86_400 { return "\(Int((s / 3600).rounded())) h ago" }
        return "\(Int((s / 86_400).rounded())) days ago"
    }
}

/// Pairing a dispatch: the hub makes a code for it (a service on `dispatch.*`, for half an hour); the sheet shows the
/// command that takes it, to run from the repository on the computer that will ring the calls, and closes itself when
/// the dispatch has paired and written its status.
struct DispatchPairSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var dispatch = MomentDispatch.shared
    @State private var code: MomentDispatch.PairingCode?
    @State private var problem: String?
    @State private var copied = false
    @State private var known: Set<String> = []

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let code {
                        Text(code.code)
                            .font(.code(34, weight: .bold))
                            .foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity)
                            .textSelection(.enabled)
                            .accessibilityLabel("Code \(code.code.map(String.init).joined(separator: " "))")
                        Text(code.command)
                            .font(.code(13))
                            .foregroundStyle(Theme.ink)
                            .textSelection(.enabled)
                        Button(copied ? "Copied" : "Copy the Command", systemImage: copied ? "checkmark" : "doc.on.doc") {
                            copy(code.command)
                        }
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let left = code.expires - context.date.timeIntervalSince1970
                            Text(left > 0 ? "The code lasts \(Int(left / 60)) min \(Int(left) % 60) s more." : "The code has expired.")
                                .font(.footnote)
                                .foregroundStyle(left > 0 ? Theme.ink3 : Theme.now)
                        }
                    } else if let problem {
                        Label(problem, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(Theme.gold)
                        Button("Try Again") { Task { await make() } }
                    } else {
                        HStack {
                            ProgressView()
                            Text("Asking the hub for a code…").foregroundStyle(Theme.ink2)
                        }
                    }
                } header: {
                    Text("Run this on the computer")
                } footer: {
                    Text("From the Fractonica folder, on a computer that reaches your hub and stays on (the one running the hub, say). Once, put your APNs auth key — AuthKey_XXXXXXXXXX.p8, from developer.apple.com › Keys, with Apple Push Notifications service — in its dispatch/ folder. The dispatch keeps its pairing: later it starts with node dispatch/bin/dispatch.mjs alone.")
                }
                if code != nil {
                    Section {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Waiting for the dispatch…").foregroundStyle(Theme.ink2)
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Pair a Dispatch")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("New Code", systemImage: "arrow.clockwise") { Task { await make() } }
                        .disabled(code == nil && problem == nil)
                }
            }
            .task {
                known = Set(dispatch.dispatches.map(\.id))
                await make()
            }
            // the dispatch paired: its status arrived from the hub
            .onChange(of: dispatch.dispatches.map(\.id)) { _, ids in
                if !Set(ids).subtracting(known).isEmpty {
                    ToastCenter.shared.show("Dispatch paired: moments ring as calls")
                    dismiss()
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func make() async {
        problem = nil
        code = nil
        copied = false
        do {
            code = try await dispatch.makeCode()
            // the hub syncs right away while the sheet waits (the dispatch's status comes back through it)
            Task { await JournalHooks.refresh?() }
        } catch HubError.api(let e) where e.code == .forbidden && e.message.contains("admin") {
            // a hub started before dispatch pairing: only an admin may make codes there
            problem = "Your hub is running an older version that can't make dispatch codes. Restart it (Ctrl-C where it runs, then hub/start.sh) and try again."
        } catch {
            problem = "The hub could not make a code: \(error.localizedDescription)"
        }
    }

    private func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
        copied = true
        Haptics.play(.selection)
    }
}
