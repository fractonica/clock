#!/usr/bin/env swift
// Makes the app's sounds from Half-Life 2's (its `sound` folder, as the game or a dump of it has them):
//
//     swift ios/scripts/import-sounds.swift ~/projects/AGI/hl2-master/sound      (from any directory)
//
//   ambient/alarms/*.wav       the Alarms ringtones of Moments' calls (`MomentRingtone`): Resources/Moments/ring-<name>.caf,
//                              the sound repeated whole while it fits in 28 s (a notification's or an alarm's sound must
//                              stay under 30 s), so the file loops as the sound does; one longer than that cut to 28 s,
//                              its end crossfaded into its start
//   common/bugreporter_succeeded.wav, items/battery_pickup.wav
//                              the mark at the moment in a moment's reel (`MomentReelRenderer`): a rare moment's and an
//                              epic one's or rarer, Resources/Moments/mark-<rarity>.caf, from their first sound, at the
//                              reel's 48 kHz
//   common/wpn_*.wav           the interface's sounds (`InterfaceSound`): Resources/Sounds/ui-<event>.caf
//
// Each mixed to mono and normalised (the alarms to a peak of 0.9 as the synthesised ringtones, the marks to 0.9, the
// interface's to 0.5: system sounds have no volume of their own), IMA4 in a CAF (afconvert), a format notification
// sounds, AlarmKit and system sounds all take. The synthesised ringtones are ios/scripts/make-ringtones.swift's.
import AVFoundation
import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: swift import-sounds.swift <Half-Life 2 sound folder>\n".utf8))
    exit(2)
}
let source = URL(fileURLWithPath: (CommandLine.arguments[1] as NSString).expandingTildeInPath)
let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let resources = scriptURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fractonica/Resources")

/// The alarms: `MomentRingtone`'s case for each.
let alarms: [(file: String, name: String)] = [
    ("alarm1", "alarm"),
    ("alarm_citizen_loop1", "citizen"),
    ("apc_alarm_loop1", "apc"),
    ("apc_alarm_pass1", "apcPass"),
    ("citadel_alert_loop2", "citadel"),
    ("city_firebell_loop1", "firebell"),
    ("city_siren_loop2", "citySiren"),
    ("combine_bank_alarm_loop1", "bank"),
    ("combine_bank_alarm_loop4", "bankShort"),
    ("klaxon1", "klaxon"),
    ("manhack_alert_pass1", "manhack"),
    ("razortrain_horn1", "razorTrain"),
    ("scanner_alert_pass1", "scanner"),
    ("siren", "siren"),
    ("train_crossing_bell_loop1", "crossing"),
    ("train_horn2", "trainHorn"),
    ("train_horn_distant1", "distantHorn"),
    ("warningbell1", "warningBell"),
]

/// The marks at the moment: by rarity, rare and epic (or rarer).
let marks: [(file: String, name: String)] = [
    ("common/bugreporter_succeeded", "rare"),
    ("items/battery_pickup", "epic"),
]

/// The interface's sounds: `InterfaceSound`'s case for each.
let buttons: [(file: String, name: String)] = [
    ("common/wpn_select", "open"),
    ("common/wpn_hudoff", "back"),
    ("common/wpn_moveselect", "tab"),
]

/// The longest a ringtone may last.
let longest = 28.0

/// A WAV's samples, its channels mixed, and its rate.
func read(_ url: URL) throws -> (samples: [Float], rate: Double) {
    let file = try AVAudioFile(forReading: url)
    let format = file.processingFormat
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)) else {
        fatalError("no buffer for \(url.lastPathComponent)")
    }
    try file.read(into: buffer)
    let channels = Int(format.channelCount), n = Int(buffer.frameLength)
    var mono = [Float](repeating: 0, count: n)
    for c in 0..<channels {
        let p = buffer.floatChannelData![c]
        for i in 0..<n { mono[i] += p[i] / Float(channels) }
    }
    return (mono, format.sampleRate)
}

