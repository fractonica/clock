import Synchronization

// The two lock-free hand-overs between the main thread and the audio thread. Both are single-producer,
// single-consumer rings over memory allocated once: pushing and popping never allocate, lock or wait.

/// A message to the audio thread. Every case carries plain values only (it is copied bit for bit through the ring).
enum SoundCommand: BitwiseCopyable, Sendable {
    /// Anchor the displayed time: `t0` is the displayed time at host time `host` (mach ticks; 0 = the start of the next
    /// buffer) and `rate` displayed seconds pass per real second. A new `epoch` drops the bells still waiting from the
    /// old one; `blend` glides every voice into its new phase over 40 ms (a jump), else the change is silent (drift).
    case anchor(t0: Double, rate: Double, host: UInt64, epoch: UInt32, blend: Bool)
    /// One drone voice.
    case voice(SoundVoiceConfig)
    /// Bus levels and layers.
    case mix(SoundMixConfig)
    /// A voice of the physical register: a band-limited triangle at `hz` (gain 0 fades it out).
    case physical(slot: Int32, hz: Double, gain: Float)
    /// One bell to start at its time.
    case bell(SoundBell)
    /// Ramp the output fader to `target` over `seconds`.
    case fader(target: Float, seconds: Float)
    /// Silence everything at once (behind a closed fader): bells, waiting bells, the reverb tail, the drone phases.
    case flush
    /// Output silence while computing everything else (screenshot sessions of the simulator).
    case silentOutput(Bool)
}

/// A drone voice: its pitch, loudness compensation, register and whether it sounds.
struct SoundVoiceConfig: BitwiseCopyable, Sendable {
    var level: Int32
    var hz: Double
    /// `SoundTuning.weight(for: hz)`, computed on the main thread.
    var weight: Float
    var on: Bool
    /// Leave out the 2nd harmonic (it would beat against another voice).
    var noHarmonic: Bool
    /// How much of the voice stays at its valley, 0 … 0.5.
    var floor: Float
    /// −1 … 1.
    var pan: Float
}

/// The bus levels.
struct SoundMixConfig: BitwiseCopyable, Sendable {
    /// Linear master gain.
    var volume: Float
    /// Reverb send, 0 … 1 (the slider).
    var reverb: Float
    var chord: Bool
    var chimes: Bool
}

/// A bell: a few sine partials with their own decays (`SoundRenderer.recipe(_:)`), panned.
struct SoundBell: BitwiseCopyable, Sendable {
    /// When it starts: displayed time `t` mapped through the current anchor, or, when `host` is not 0, that host time
    /// (mach ticks) — "Hear this moment" rings in real time, whatever the clock does.
    var t: Double
    var host: UInt64
    var hz: Float
    var amp: Float
    /// Seconds the main partial takes to fade to −80 dB.
    var decay: Float
    var pan: Float
    /// `SoundSchedule.Kind.rawValue`.
    var kind: UInt8
    var level: Int8
    /// The anchor epoch it was planned in (0: never dropped).
    var epoch: UInt32
    /// Rings on the moment bus (not switched by the Chimes layer).
    var moment: Bool
}

/// Main thread → audio thread.
final class SoundCommandRing: @unchecked Sendable {
    private let buffer: UnsafeMutablePointer<SoundCommand>
    private let mask: Int
    /// Next slot to read (owned by the consumer) and to write (owned by the producer); both only grow.
    private let head = Atomic<Int>(0)
    private let tail = Atomic<Int>(0)

    init(capacity: Int = 4096) {
        var size = 1
        while size < capacity { size <<= 1 }
        mask = size - 1
        buffer = .allocate(capacity: size)
        buffer.initialize(repeating: .flush, count: size)
    }

    deinit { buffer.deallocate() }

    /// Producer side. False when the ring is full (the command is dropped).
    @discardableResult
    func push(_ command: SoundCommand) -> Bool {
        let t = tail.load(ordering: .relaxed)
        let h = head.load(ordering: .acquiring)
        guard t - h <= mask else { return false }
        buffer[t & mask] = command
        tail.store(t + 1, ordering: .releasing)
        return true
    }

    /// Consumer side (the audio thread).
    func pop() -> SoundCommand? {
        let h = head.load(ordering: .relaxed)
        let t = tail.load(ordering: .acquiring)
        guard h != t else { return nil }
        let command = buffer[h & mask]
        head.store(h + 1, ordering: .releasing)
        return command
    }
}

/// Audio thread → screen: the last samples of the output, for the spectrum and the scope. The writer never waits; a
/// reader copies a window behind the write position (a window the writer laps while it is copied is simply redrawn
/// on the next frame).
final class SoundScopeRing: @unchecked Sendable {
    static let capacity = 16384
    private let samples: UnsafeMutablePointer<Float>
    /// Samples written so far.
    private let written = Atomic<Int>(0)

    init() {
        samples = .allocate(capacity: Self.capacity)
        samples.initialize(repeating: 0, count: Self.capacity)
    }

    deinit { samples.deallocate() }

    /// Audio thread.
    func write(_ source: UnsafePointer<Float>, count: Int) {
        let start = written.load(ordering: .relaxed)
        let mask = Self.capacity - 1
        for i in 0..<count { samples[(start + i) & mask] = source[i] }
        written.store(start + count, ordering: .releasing)
    }

    /// Copies the latest `count` samples (≤ capacity / 2) into `destination`; false before that many were written.
    func copyLatest(into destination: UnsafeMutablePointer<Float>, count: Int) -> Bool {
        let end = written.load(ordering: .acquiring)
        guard count <= Self.capacity / 2, end >= count else { return false }
        let mask = Self.capacity - 1
        let start = end - count
        for i in 0..<count { destination[i] = samples[(start + i) & mask] }
        return true
    }

    /// How many samples were written so far (to tell a silent, stopped output from a running one).
    var total: Int { written.load(ordering: .acquiring) }
}
