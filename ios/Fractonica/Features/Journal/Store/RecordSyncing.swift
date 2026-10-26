import Foundation

/// What the hub sync (`Features/Journal/Hub/`) needs from the journal's local store (`Features/Journal/Store/`). The
/// store is the single owner of records and blob files on disk; the sync engine only reads pending work and applies
/// what the hub sends through this surface.
///
/// Every record the device wrote or edited since it last reached the hub is **pending** until `markUploaded`.
/// A record from the hub never becomes pending. Blobs live as files named by their SHA-256.
@MainActor
protocol RecordSyncing: AnyObject {
    /// Records written or edited on this device and not yet accepted by the hub, oldest `updated` first.
    func pendingRecords() -> [HubRecord]

    /// The hub accepted `record` (as returned by the hub, with `source`, `rev`, `fx`): store it as the current version
    /// unless the device has edited it again since (`updated` of the local copy is newer), and clear pending.
    func markUploaded(_ record: HubRecord)

    /// A record from the change feed or a 409's `current`: last writer wins by `updated` (ties: keep the local copy if it
    /// is pending, else take the hub's). Tombstones (`deleted`) remove the record from the journal and its media from disk
    /// once nothing else names them.
    func applyRemote(_ record: HubRecord)

    /// The local file of a blob, if the device has it.
    func blobFile(_ hash: String) -> URL?

    /// Adopts a downloaded file as the blob `hash` (moves it into the store). The caller has verified the hash.
    func storeBlob(_ hash: String, from file: URL) throws

    /// The sync position: the last `rev` of the change feed applied, and of the vector feed. Persisted with the store.
    var changeCursor: Int { get set }
    var vectorCursor: Int { get set }
}
