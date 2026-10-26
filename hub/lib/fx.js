// The Fractonica reading of a record's `time`, computed with the web app's own modules (src/core), so the hub prints a
// moment exactly as the web app and the iOS app (Notation.clockText, a port of pure.js) do.
import '../../fractonica.js';
import { createModel } from '../../src/core/model.js';
import { createPure } from '../../src/core/pure.js';

const model = createModel();
const pure = createPure(model);
const orNull = (s) => (s && s !== '—' ? s : null);

/**
 * `stamp`: the full letter address down to the Preon, "α#6 β#4 γ#9 δ#4 ε#1 43η 4ι" (pure.stamp);
 * `clock`: the minor clock, "43η 4ι 23λ" (pure.clockText, the app's default down to Flavons).
 * Both null outside the catalogue (1613 … 2857).
 */
export function fxOf(t) {
  if (!Number.isFinite(t)) return { stamp: null, clock: null };
  try {
    return { stamp: orNull(pure.stamp(t)), clock: orNull(pure.clockText(t)) };
  } catch {
    return { stamp: null, clock: null };
  }
}