func normalised(_ samples: [Float], peak: Float) -> [Float] {
    let top = samples.map(abs).max() ?? 1
    return samples.map { $0 * peak / max(top, 1e-9) }
}

/// The sound repeated whole while it fits in `longest`; longer, cut to it, the last half second crossfaded into the
/// sound's own end (which runs on into its start), so the cut loops.
func ringtone(_ sound: [Float], rate: Double) -> [Float] {
    let limit = Int(longest * rate)
    if sound.count <= limit { return Array([[Float]](repeating: sound, count: limit / sound.count).joined()) }
    let fade = Int(0.5 * rate)
    var out = Array(sound[0..<limit])
    for k in 0..<fade {
        let w = Float(k) / Float(fade)
        out[limit - fade + k] = (1 - w) * sound[limit - fade + k] + w * sound[sound.count - fade + k]
    }
    return out
}

/// From the first sample above a fortieth of the peak.
func trimmedStart(_ samples: [Float]) -> [Float] {
    let top = samples.map(abs).max() ?? 0
    let first = samples.firstIndex { abs($0) > top / 40 } ?? 0
    return Array(samples[first...])
}

/// The samples as a 16-bit mono WAV.
func wav(_ samples: [Float], rate: Double) -> Data {
    var data = Data()
    func append<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    let bytes = samples.count * 2
    data.append(contentsOf: Array("RIFF".utf8))
    append(UInt32(36 + bytes))
    data.append(contentsOf: Array("WAVEfmt ".utf8))
    append(UInt32(16))
    append(UInt16(1))
    append(UInt16(1))
    append(UInt32(rate))
    append(UInt32(rate * 2))
    append(UInt16(2))
    append(UInt16(16))
    data.append(contentsOf: Array("data".utf8))
    append(UInt32(bytes))
    for s in samples { append(Int16(max(-1, min(1, s)) * Float(Int16.max))) }
    return data
}

let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("sounds-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: tmp) }

/// Writes `samples` as IMA4 in a CAF at `target`, at `rate` (afconvert resamples when it differs).
func write(_ samples: [Float], rate: Double, to target: URL, at outRate: Double? = nil) throws {
    try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
    let raw = tmp.appendingPathComponent(target.deletingPathExtension().lastPathComponent + ".wav")
    try wav(samples, rate: rate).write(to: raw)
    try? FileManager.default.removeItem(at: target)
    let convert = Process()
    convert.executableURL = URL(fileURLWithPath: "/usr/bin/afconvert")
    let format = outRate.map { "ima4@\(Int($0))" } ?? "ima4"
    convert.arguments = ["-f", "caff", "-d", format, "-c", "1", "-r", "127", raw.path, target.path]
    try convert.run()
    convert.waitUntilExit()
    guard convert.terminationStatus == 0 else { fatalError("afconvert failed for \(target.lastPathComponent)") }
    let file = try AVAudioFile(forReading: target)
    let size = (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    let seconds = Double(file.length) / file.fileFormat.sampleRate
    print("\(target.lastPathComponent)  \(String(format: "%.2f", seconds)) s  \(Int(file.fileFormat.sampleRate)) Hz  \(size / 1024) KB")
}

for (file, name) in alarms {
    let (sound, rate) = try read(source.appendingPathComponent("ambient/alarms/\(file).wav"))
    try write(normalised(ringtone(sound, rate: rate), peak: 0.9), rate: rate,
              to: resources.appendingPathComponent("Moments/ring-\(name).caf"))
}
for (file, name) in marks {
    let (sound, rate) = try read(source.appendingPathComponent("\(file).wav"))
    try write(normalised(trimmedStart(sound), peak: 0.9), rate: rate,
              to: resources.appendingPathComponent("Moments/mark-\(name).caf"), at: 48_000)
}
for (file, name) in buttons {
    let (sound, rate) = try read(source.appendingPathComponent("\(file).wav"))
    try write(normalised(sound, peak: 0.5), rate: rate, to: resources.appendingPathComponent("Sounds/ui-\(name).caf"))
}
