/**
 * Time scales for the ephemeris. The series work in TT (Julian Ephemeris Days, JDE); the diary works in Unix seconds
 * (UTC). The conversion is the library's (fractonica.js): the leap-second table from 1972, NASA ΔT before, TAI−UTC held
 * after the table – the same civil model as the clock, so an event and a clock reading of the same instant agree.
 */

/** JD of the Unix epoch 1970-01-01T00:00:00 (on the TT scale the library counts TT seconds from the same origin). */
export const JD_UNIX_EPOCH = 2440587.5;
export const J2000 = 2451545;

function lib() {
  const F = globalThis.Fractonica;
  if (!F) throw new Error('fractonica.js must be loaded before the ephemeris (globalThis.Fractonica).');
  return F;
}

/** Unix seconds (UTC) → JDE (TT). */
export function jdeFromUnix(t) {
  const F = lib();
  return F.number(F.fromUTC(t)) / 86400 + JD_UNIX_EPOCH;
}

/** JDE (TT) → Unix seconds (UTC). */
export function unixFromJde(jde) {
  const F = lib();
  const tt = (jde - JD_UNIX_EPOCH) * 86400;
  return F.number(F.toUnix(F.rational(tt)));
}
