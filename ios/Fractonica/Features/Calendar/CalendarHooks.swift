/// The Calendar's lifecycle (listed in `AppHooks.all`): when the clock moves onto another Saros series, an address
/// typed in the converter names a cycle of the old series' catalogue, so it goes (the moment it pinned stays pinned).
/// The Month and the Diary keep one model per series (`ClockScoped`), so they need nothing here.
enum CalendarHooks: FeatureHooks {
    static func referenceChanged(from old: Int) {
        ConverterModel.shared.forgetAddress()
    }
}
