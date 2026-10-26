import Accelerate
import Foundation

/// The device's copy of the hub's vector feed (API.md § Search and vectors): one row per record part (`record`,
/// `blob:<hash>`), every row a `dim`-float L2-normalised vector, so a query embedded by the hub is ranked here, against
/// every record, in a millisecond or two.
///
/// On disk, in its folder: `vectors.f32` (the rows' floats back to back, native Float32) and `vectors.json` (model,
/// dim, feed cursor, the rows' record ids and parts). Both are rewritten whole by `save()`, the floats first, so a
/// crash in between leaves a table whose row count does not match the floats, which loads as empty (and the feed is
/// read again from 0). 10,000 records with two parts each at 256 dimensions is 20 MB.
actor VectorIndex {
    struct Row: Codable, Hashable, Sendable {
        var record: String
        var part: String
    }

    private struct Table: Codable {
        var model: String?
        var dim: Int
        var cursor: Int
        var rows: [Row]
    }

    let dim: Int
    private let directory: URL?
    private(set) var model: String?
    /// The last `vrev` applied: the next feed request's `after`.
    private(set) var cursor = 0
    private var rows: [Row] = []
    private var floats: [Float] = []
    private var rowOf: [Row: Int] = [:]
    private var dirty = false

    /// An index kept in `directory` (created when missing); nil keeps it in memory only.
    init(directory: URL?, dim: Int = 256) {
        self.directory = directory
        self.dim = dim
    }

    var count: Int { rows.count }
    var recordCount: Int { Set(rows.map(\.record)).count }

    private var tableURL: URL? { directory?.appendingPathComponent("vectors.json") }
    private var floatsURL: URL? { directory?.appendingPathComponent("vectors.f32") }

    /// Reads the index from disk; anything missing, damaged or of another dimension leaves it empty.
    func load() {
        guard let tableURL, let floatsURL,
              let tableData = try? Data(contentsOf: tableURL),
              let table = try? JSONDecoder().decode(Table.self, from: tableData), table.dim == dim,
              let data = try? Data(contentsOf: floatsURL, options: .mappedIfSafe),
              data.count == table.rows.count * dim * MemoryLayout<Float>.size else {
            clear(model: nil)
            dirty = false
            return
        }
        model = table.model
        cursor = table.cursor
        rows = table.rows
        floats = data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        rowOf = Dictionary(rows.enumerated().map { ($1, $0) }, uniquingKeysWith: { _, last in last })
        dirty = false
    }

    /// Forgets everything: the hub's model changed (its `vrev` restarted), or the device paired with another hub.
    func reset(model: String?) {
        clear(model: model)
        dirty = true
    }

    private func clear(model: String?) {
        self.model = model
        cursor = 0
        rows = []
        floats = []
        rowOf = [:]
    }

    /// Applies one page of the feed, in order: a forget entry (`part` and `vector` null) drops every row of its record,
    /// any other entry adds or replaces its record's part. Entries whose vector does not decode at `dim` are skipped.
    /// Returns false (and applies nothing) when the page is of another model or dimension: reset and read from 0.
    @discardableResult
    func apply(_ page: HubVectorsPage) -> Bool {
        guard page.dim == dim else { return false }
        if let model, !page.model.isEmpty, page.model != model { return false }
        if model == nil, !page.model.isEmpty { model = page.model }
        var forgotten = Set<String>()
        for entry in page.vectors {
            if entry.isForget {
                forgotten.insert(entry.record)
                continue
            }
            guard let part = entry.part, let base64 = entry.vector,
                  let vector = HubVectorCoding.decode(base64, dim: dim) else { continue }
            if forgotten.contains(entry.record) {
                // New vectors after a forget in the same page: drop the old rows now, so these survive.
                remove(records: [entry.record])
                forgotten.remove(entry.record)
            }
            upsert(Row(record: entry.record, part: part), normalized(vector))
        }
        if !forgotten.isEmpty { remove(records: forgotten) }
        cursor = max(cursor, page.cursor)
        dirty = true
        return true
    }

    private func upsert(_ row: Row, _ vector: [Float]) {
        if let index = rowOf[row] {
            floats.replaceSubrange(index * dim ..< (index + 1) * dim, with: vector)
        } else {
            rowOf[row] = rows.count
            rows.append(row)
            floats.append(contentsOf: vector)
        }
    }

    private func remove(records: Set<String>) {
        guard rows.contains(where: { records.contains($0.record) }) else { return }
        var keptRows: [Row] = []
        var keptFloats: [Float] = []
        keptRows.reserveCapacity(rows.count)
        keptFloats.reserveCapacity(floats.count)
        for (index, row) in rows.enumerated() where !records.contains(row.record) {
            keptRows.append(row)
            keptFloats.append(contentsOf: floats[index * dim ..< (index + 1) * dim])
        }
        rows = keptRows
        floats = keptFloats
        rowOf = Dictionary(rows.enumerated().map { ($1, $0) }, uniquingKeysWith: { _, last in last })
    }

    /// Writes the index if anything changed since it was loaded or saved.
    func save() throws {
        guard dirty, let directory, let tableURL, let floatsURL else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = floats.withUnsafeBufferPointer { Data(buffer: $0) }
        try data.write(to: floatsURL, options: .atomic)
        let table = Table(model: model, dim: dim, cursor: cursor, rows: rows)
        try JSONEncoder().encode(table).write(to: tableURL, options: .atomic)
        dirty = false
    }

    /// Deletes the files (unpairing from one hub before pairing with another).
    func erase() {
        clear(model: nil)
        dirty = false
        if let tableURL { try? FileManager.default.removeItem(at: tableURL) }
        if let floatsURL { try? FileManager.default.removeItem(at: floatsURL) }
    }

    /// Cosine similarity of `query` against every row, each record scored by its best part; the `limit` best records.
    func rank(_ query: [Float], limit: Int = 100) -> [String: Double] {
        guard query.count == dim, !rows.isEmpty else { return [:] }
        let q = normalized(query)
        var scores = [Float](repeating: 0, count: rows.count)
        floats.withUnsafeBufferPointer { matrix in
            q.withUnsafeBufferPointer { vector in
                scores.withUnsafeMutableBufferPointer { out in
                    // (rows × dim) · (dim × 1)
                    vDSP_mmul(matrix.baseAddress!, 1, vector.baseAddress!, 1, out.baseAddress!, 1,
                              vDSP_Length(rows.count), 1, vDSP_Length(dim))
                }
            }
        }
        var best: [String: Float] = [:]
        for (index, row) in rows.enumerated() {
            let score = scores[index]
            if let current = best[row.record], current >= score { continue }
            best[row.record] = score
        }
        let top = best.sorted { $0.value > $1.value }.prefix(max(limit, 0))
        return Dictionary(uniqueKeysWithValues: top.map { ($0.key, Double($0.value)) })
    }

    /// The parts held for a record (checks, diagnostics).
    func parts(of record: String) -> [String] {
        rows.filter { $0.record == record }.map(\.part)
    }

    private func normalized(_ v: [Float]) -> [Float] {
        var sum: Float = 0
        vDSP_svesq(v, 1, &sum, vDSP_Length(v.count))
        guard sum > 0, abs(sum - 1) > 1e-4 else { return v }
        var scale = 1 / sum.squareRoot()
        var out = [Float](repeating: 0, count: v.count)
        vDSP_vsmul(v, 1, &scale, &out, 1, vDSP_Length(v.count))
        return out
    }
}
