// The Fractonica reading of a record's `time`, computed with the web app's own modules (src/core), so the hub prints a
// moment exactly as the web app and the iOS app (Notation.clockText, a port of pure.js) do.
import '../../fractonica.js';
import { createModel } from '../../src/core/model.js';
import { createPure, PENTAD_NAMES, PENTAD_SHORT } from '../../src/core/pure.js';

const model = createModel();
const pure = createPure(model);
const orNull = (s) => (s && s !== '—' ? s : null);

/**
 * The version of what `fxOf` returns. A hub that opens a database written with an older version recomputes every
 * record's `fx` once (hub.js), so old records gain new fields too. 2: `pentad`.
 */
export const FX_VERSION = 2;

/** The Pentad running at t (SPEC §7.5): { index 0..3, name 'Pentad II', short '⬠II' | '◻', helion 1..5 }, or null. */
export function pentadOf(t) {
  const p = model.pentadAt(t);
  return p ? { index: p.index, name: PENTAD_NAMES[p.index], short: PENTAD_SHORT[p.index], helion: p.helion } : null;
}

/**
 * `stamp`: the full letter address down to the Preon, "α#6 β#4 γ#9 δ#4 ε#1 43η 4ι" (pure.stamp);
 * `clock`: the minor clock, "43η 4ι 23λ" (pure.clockText, the app's default down to Flavons);
 * `pentad`: the Pentad the moment falls in, which a date leads with like a weekday (SPEC §7.5, §15.3).
 * All null outside the catalogue (1613 … 2857).
 */
export function fxOf(t) {
  const none = { stamp: null, clock: null, pentad: null };
  if (!Number.isFinite(t)) return none;
  try {
    return { stamp: orNull(pure.stamp(t)), clock: orNull(pure.clockText(t)), pentad: pentadOf(t) };
  } catch {
    return none;
  }
}
