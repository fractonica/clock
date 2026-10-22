/// Lifecycle entry points of Sound (the audio engine and its session).
///
///     launch()             restores the preferences; never starts the audio (that takes a user action)
///     enteredBackground()  iOS: fades the sound out when "Play in the background" is off (and remembers to resume)
///     becameActive()       resumes a sound the background stopped
enum SoundHooks: FeatureHooks {
    static func launch() {
        SoundEngine.shared.applyLaunchOptions()
    }

    static func becameActive() {
        SoundEngine.shared.becameActive()
    }

    static func enteredBackground() {
        SoundEngine.shared.enteredBackground()
    }
}
