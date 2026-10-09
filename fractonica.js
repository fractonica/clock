/**
 * Fractonica 2.0.0 — exact recursive time, balanced glyphs, and circular geometry.
 * Specification: FRACTONICA_CLOCK_SPEC.md.
 *
 * Single file. No dependencies, DOM requirement, fetches, fonts or external data.
 * Modern browser/Node with BigInt. Canvas is needed only when calling compose().
 *
 * NOMINAL SCALES: F.length(12,'air') returns metres; lengthExact returns a
 * rational. F.microPeriod(depth), macroPeriod(depth), period(depth,{branch}),
 * frequency(depth,{branch}), step(depth,{branch}); all depths are 0..1023.
 * F.createScale({basePeriod,sequence,macroMode:'cumulative'|'multiply',cutoff})
 * configures these methods. Depth 0 = reciprocal of atlas #1 (439.3883434 pHz).
 * Cumulative macro depths 1+ are S,2S,4S,..., where S sums the base and inward
 * terms through the first Planck cutoff. Multiply mode uses the original word.
 * F.medium(id), F.media, F.convertLength(value,from,to), convertLengthExact.
 * These nominal scales are independent of the catalogue clock (F.create).
 *
 * Browser: <script src="fractonica.js"></script>  // globalThis.Fractonica
 * Node: require('./fractonica.cjs')              // CommonJS: rename to .cjs
 * ESM: import './fractonica.js'; const F = globalThis.Fractonica;
 *
 * const F = Fractonica;
 * const clock = F.create({ timeScale: 'unix' }); // Saros 141, Unix seconds
 * const now = Date.now() / 1000;               // device time, no conversion
 * // Exact TT alternative: F.create() with F.fromUTC(new Date()).
 * const position = clock.positionAt(now);       // exact ordinal rational
 * const alpha = clock.periodAtTime(now, 0);    // harmonic level 0
 * const beta = clock.children(alpha);          // {items,total,offset,next}
 * console.log(alpha.events.map(e => e.time && F.formatTimestamp(e.time)));
 * console.log(clock.glyphsSVG(position, {levels:5,style:{strokeTip:'sharp'}}));
 * clock.phaseDigits(position, 6).digits;       // major/sub glyph states
 * clock.solarSync().at(now).drift;             // sync drift against civil days
 * clock.compose(canvas.getContext('2d'), {position, levels:5});
 *
 * CIRCULAR CALENDAR EXPORT (same artwork and conventions as the app)
 * const calendar = F.createCycleCalendar(clock); // optional capacities, date options
 * const cycle = calendar.cycle([5n, 2n]);       // Alpha 6 / Beta 3 (local indices)
 * const svg = calendar.svg(cycle.address);      // self-contained print-color SVG
 * const address = calendar.at(position);       // five-level calendar address
 * console.log(cycle.direction, cycle.events);  // exact times and phase labels
 * console.log(F.formatCalendarDate(cycle.startTime)); // local date + HH:mm
 * - Levels: Alpha, Beta, Gamma, Delta, Epsilon (F.cycleNames).
 * - Alpha spans four Saros; calendar children use the PARENT harmonic factor:
 *   defaults yield 5 Beta, 13 Gamma, 5 Delta, 5 Epsilon cycles.
 * - Glyphs and spin come directly from the gauge phase at the same timestamp.
 *   Every full cycle begins at zero with the family orientation. Ascending: Ascent/Peak/Descent/Valley/Ascent;
 *   descending: Descent/Valley/Ascent/Peak/Descent (F.calendarPhaseNames).
 * - Calendar dates omit seconds, zone suffix and approximation marker; exact
 *   times and civil conversion metadata stay available in the data.
 * - calendar.svg(address,{print=true,selectedChild,offset=0n,mode='circle'})
 *   returns a string. mode='geometry' draws the actual clock.arc() curves.
 * - calendar.glyphsAt(position,levels=5,print=false) mirrors the main gauge.
 *   calendar.group(cycle,print=false,position=cycle.start) uses that timestamp.
 *   calendar.view(cycle,selectedChild,offset=0n,print=false) supplies render data.
 *   F.calendarCircleSVG(view,print=false), F.circularCalendarPrintHTML(views,title)
 *   are also available. A shared seam has one label; closing time remains in data.
 * - Calendar enumeration is paged (96 labels); children(parent,offset=0n,limit=96)
 *   returns {total,nominal,items,offset}; step(address,+1/-1) stops at parent edges.
 *
 * TIME AND INDEX CONTRACT
 * - Default factors: [5,13,5,5,7,11,9,4], repeating. Ordinal zero is the first
 *   eclipse. An ordinal unit is one Saros recurrence; skipped recurrences are
 *   inferred from the catalogue unless explicit ordinals are supplied.
 * - Prefix P(level) = product of factors BEFORE that level; P(0)=1.
 *   A full cycle is 4/P Saros units; half = 2/P; quarter = 1/P.
 *   Harmonic level 0 contains 5 level-1 cycles, each containing 13 level-2
 *   cycles. The calendar mirrors this same harmonic hierarchy.
 * - A phase glyph has d strokes (trits; default 2), extreme M = (3^d - 1)/2
 *   and 4M cyclic states (16, 52, 160, ...). Index = floor(position * P(level)
 *   * M) mod 4M; descending families add 2M. States run 0..M, M-1..-(M-1)
 *   with a derivative dot (the falling branch), -M, then -(M-1)..-1: each
 *   repeated value reads bare rising and dotted falling; extrema are bare.
 *   Two strokes: 0 1 2 3 4 3. 2. 1. 0. -1. -2. -3. -4 -3 -2 -1 (. = dot).
 *   The geometric harmonic factor is independent of this display alphabet.
 *   One glyph cycle is the pair of half-cycle arcs of its level.
 * - Odometer: phaseDigits gives k glyph states; digit 0 is phaseAt's index,
 *   and each further digit runs one full cycle inside one state of its left
 *   neighbour.
 * - Phase glyphs quantize continuous position into 4M bins; exact rational
 *   position remains available independently of the displayed glyph.
 * - Arithmetic uses reduced BigInt rationals {numerator,denominator}.
 *   Integer Number inputs must be safe; use exact decimal/fraction strings
 *   beyond JS precision. Decimal Number inputs retain their JS decimal value.
 *   Timestamps are SECONDS, not JS milliseconds. Epoch: 1970-01-01 on the
 *   clock's time scale. timeScale 'unix': catalogue and query times are Unix
 *   seconds (UTC, 86400 s days); the default catalogue is the precomputed
 *   F.defaults.unixTimestamps (leap-second table 1972-2027, NASA Delta-T
 *   before 1972, TAI-UTC held at 37 s after the table), so clients need no
 *   TT or leap-second logic. timeScale 'TT' (default): NASA TT/TD catalogue
 *   and TT query times. 'UTC': UTC catalogue input converted to TT.
 * - Interpolation is piecewise linear between actual eclipse timestamps.
 *   Intervals are half-open; final catalogue time belongs to the last period.
 *   Final partial periods are clipped. Out-of-catalogue events have time:null;
 *   no extrapolated timestamp is silently invented.
 *
 * API (all level parameters zero-based, 0..1023; indices BigInt/string/integer)
 * F.create({sequence?,timestamps?,ordinals?,ascending=true,timeScale='TT'|'UTC'|'unix'})
 *   Changing family may require ascending:false. clock.timeScale is 'TT' or 'unix'.
 * clock.factorAt(level), prefix(level), count(level,unit='cycle')
 * clock.timestampAt(position), positionAt(timestamp) // exact inverses
 * clock.period(level,index,unit='cycle'|'half'|'quarter')
 *   -> {level,index,unit,prefix,factor,start,end,nominalEnd,startTime,endTime,
 *       duration,clipped,events:[{name,position,time,outside}]}
 *   Cycle events: begin, firstPeak, middleNode, oppositePeak, end. First peak
 *   is negative for descending families. Half/quarter event labels are generic
 *   quarter positions, not claims that their midpoints are a full-cycle peak.
 * clock.periodAt(position,level,unit?), periodAtTime(timestamp,level,unit?)
 * clock.children(cycle,{offset=0n,limit=100}) -> paginated next-level cycles
 * clock.periods(level,{from=0n,limit=100,unit='cycle'}) -> bounded lazy iterator
 * clock.tree(cycle,{levels=5,limit=10000}) -> lazy {period,depth} preorder
 * clock.phaseAt(position,level,{strokes=2}) -> {value,trits,derivative,index,
 *   states,factor,depth,level}
 * clock.phaseDigits(position,level,{strokes=2,digits=2}) -> {states,digits,
 *   step,next,nextTime}; digits are phase indices, coarsest first
 * clock.counterAt(position,level) -> {local,siblings,cycle}
 * clock.nextThreshold(position,level) -> {name,position,time}
 *   name: 'peak'|'node'|'valley'|'end' (ascending families peak first)
 * clock.solarSync({anchor=20,level=6,cycles=19,days=4,daySeconds=86400})
 *   Sync periods of `cycles` level cycles from the cycle starting at ordinal
 *   `anchor`, against `days` whole days. Defaults: Saros 141, 1973-12-24,
 *   19 depth-7 cycles ~ 4 days.
 *   .at(t) -> {sync,start,end,startTime,endTime,nominalStart,drift,phase,
 *   quarter,threshold:{name,time}}; drift accumulates since the anchor.
 *   .digits(t,{strokes=2,digits=3}) -> odometer indices of the sync phase.
 *   t is in the clock's time scale.
 * clock.glyphSVG(position,level,CBTStyle?,{strokes=2}) -> standalone SVG
 * clock.glyphsSVG(position,{fromLevel=0,levels=5,style={},strokes=2}) -> MSB-left SVG group
 * F.CBT -> the complete embedded CBT library, including procedural styles,
 *   scalar/vector decimal conversions, sharp tips and printable glyph atlases.
 *   CBT style pixelAlign:true snaps the SVG frame so the glyph origin falls on
 *   a pixel centre at an integer scale; with thickness*scale odd (0.3 * 10),
 *   straight strokes cover whole pixels when rasterised 1:1.
 *
 * GEOMETRY (number coordinates; exact time stays independent of drawing precision)
 * clock.arc(level,halfArcIndex,{root='wave'|'ring',relativeTo?})
 *   -> {center:{x,y},radius,start,sweep,level,index}; angles in radians.
 *   relativeTo:{level,index} rebases an ancestor circle to center (0,0), radius1;
 *   use this for deep zooms, where adding tiny offsets to world coordinates
 *   would lose floating-point precision. Tangent joins retain global parity.
 * clock.compose(ctx,{position=0,focus?,levels=5,root='wave',width?,height?,scale?,
 *   offsetX?,offsetY?,minRadius=2,maxArcs=4000,lineWidth=1.4,color?,gaugeColor?,
 *   background='#0d1b14',clear=true}) -> {arcs,markers,culled,capped,transform}
 *   focus:{level,index} selects/rebases a half-arc. Renders visible arcs with
 *   screen-size culling and a work cap; makes no animation loop or event handlers.
 *   Caller owns canvas backing size/DPR. ctx state is saved/restored. The caller
 *   can animate by invoking compose with advancing exact positions.
 *
 * F.rational(value,denominator?), compare(a,b), number(rational)
 * F.fromUTC(ISO-with-zone|Date|UTC-seconds) -> TT rational
 * F.toCivil(TT,{timeScale='TT'|'unix'}) -> {time,approximate,basis,leapSecond}
 * F.formatTimestamp(t,{timeZone?,locale='en-GB',timeScale='TT'}) -> local date, whole seconds
 * F.fromUnix(Date|ISO|seconds) -> Unix rational; F.toUnix(TT) -> Unix rational
 *   Civil conversion embeds the app's leap history/Delta-T projection. Dates
 *   before 1972 and beyond the published table are marked approximate. Exact
 *   catalogue arithmetic is unaffected. ISO/Date input has millisecond precision;
 *   use rational UTC seconds for finer input, and retain TT for all arithmetic.
 * F.periodName(level) -> {level,depth,letter,suffix,text}: level 0 = α, after ω
 *   the letters repeat with a numeric suffix (α1, β1, ...)
 * F.correctJulianTimestamp(seconds) -> re-reads a catalogue timestamp whose
 *   pre-1582-10-15 Julian calendar fields were stored as if Gregorian
 * F.stringify(value,space=2) -> JSON, BigInts as decimal strings
 * F.defaults -> immutable sequence, solar-141 timestamps (TT) and unixTimestamps,
 *   timeScale, family, kind
 */

(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Fractonica=api;})(globalThis,function(){'use strict';
const CBT=(()=>{const module={exports:{}};/**
 * CBT — Cyclic Balanced Ternary
 * A standalone, dependency-free JavaScript library. No DOM, imports or assets.
 * Requires BigInt (modern browsers / Node). All integer results use BigInt.
 *
 * LOAD
 *   Browser: <script src="cbt.js"></script>     // globalThis.CBT
 *   Node CJS: const CBT = require('./cbt.js');  // use .cjs in a type:module package
 *   Node ESM: import './cbt.js'; const { CBT } = globalThis;
 *
 * QUICK START
 *   const cbt = CBT.create({ depth: 2, mode: 'vector' });
 *   cbt.fromIndex(3).toSVG();              // value +3, rising (no dot)
 *   cbt.fromGray('0010').toSVG();           // binary Gray 0010 -> index 3
 *   cbt.fromTrit(3, +1).toSVG();            // same phase
 *   cbt.fromTrit(3, -1).toSVG();            // index 5, falling (dot)
 *   CBT.fromScalar(-4, { depth: 2 }).toSVG();
 *   const word = CBT.fromDecimal('12345678901234567890', {
 *     depth: 3, mode: 'scalar'
 *   });
 *   word.toSVG({ thickness: .34, stemHeight: 3, strokeWidth: 2,
 *     curvature: 1, zeroStrokeWidth: 2, strokeTip: 'round', gap: 2 });
 *   CBT.toDecimal(word);                   // 12345678901234567890n
 *   CBT.svg(-42, { depth: 2, mode: 'scalar', color: '#172b23' });
 *
 * MATHEMATICS
 *   depth d: M = (3^d - 1)/2. Trit arrays are MSB first and contain -1,0,+1.
 *   Scalar: -M..M inclusive, 3^d distinct values; no derivative or spin dot.
 *   Vector: P=4M distinct cyclic indices, 0..P-1. At depth 2:
 *     0,1,2,3,4,3,2,1,0,-1,-2,-3,-4,-3,-2,-1 (then wraps to 0).
 *   Interior values have two states, derivative +1/-1. The two extrema have
 *   one state each, derivative 0. fromTrit canonicalizes either sign at a pole
 *   to 0; derivative 0 at an interior value is rejected. No dwell tick exists.
 *   The dot denotes derivative -1 (the falling branch); a turning point is
 *   undotted.
 *
 *   fromIndex(i): one VECTOR glyph, wraps by Euclidean modulo unless wrap:false.
 *   fromGray(g): one VECTOR glyph, binary-reflected Gray decode, then fromIndex.
 *     Numbers/BigInts are packed Gray bits. Strings are BINARY, optionally 0b.
 *     Out-of-cycle decoded indices are rejected unless wrap:true is explicit.
 *     Gray encodes the INDEX, not the signed trits. The wrap is one-bit Gray
 *     only for power-of-two cycle lengths (depth 2:16; depth 3:52 is not one).
 *   fromTrit(value, derivative): one VECTOR glyph, not an individual value trit.
 *   fromScalar(value): one SCALAR glyph; out-of-range values are rejected.
 *
 * MULTI-GLYPH DECIMAL CONVERSION (integer input only)
 *   fromDecimal / decimalToCBT auto-allocate enough glyphs, MSB left, LSB right.
 *   scalar: balanced positional words in radix 3^d; negative signs live in trits.
 *     depth2: 5 -> [1,-4]; -5 -> [-1,4]; 41 -> [1,-4,-4].
 *   vector: positional phase-index words in radix P=4M, with an EXPLICIT sign.
 *     depth2: 16 -> [index1,index0]; 255 -> [index15,index15]. Negative values
 *     use the same magnitude words and a leading minus sign in SVG.
 *   These are independent phase words, not the quarter-carry Saros cascade.
 *   width: minimum word count; zero pads on the MSB side, never truncates.
 *   toDecimal reverses either representation exactly. No fractional rounding.
 *   Input accepts safe integer Number, BigInt, or base-10 integer String.
 *   Use BigInt/strings beyond Number.MAX_SAFE_INTEGER. Fractional numbers reject.
 *
 * API
 *   create({depth=2,mode='vector',width=0,wrap?}) -> configured methods
 *   fromScalar(v, options), fromIndex(i, options), fromGray(g, options),
 *   fromTrit(v,der,options) -> immutable Glyph
 *   fromDecimal(v, options={mode:'scalar'}), decimalToCBT(v,options) -> Group
 *   toDecimal(Glyph|Group), toTrits(v,minDepth=0), fromTrits(msbFirstArray)
 *   toGray(nonnegativeIndex), grayToIndex(grayBits), capacity(depth), period(depth)
 *   geometry(glyph,style), toSVG(glyphOrGroup,style), svg(decimal,optionsAndStyle)
 *   Glyph/Group also have .toSVG(style) and .toJSON() (BigInts become strings).
 *   Glyph: {kind,mode,depth,value,trits,derivative,index,gray}.
 *   Group: {kind,mode,depth,radix,sign,glyphs,decimal}.
 *
 * PROCEDURAL SVG STYLE (all lengths are design units)
 *   thickness .3        ink thickness, independent of horizontal reach
 *   stemHeight 3        length of EACH trit's vertical stem segment
 *   strokeWidth 2       horizontal reach of each one-sided signed curve
 *   curvature 1         curve bow height; 0 flattens it
 *   zeroStrokeWidth 2   total zero-stroke width
 *   strokeTip 'round'   'round' | 'butt' | 'square' | 'sharp'
 *   tipSharpness .65    0..1, short point to long taper (sharp only)
 *   tipProfile 'smooth' 'smooth' curved edges or 'angular' straight taper
 *   Sharp tips taper the free signed-stroke end and both zero-stroke ends.
 *   Stems keep round caps. geometry().fills contains their closed ink outlines.
 *   gap 2               gap between fixed glyph bounding cells
 *   scale 18            output pixels per design unit (viewBox stays geometric)
 *   padding .5          padding around the composition
 *   dotRadius .3        derivative dot radius
 *   showSpin true       show vector dots; band is always reserved
 *   pixelAlign false    true: snap the frame so (0,0) is a pixel centre at an
 *                       integer scale (use thickness*scale odd, e.g. 0.3*10)
 *   color '#e6eddf'     hex, plain color name, rgb(a), hsl(a), or currentColor
 *   tritOrder 'lsb-top' 'lsb-top' (Fractonica) or 'msb-top'; arrays stay MSB first
 *
 *   Every trit adds one stem and one stroke. -1 is only an upward left curve;
 *   +1 is only a downward right curve; zero is a centered horizontal stroke.
 *   Glyph bounds depend only on depth/style, never value, spin or neighbors.
 *   Groups are baseline-aligned. No external CSS, font or raster asset is used.
 *   Integer depth is 1..1024. Conversion width is at most 16384 glyphs.
 *   Rendering options are validated and strings escaped; no raw SVG injection.
 *
 * PRINTABLE ATLAS
 *   CBT.atlas({depth:3, mode:'scalar', layout:'grid', rows:5, columns:6,
 *     page:0n, labels:true, guides:true, style:{strokeTip:'sharp'}})
 *   -> {svg,total,pages,page,capacity,count,start,end,placements,depth,mode,layout}
 *   total/pages/page/start/end are BigInts; end is exclusive, page is ZERO-based.
 *   Scalar ordinal k encodes k-M. Vector ordinal k is the cyclic phase index.
 *   Nothing wraps or truncates; page outside 0..pages-1 throws.
 *   Grid: rows/columns 1..32; cells are square, final empty cells stay reserved.
 *   Circle/wave: pageSize 1..1024 (default 27). Circle omits duplicate endpoint;
 *     wave includes both ends of two tangent, opposite-curvature semicircles.
 *   Curves space glyph centers by equal arc distance. Glyph tops follow the
 *     continuous right normal; flipNormal:true reverses it. On a wave this
 *     avoids the 180-degree flip of the curvature-center normal at the join.
 *   labels/guides default true; both booleans. style is the regular SVG style.
 *   glyphSize 18 (2..100) fits the longest glyph dimension in atlas units.
 *   Sharp SVG strokes reuse local <defs>/<use> outlines to keep atlases small.
 *   Labels stay upright. Each placement has ordinal,x,y,angle (degrees),scale.
 *   Preview/render only one page; a page is limited to 32768 trits / 1024 glyphs.
 *   SVG is transparent and printable; set style.color:'#111' for black ink.
 *   create({...}).atlas(options) also applies the configured mode and depth.

 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CBT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_GLYPHS = 16384;
  const mod = (a, b) => ((a % b) + b) % b;
  function integer(value, name = 'value') {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value))
        throw new RangeError(
          `${name} must be a safe whole number; use BigInt or a decimal string for larger integers.`,
        );
      return BigInt(value);
    }
    if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim()))
      return BigInt(value.trim());
    throw new TypeError(
      `${name} must be a whole number, BigInt, or decimal integer string.`,
    );
  }
  function depthOf(depth = 2) {
    if (!Number.isInteger(depth) || depth < 1 || depth > 1024)
      throw new RangeError('depth must be an integer from 1 to 1024.');
    return depth;
  }
  const capacity = (depth = 2) => (3n ** BigInt(depthOf(depth)) - 1n) / 2n;
  const period = (depth = 2) => 4n * capacity(depth);
  function toTrits(value, minDepth = 0) {
    let n = integer(value);
    if (
      !Number.isInteger(minDepth) ||
      minDepth < 0 ||
      minDepth > 1024 * MAX_GLYPHS
    )
      throw new RangeError('Invalid trit width.');
    const result = [];
    do {
      const d = mod(n + 1n, 3n) - 1n;
      result.push(Number(d));
      n = (n - d) / 3n;
    } while (n !== 0n);
    while (result.length < minDepth) result.push(0);
    return result.reverse();
  }
  function fromTrits(trits) {
    if (
      !Array.isArray(trits) ||
      !trits.length ||
      Array.from(trits).some((d) => d !== -1 && d !== 0 && d !== 1)
    )
      throw new TypeError(
        'Use a nonempty MSB-first array of balanced trits (-1, 0, +1).',
      );
    return trits.reduce((n, d) => n * 3n + BigInt(d), 0n);
  }
  function toGray(value) {
    const n = integer(value, 'index');
    if (n < 0n) throw new RangeError('Gray indices must be nonnegative.');
    return n ^ (n >> 1n);
  }
  function grayToIndex(value) {
    const gray =
      typeof value === 'string'
        ? /^(?:0b)?[01]+$/i.test(value.trim())
          ? BigInt('0b' + value.trim().replace(/^0b/i, ''))
          : null
        : integer(value, 'Gray bits');
    if (gray === null || gray < 0n)
      throw new RangeError(
        'Gray strings must contain binary digits, optionally prefixed by 0b.',
      );
    let result = 0n;
    for (let n = gray; n; n >>= 1n) result ^= n;
    return result;
  }
  function serializable(value) {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(serializable);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, serializable(v)]),
      );
    return value;
  }
  function finish(value) {
    Object.defineProperties(value, {
      toSVG: { value: (options) => toSVG(value, options) },
      toJSON: { value: () => serializable(value) },
    });
    return Object.freeze(value);
  }
  function glyph(mode, depth, value, derivative = null, index = null) {
    return finish({
      kind: 'glyph',
      mode,
      depth,
      value,
      trits: Object.freeze(toTrits(value, depth)),
      derivative,
      index,
      gray: index === null ? null : toGray(index),
    });
  }
  function fromScalar(value, options = {}) {
    const d = depthOf(options.depth),
      m = capacity(d),
      x = integer(value);
    if (x < -m || x > m)
      throw new RangeError(
        `One depth-${d} scalar glyph holds -${m}..${m}; use fromDecimal for multiple glyphs.`,
      );
    return glyph('scalar', d, x);
  }
  function fromIndex(value, options = {}) {
    const d = depthOf(options.depth),
      m = capacity(d),
      p = 4n * m,
      input = integer(value, 'index');
    if (options.wrap === false && (input < 0n || input >= p))
      throw new RangeError(`Index must be in 0..${p - 1n}.`);
    const k = mod(input, p);
    const x = k <= m ? k : k <= 3n * m ? 2n * m - k : k - 4n * m;
    const derivative =
      k === m || k === 3n * m ? 0 : k < m || k > 3n * m ? 1 : -1;
    return glyph('vector', d, x, derivative, k);
  }
  function fromGray(value, options = {}) {
    return fromIndex(grayToIndex(value), {
      ...options,
      wrap: options.wrap ?? false,
    });
  }
  function fromTrit(value, derivative, options = {}) {
    const d = depthOf(options.depth),
      m = capacity(d),
      x = integer(value);
    if (x < -m || x > m) throw new RangeError(`Value must be in -${m}..${m}.`);
    if (derivative !== -1 && derivative !== 0 && derivative !== 1)
      throw new TypeError('Derivative must be -1, 0, or +1.');
    if (x === m || x === -m)
      return fromIndex(x === m ? m : 3n * m, { depth: d });
    if (derivative === 0)
      throw new RangeError('Derivative 0 is valid only at a turning point.');
    return fromIndex(derivative < 0 ? 2n * m - x : x >= 0n ? x : 4n * m + x, {
      depth: d,
    });
  }
  function fromDecimal(value, options = {}) {
    const decimal = integer(value),
      depth = depthOf(options.depth),
      mode = options.mode ?? 'scalar';
    if (mode !== 'scalar' && mode !== 'vector')
      throw new TypeError('mode must be scalar or vector.');
    const width = options.width ?? 0;
    if (!Number.isInteger(width) || width < 0 || width > MAX_GLYPHS)
      throw new RangeError(`width must be 0..${MAX_GLYPHS}.`);
    const m = capacity(depth),
      radix = mode === 'scalar' ? 2n * m + 1n : 4n * m;
    let n = mode === 'vector' && decimal < 0n ? -decimal : decimal;
    const glyphs = [];
    do {
      if (glyphs.length >= MAX_GLYPHS)
        throw new RangeError(
          `This value needs more than ${MAX_GLYPHS} glyphs.`,
        );
      const digit = mode === 'scalar' ? mod(n + m, radix) - m : n % radix;
      glyphs.push(
        mode === 'scalar'
          ? fromScalar(digit, { depth })
          : fromIndex(digit, { depth }),
      );
      n = (n - digit) / radix;
    } while (n !== 0n);
    while (glyphs.length < width)
      glyphs.push(
        mode === 'scalar' ? fromScalar(0, { depth }) : fromIndex(0, { depth }),
      );
    return finish({
      kind: 'cbt',
      mode,
      depth,
      radix,
      sign: decimal < 0n ? -1 : decimal > 0n ? 1 : 0,
      glyphs: Object.freeze(glyphs.reverse()),
      decimal,
    });
  }
  function validateGlyph(input) {
    if (!input || input.kind !== 'glyph')
      throw new TypeError('Expected a CBT glyph.');
    const value = fromTrits(input.trits);
    if (
      input.trits.length !== depthOf(input.depth) ||
      integer(input.value) !== value
    )
      throw new TypeError('Inconsistent glyph value or trit depth.');
    if (input.mode === 'scalar') return fromScalar(value, input);
    if (input.mode !== 'vector') throw new TypeError('Unknown glyph mode.');
    const check = fromTrit(value, input.derivative, input);
    if (
      check.derivative !== input.derivative ||
      integer(input.index) !== check.index
    )
      throw new TypeError('Inconsistent phase index or derivative.');
    return check;
  }
  function toDecimal(input) {
    if (input?.kind === 'glyph') {
      const g = validateGlyph(input);
      return g.mode === 'scalar' ? g.value : g.index;
    }
    if (
      !input ||
      input.kind !== 'cbt' ||
      !Array.isArray(input.glyphs) ||
      !input.glyphs.length ||
      Array.from(input.glyphs).some((g) => !g)
    )
      throw new TypeError('Expected a CBT glyph or group.');
    const depth = depthOf(input.depth),
      mode = input.mode;
    if (mode !== 'scalar' && mode !== 'vector')
      throw new TypeError('Unknown group mode.');
    const radix = mode === 'scalar' ? 2n * capacity(depth) + 1n : period(depth);
    const n = input.glyphs.reduce((sum, g) => {
      if (g.depth !== depth || g.mode !== mode)
        throw new TypeError('Every word must have the group depth and mode.');
      return sum * radix + toDecimal(g);
    }, 0n);
    if (mode === 'scalar') return n;
    if (![-1, 0, 1].includes(input.sign) || (n === 0n) !== (input.sign === 0))
      throw new TypeError('Invalid vector sign.');
    return input.sign < 0 ? -n : n;
  }
  const DEFAULT_STYLE = Object.freeze({
    thickness: 0.3,
    stemHeight: 3,
    strokeWidth: 2,
    curvature: 1,
    zeroStrokeWidth: 2,
    strokeTip: 'round',
    tipSharpness: 0.65,
    tipProfile: 'smooth',
    gap: 2,
    scale: 18,
    padding: 0.5,
    dotRadius: 0.3,
    showSpin: true,
    pixelAlign: false,
    color: '#e6eddf',
    tritOrder: 'lsb-top',
  });
  function styleOf(options = {}) {
    const s = {
      ...DEFAULT_STYLE,
      ...options,
      zeroStrokeWidth:
        options.zeroStrokeWidth ??
        DEFAULT_STYLE.zeroStrokeWidth,
    };
    for (const name of [
      'thickness',
      'stemHeight',
      'strokeWidth',
      'zeroStrokeWidth',
      'scale',
      'dotRadius',
    ]) {
      if (!Number.isFinite(s[name]) || s[name] <= 0 || s[name] > 1000)
        throw new RangeError(
          `${name} must be greater than 0 and at most 1000.`,
        );
    }
    for (const name of ['curvature', 'gap', 'padding'])
      if (!Number.isFinite(s[name]) || s[name] < 0 || s[name] > 1000)
        throw new RangeError(`${name} must be 0..1000.`);
    if (!['round', 'butt', 'square', 'sharp'].includes(s.strokeTip))
      throw new TypeError('strokeTip must be round, butt, square, or sharp.');
    if (
      !Number.isFinite(s.tipSharpness) ||
      s.tipSharpness < 0 ||
      s.tipSharpness > 1
    )
      throw new RangeError('tipSharpness must be 0..1.');
    if (!['smooth', 'angular'].includes(s.tipProfile))
      throw new TypeError('tipProfile must be smooth or angular.');
    if (!['lsb-top', 'msb-top'].includes(s.tritOrder))
      throw new TypeError('tritOrder must be lsb-top or msb-top.');
    if (
      typeof s.color !== 'string' ||
      !/^(?:#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})|[a-z]+|(?:rgb|hsl)a?\([\d.,%+\-\s/]+\))$/i.test(
        s.color,
      )
    )
      throw new TypeError('Use a plain CSS color (no URLs or markup).');
    if (typeof s.showSpin !== 'boolean')
      throw new TypeError('showSpin must be a boolean.');
    if (typeof s.pixelAlign !== 'boolean')
      throw new TypeError('pixelAlign must be a boolean.');
    if (s.pixelAlign && !Number.isInteger(s.scale))
      throw new RangeError('pixelAlign needs an integer scale.');
    return s;
  }
  // Vector glyphs carry a dot on the falling branch; extrema never do.
  const spinDotted = (g, s) =>
    g.mode === 'vector' && s.showSpin && g.derivative === -1;
  const f = (n) => String(Number(n.toPrecision(12)));
  const escape = (v) =>
    String(v).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&apos;',
        })[c],
    );
  function glyphBounds(depth, s) {
    const half = s.thickness / 2,
      reach = Math.max(s.strokeWidth, s.zeroStrokeWidth / 2);
    const dotY = -s.curvature - half - 2 * s.dotRadius;
    return {
      minX: -Math.max(reach + half, s.dotRadius),
      maxX: Math.max(reach + half, s.dotRadius),
      minY: dotY - s.dotRadius - half,
      maxY:
        Math.max(
          depth * s.stemHeight,
          (depth - 1) * s.stemHeight + s.curvature,
        ) + half,
      dotY,
    };
  }
  // Variable-width ribbon. Quadratic interpolation stays within the sampled
  // convex hull, so the same bounds enclose curved, sharp and ordinary tips.
  function sharpOutline(digit, y, s) {
    const points = [],
      half = s.thickness / 2;
    const cubic = (a, b, c, d, t) =>
      (1 - t) ** 3 * a +
      3 * (1 - t) ** 2 * t * b +
      3 * (1 - t) * t * t * c +
      t ** 3 * d;
    const samples = 64;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      if (!digit) points.push({ x: (t - 0.5) * s.zeroStrokeWidth, y });
      else {
        const x = digit * s.strokeWidth,
          bend = y + digit * s.curvature;
        points.push(
          t <= 0.5
            ? {
                x: cubic(0, 0, 0, x / 2, t * 2),
                y: cubic(y, y, bend, bend, t * 2),
              }
            : {
                x: cubic(x / 2, x, x, x, (t - 0.5) * 2),
                y: cubic(bend, bend, y, y, (t - 0.5) * 2),
              },
        );
      }
    }
    const distances = [0];
    for (let i = 1; i < points.length; i++)
      distances.push(
        distances[i - 1] +
          Math.hypot(
            points[i].x - points[i - 1].x,
            points[i].y - points[i - 1].y,
          ),
      );
    const length = distances.at(-1),
      taper = (0.08 + 0.72 * s.tipSharpness) * (digit ? length : length / 2);
    if (!(length > 0 && taper > 0 && Number.isFinite(length)))
      throw new RangeError(
        'Sharp stroke geometry is outside the floating-point drawing range.',
      );
    const left = [],
      right = [];
    points.forEach((p, i) => {
      const a = points[Math.max(0, i - 1)],
        b = points[Math.min(samples, i + 1)];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        norm = Math.hypot(dx, dy) || 1;
      let fraction = Math.min(
        1,
        (length - distances[i]) / taper,
        digit ? 1 : distances[i] / taper,
      );
      if (s.tipProfile === 'smooth')
        fraction = fraction * fraction * (3 - 2 * fraction);
      const radius = half * fraction;
      left.push({
        x: p.x - (dy / norm) * radius,
        y: p.y + (dx / norm) * radius,
      });
      right.push({
        x: p.x + (dy / norm) * radius,
        y: p.y - (dx / norm) * radius,
      });
    });
    const outline = [...left, ...right.reverse()];
    if (s.tipProfile === 'angular')
      return (
        outline.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join(' ') +
        ' Z'
      );
    // Preserve the exact pointed endpoint; smooth each side independently.
    const smoothSide = (points, move) => {
      let path = `${move ? 'M' : 'L'}${f(points[0].x)} ${f(points[0].y)}`;
      for (let i = 1; i < points.length - 1; i++) {
        const p = points[i],
          next = points[i + 1];
        path += ` Q${f(p.x)} ${f(p.y)} ${f((p.x + next.x) / 2)} ${f((p.y + next.y) / 2)}`;
      }
      const end = points.at(-1);
      return path + ` L${f(end.x)} ${f(end.y)}`;
    };
    return smoothSide(left, true) + ' ' + smoothSide(right, false) + ' Z';
  }
  function geometry(input, options = {}) {
    const g = validateGlyph(input),
      s = styleOf(options),
      stems = [],
      strokes = [],
      fills = [];
    const digits = s.tritOrder === 'lsb-top' ? [...g.trits].reverse() : g.trits;
    digits.forEach((digit, i) => {
      const y = i * s.stemHeight;
      stems.push(`M0 ${f(y)} L0 ${f(y + s.stemHeight)}`);
      if (s.strokeTip === 'sharp') fills.push(sharpOutline(digit, y, s));
      if (digit === 0)
        strokes.push(
          `M${f(-s.zeroStrokeWidth / 2)} ${f(y)} L${f(s.zeroStrokeWidth / 2)} ${f(y)}`,
        );
      else {
        const x = digit * s.strokeWidth,
          bend = y + digit * s.curvature;
        strokes.push(
          `M0 ${f(y)} C0 ${f(y)} 0 ${f(bend)} ${f(x / 2)} ${f(bend)} C${f(x)} ${f(bend)} ${f(x)} ${f(y)} ${f(x)} ${f(y)}`,
        );
      }
    });
    const bounds = glyphBounds(g.depth, s);
    return {
      stems,
      strokes,
      fills,
      path: [...stems, ...strokes].join(' '),
      bounds,
      dot: spinDotted(g, s)
        ? { x: 0, y: bounds.dotY, radius: s.dotRadius }
        : null,
      style: s,
    };
  }
  function glyphInk(geo) {
    const s = geo.style;
    const paths =
      s.strokeTip === 'sharp'
        ? `<path d="${geo.stems.join(' ')}"/>` +
          geo.fills
            .map(
              (d) => `<path d="${d}" fill="${escape(s.color)}" stroke="none"/>`,
            )
            .join('')
        : `<path d="${geo.path}"/>`;
    const dot = geo.dot
      ? `<circle cx="0" cy="${f(geo.dot.y)}" r="${f(geo.dot.radius)}" fill="${escape(s.color)}" stroke="none"/>`
      : '';
    return paths + dot;
  }
  let svgSerial = 0;
  function sharpResources(s) {
    if (s.strokeTip !== 'sharp') return { markup: '', prefix: null };
    // Each SVG owns reusable stroke outlines. Include the style fingerprint so
    // saved inline SVGs cannot accidentally resolve a different style's defs.
    let hash = 2166136261;
    for (const ch of JSON.stringify([
      s.thickness,
      s.strokeWidth,
      s.zeroStrokeWidth,
      s.curvature,
      s.tipSharpness,
      s.tipProfile,
      s.color,
    ]))
      hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    const prefix = `cbt-sharp-${(hash >>> 0).toString(36)}-${++svgSerial}`;
    const markup =
      '<defs>' +
      [-1, 0, 1]
        .map(
          (d) =>
            `<path id="${prefix}-${d + 1}" d="${sharpOutline(d, 0, s)}" fill="${escape(s.color)}" stroke="none"/>`,
        )
        .join('') +
      '</defs>';
    return { markup, prefix };
  }
  function sharpInk(g, s, prefix) {
    const digits = s.tritOrder === 'lsb-top' ? [...g.trits].reverse() : g.trits;
    const strokes = digits
      .map(
        (d, i) =>
          `<use href="#${prefix}-${d + 1}" transform="translate(0 ${f(i * s.stemHeight)})"/>`,
      )
      .join('');
    const b = glyphBounds(g.depth, s),
      dot = spinDotted(g, s)
        ? `<circle cx="0" cy="${f(b.dotY)}" r="${f(s.dotRadius)}" fill="${escape(s.color)}" stroke="none"/>`
        : '';
    return `<path d="M0 0 V${f(g.depth * s.stemHeight)}"/>${strokes}${dot}`;
  }
  function inkAttributes(s) {
    return `fill="none" stroke="${escape(s.color)}" stroke-width="${f(s.thickness)}" stroke-linecap="${s.strokeTip === 'sharp' ? 'round' : s.strokeTip}" stroke-linejoin="round"`;
  }
  function toSVG(input, options = {}) {
    const isGroup = input?.kind === 'cbt';
    if (isGroup) toDecimal(input);
    else validateGlyph(input);
    const glyphs = isGroup ? input.glyphs : [input];
    if (glyphs.length > MAX_GLYPHS)
      throw new RangeError('Too many glyphs to render.');
    const s = styleOf(options),
      depth = Math.max(...glyphs.map((g) => g.depth)),
      b = glyphBounds(depth, s);
    const cell = b.maxX - b.minX,
      sign = isGroup && input.mode === 'vector' && input.sign < 0;
    const prefix = sign ? cell + s.gap : 0,
      width =
        prefix +
        cell * glyphs.length +
        s.gap * (glyphs.length - 1) +
        2 * s.padding;
    const height = b.maxY - b.minY + 2 * s.padding;
    if (
      !(width > 0 && height > 0 && width * s.scale > 0 && height * s.scale > 0)
    )
      throw new RangeError(
        'SVG dimensions are below the floating-point drawing range.',
      );
    const label = isGroup
      ? `${input.mode} CBT ${toDecimal(input)}; most significant glyph first`
      : `${input.mode} CBT value ${input.value}${input.mode === 'vector' ? `, index ${input.index}, derivative ${input.derivative}` : ''}`;
    const sharp = sharpResources(s);
    const body = glyphs
      .map((g, i) => {
        const geo = s.strokeTip === 'sharp' ? null : geometry(g, s),
          x = prefix + i * (cell + s.gap),
          y = (depth - g.depth) * s.stemHeight;
        return `<g data-glyph="${i}" data-value="${g.value}" data-derivative="${g.derivative ?? ''}" transform="translate(${f(x)} ${f(y)})">${sharp.prefix ? sharpInk(g, s, sharp.prefix) : glyphInk(geo)}</g>`;
      })
      .join('');
    const minus = sign
      ? `<path aria-label="negative" d="M${f(b.minX + s.thickness / 2)} ${f((depth * s.stemHeight) / 2)} h${f(cell - s.thickness)}"/>`
      : '';
    let x0 = b.minX - s.padding,
      y0 = b.minY - s.padding,
      w = width,
      h = height;
    if (s.pixelAlign) {
      // Put the origin on a pixel centre and round the frame out to whole
      // pixels; glyph cells stay where they are in design units.
      const snap = (start, extent) => {
        const before = Math.ceil(-start * s.scale - 0.5) + 0.5,
          after = Math.ceil((start + extent) * s.scale - 0.5) + 0.5;
        return [-before / s.scale, (before + after) / s.scale];
      };
      [x0, w] = snap(x0, width);
      [y0, h] = snap(y0, height);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w * s.scale)}" height="${f(h * s.scale)}" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" role="img" aria-label="${escape(label)}"><title>${escape(label)}</title>${sharp.markup}<g ${inkAttributes(s)}>${minus}${body}</g></svg>`;
  }
  function atlas(options = {}) {
    const depth = depthOf(options.depth),
      mode = options.mode ?? 'scalar',
      layout = options.layout ?? 'grid';
    if (!['scalar', 'vector'].includes(mode))
      throw new TypeError('Atlas mode must be scalar or vector.');
    if (!['grid', 'circle', 'wave'].includes(layout))
      throw new TypeError('Atlas layout must be grid, circle, or wave.');
    const bounded = (value, name, max) => {
      if (!Number.isInteger(value) || value < 1 || value > max)
        throw new RangeError(`${name} must be an integer from 1 to ${max}.`);
      return value;
    };
    const rows = layout === 'grid' ? bounded(options.rows ?? 5, 'rows', 32) : 1,
      columns =
        layout === 'grid' ? bounded(options.columns ?? 6, 'columns', 32) : 1;
    const capacity =
      layout === 'grid'
        ? rows * columns
        : bounded(options.pageSize ?? 27, 'pageSize', 1024);
    if (capacity * depth > 32768)
      throw new RangeError(
        'A page can contain at most 32768 trits. Reduce rows, columns, or glyphs per page.',
      );
    const labels = options.labels ?? true,
      guides = options.guides ?? true,
      flip = options.flipNormal ?? false;
    for (const flag of [labels, guides, flip])
      if (typeof flag !== 'boolean')
        throw new TypeError(
          'Atlas labels, guides and flipNormal must be booleans.',
        );
    const glyphSize = options.glyphSize ?? 18;
    if (!Number.isFinite(glyphSize) || glyphSize < 2 || glyphSize > 100)
      throw new RangeError('glyphSize must be 2..100.');
    const total = mode === 'scalar' ? 3n ** BigInt(depth) : period(depth),
      pages = (total + BigInt(capacity) - 1n) / BigInt(capacity);
    const page = integer(options.page ?? 0, 'page');
    if (page < 0n || page >= pages)
      throw new RangeError(`page must be between 0 and ${pages - 1n}.`);
    const start = page * BigInt(capacity),
      count = Number(
        total - start < BigInt(capacity) ? total - start : BigInt(capacity),
      ),
      end = start + BigInt(count);
    const s = styleOf(options.style),
      b = glyphBounds(depth, s),
      width = b.maxX - b.minX,
      height = b.maxY - b.minY;
    const glyphScale = glyphSize / Math.max(width, height),
      cx = (b.minX + b.maxX) / 2,
      cy = (b.minY + b.maxY) / 2;
    if (!Number.isFinite(glyphScale) || glyphScale <= 0)
      throw new RangeError(
        'Atlas geometry is outside the floating-point drawing range.',
      );
    const diagonal = Math.hypot(width, height) * glyphScale,
      labelHeight = labels ? 5 : 0;
    const gap = Math.max(1, s.gap * glyphScale),
      margin = 3,
      font = 1.7;
    const placements = [],
      body = [],
      labelBody = [],
      guideBody = [],
      sharp = sharpResources(s);
    let atlasWidth,
      atlasHeight,
      cellSize = null;
    // Diagonal clearance encloses every rotated glyph and its upright label.
    const halo = diagonal / 2 + labelHeight + gap;
    const radius = Math.max(
      halo * 1.4,
      (2 * halo + gap) /
        (2 *
          Math.sin(
            Math.PI / Math.max(3, layout === 'wave' ? count - 1 : count),
          )),
    );
    if (layout === 'grid') {
      cellSize =
        Math.max(width * glyphScale, height * glyphScale + labelHeight) +
        2 * gap;
      atlasWidth = columns * cellSize + 2 * margin;
      atlasHeight = rows * cellSize + 2 * margin;
      if (guides) {
        for (let i = 0; i <= columns; i++)
          guideBody.push(
            `M${f(margin + i * cellSize)} ${f(margin)} v${f(rows * cellSize)}`,
          );
        for (let i = 0; i <= rows; i++)
          guideBody.push(
            `M${f(margin)} ${f(margin + i * cellSize)} h${f(columns * cellSize)}`,
          );
      }
    } else {
      atlasWidth = (layout === 'circle' ? 2 : 4) * radius + 2 * (halo + margin);
      atlasHeight = 2 * radius + 2 * (halo + margin);
      if (guides) {
        const x = halo + margin,
          y = radius + halo + margin;
        if (layout === 'circle')
          guideBody.push(
            `M${f(x)} ${f(y)} a${f(radius)} ${f(radius)} 0 1 0 ${f(2 * radius)} 0 a${f(radius)} ${f(radius)} 0 1 0 ${f(-2 * radius)} 0`,
          );
        else
          guideBody.push(
            `M${f(x)} ${f(y)} a${f(radius)} ${f(radius)} 0 0 1 ${f(2 * radius)} 0 a${f(radius)} ${f(radius)} 0 0 0 ${f(2 * radius)} 0`,
          );
      }
    }
    for (let i = 0; i < count; i++) {
      const ordinal = start + BigInt(i),
        g =
          mode === 'scalar'
            ? fromScalar(ordinal - (total - 1n) / 2n, { depth })
            : fromIndex(ordinal, { depth });
      let x,
        y,
        angle = 0;
      if (layout === 'grid') {
        x = margin + ((i % columns) + 0.5) * cellSize;
        y =
          margin + (Math.floor(i / columns) + 0.5) * cellSize - labelHeight / 2;
      } else if (layout === 'circle') {
        const theta = -Math.PI / 2 + (2 * Math.PI * i) / count;
        x = radius + halo + margin + radius * Math.cos(theta);
        y = radius + halo + margin + radius * Math.sin(theta);
        angle = theta + Math.PI / 2;
      } else {
        const q = count === 1 ? Math.PI : (2 * Math.PI * i) / (count - 1),
          v = q > Math.PI ? q - Math.PI : q;
        x =
          (q <= Math.PI ? radius : 3 * radius) -
          radius * Math.cos(v) +
          halo +
          margin;
        y =
          (q <= Math.PI ? -1 : 1) * radius * Math.sin(v) +
          radius +
          halo +
          margin;
        angle = q <= Math.PI ? q - Math.PI / 2 : Math.PI / 2 - v;
      }
      if (flip && layout !== 'grid') angle += Math.PI;
      angle *= 180 / Math.PI;
      placements.push(
        Object.freeze({ ordinal, x, y, angle, scale: glyphScale }),
      );
      const geo = s.strokeTip === 'sharp' ? null : geometry(g, s);
      body.push(
        `<g data-ordinal="${ordinal}" data-value="${g.value}" transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)}) scale(${f(glyphScale)}) translate(${f(-cx)} ${f(-cy)})">${sharp.prefix ? sharpInk(g, s, sharp.prefix) : glyphInk(geo)}</g>`,
      );
      if (labels) {
        const label =
          mode === 'scalar'
            ? String(g.value)
            : `${ordinal} / ${g.value}${g.derivative === 1 ? ' ↑' : g.derivative === -1 ? ' ↓' : ' •'}`;
        const labelY =
          y +
          (layout === 'grid' ? (height * glyphScale) / 2 : diagonal / 2) +
          2.6;
        // textLength keeps arbitrarily large exact labels inside their allotted slot.
        const maxTextWidth = layout === 'grid' ? cellSize - 2 * gap : 2 * halo;
        const squeeze =
          label.length * font * 0.62 > maxTextWidth
            ? ` textLength="${f(maxTextWidth)}" lengthAdjust="spacingAndGlyphs"`
            : '';
        labelBody.push(
          `<text x="${f(x)}" y="${f(labelY)}"${squeeze}>${escape(label)}</text>`,
        );
      }
    }
    if (
      ![
        atlasWidth,
        atlasHeight,
        atlasWidth * s.scale,
        atlasHeight * s.scale,
      ].every((n) => Number.isFinite(n) && n > 0)
    )
      throw new RangeError(
        'Atlas dimensions are outside the floating-point drawing range.',
      );
    const title = `${mode} CBT atlas, depth ${depth}, ${layout}, page ${page + 1n} of ${pages}`;
    const guide = guideBody.length
      ? `<path d="${guideBody.join(' ')}" fill="none" stroke="${escape(s.color)}" stroke-opacity=".2" stroke-width=".12"/>`
      : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(atlasWidth * s.scale)}" height="${f(atlasHeight * s.scale)}" viewBox="0 0 ${f(atlasWidth)} ${f(atlasHeight)}" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title>${sharp.markup}${guide}<g ${inkAttributes(s)}>${body.join('')}</g><g fill="${escape(s.color)}" font-family="monospace" font-size="${font}" text-anchor="middle">${labelBody.join('')}</g></svg>`;
    return Object.freeze({
      svg,
      depth,
      mode,
      layout,
      total,
      pages,
      page,
      capacity,
      count,
      start,
      end,
      placements: Object.freeze(placements),
      cellSize,
    });
  }
  function svg(value, options = {}) {
    return toSVG(value?.kind ? value : fromDecimal(value, options), options);
  }
  function create(options = {}) {
    depthOf(options.depth);
    const config = Object.freeze({ depth: 2, mode: 'vector', ...options });
    if (!['scalar', 'vector'].includes(config.mode))
      throw new TypeError('mode must be scalar or vector.');
    return Object.freeze({
      ...config,
      capacity: capacity(config.depth),
      period: period(config.depth),
      fromScalar: (v) => fromScalar(v, config),
      fromIndex: (i) => fromIndex(i, config),
      fromGray: (g) => fromGray(g, config),
      fromTrit: (v, der) => fromTrit(v, der, config),
      fromDecimal: (v, extra = {}) => fromDecimal(v, { ...config, ...extra }),
      decimalToCBT: (v, extra = {}) => fromDecimal(v, { ...config, ...extra }),
      toDecimal,
      atlas: (extra = {}) => atlas({ ...config, ...extra }),
      svg: (v, style = {}) => svg(v, { ...config, ...style }),
    });
  }
  return Object.freeze({
    version: '2.0.0',
    create,
    capacity,
    period,
    toTrits,
    fromTrits,
    toGray,
    grayToIndex,
    fromScalar,
    fromIndex,
    fromGray,
    fromTrit,
    fromDecimal,
    decimalToCBT: fromDecimal,
    toDecimal,
    geometry,
    atlas,
    toSVG,
    svg,
    defaults: DEFAULT_STYLE,
  });
});

return module.exports;})();
const civil=(()=>{const exports={};"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leapFileExpiry = exports.leapOffsets = void 0;
exports.floorRational = floorRational;
exports.nasaDeltaT = nasaDeltaT;
exports.civilFromTT = civilFromTT;
exports.leapOffsets = [
    ['1972-01-01', 10],
    ['1972-07-01', 11],
    ['1973-01-01', 12],
    ['1974-01-01', 13],
    ['1975-01-01', 14],
    ['1976-01-01', 15],
    ['1977-01-01', 16],
    ['1978-01-01', 17],
    ['1979-01-01', 18],
    ['1980-01-01', 19],
    ['1981-07-01', 20],
    ['1982-07-01', 21],
    ['1983-07-01', 22],
    ['1985-07-01', 23],
    ['1988-01-01', 24],
    ['1990-01-01', 25],
    ['1991-01-01', 26],
    ['1992-07-01', 27],
    ['1993-07-01', 28],
    ['1994-07-01', 29],
    ['1996-01-01', 30],
    ['1997-07-01', 31],
    ['1999-01-01', 32],
    ['2006-01-01', 33],
    ['2009-01-01', 34],
    ['2012-07-01', 35],
    ['2015-07-01', 36],
    ['2017-01-01', 37],
];
exports.leapFileExpiry = '2027-06-28T00:00:00Z';
const publishedThroughMs = BigInt(Date.parse(exports.leapFileExpiry));
const table = exports.leapOffsets.map(([day, taiMinusUtc]) => {
    const utcMs = BigInt(Date.parse(day + 'T00:00:00Z'));
    const offsetMs = BigInt(taiMinusUtc * 1000 + 32184);
    return { utcMs, offsetMs, ttMs: utcMs + offsetMs };
});
const atLeastMs = (t, ms) => t.numerator * 1000n >= ms * t.denominator;
const subtractMs = (t, ms) => ({
    numerator: t.numerator * 1000n - ms * t.denominator,
    denominator: t.denominator * 1000n,
});
/** Mathematical floor; BigInt division alone truncates negative dates to zero. */
function floorRational(t) {
    const q = t.numerator / t.denominator;
    return q - (t.numerator < 0n && t.numerator % t.denominator !== 0n ? 1n : 0n);
}
function horner(x, coefficients) {
    return coefficients.reduceRight((result, coefficient) => result * x + coefficient, 0);
}
/** NASA Espenak/Meeus Delta-T in seconds; y is the astronomical decimal year.
 * The optional Canon correction matches its lunar ephemeris. This approximation
 * should NOT replace the leap table for dates with known UTC. NASA's 2005-based
 * future estimates are not current measurements; the caller below uses them
 * only before 1972, never for modern/future UTC.
 */
function nasaDeltaT(y, canonCorrection = true) {
    let d;
    if (y < -500)
        d = -20 + 32 * ((y - 1820) / 100) ** 2;
    else if (y < 500)
        d = horner(y / 100, [
            10583.6, -1014.41, 33.78311, -5.952053, -0.1798452, 0.022174192,
            0.0090316521,
        ]);
    else if (y < 1600)
        d = horner((y - 1000) / 100, [
            1574.2, -556.01, 71.23472, 0.319781, -0.8503463, -0.005050998,
            0.0083572073,
        ]);
    else if (y < 1700)
        d = horner(y - 1600, [120, -0.9808, -0.01532, 1 / 7129]);
    else if (y < 1800)
        d = horner(y - 1700, [8.83, 0.1603, -0.0059285, 0.00013336, -1 / 1174000]);
    else if (y < 1860)
        d = horner(y - 1800, [
            13.72, -0.332447, 0.0068612, 0.0041116, -0.00037436, 0.0000121272,
            -0.0000001699, 0.000000000875,
        ]);
    else if (y < 1900)
        d = horner(y - 1860, [
            7.62,
            0.5737,
            -0.251754,
            0.01680668,
            -0.0004473624,
            1 / 233174,
        ]);
    else if (y < 1920)
        d = horner(y - 1900, [-2.79, 1.494119, -0.0598939, 0.0061966, -0.000197]);
    else if (y < 1941)
        d = horner(y - 1920, [21.2, 0.84493, -0.0761, 0.0020936]);
    else if (y < 1961)
        d = horner(y - 1950, [29.07, 0.407, -1 / 233, 1 / 2547]);
    else if (y < 1986)
        d = horner(y - 1975, [45.45, 1.067, -1 / 260, -1 / 718]);
    else if (y < 2005)
        d = horner(y - 2000, [63.86, 0.3345, -0.060374, 0.0017275, 0.000651814, 0.00002373599]);
    else if (y < 2050)
        d = horner(y - 2000, [62.92, 0.32217, 0.005589]);
    else if (y < 2150)
        d = -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
    else
        d = -20 + 32 * ((y - 1820) / 100) ** 2;
    return (d -
        (canonCorrection && (y < 1955 || y > 2005)
            ? 0.000012932 * (y - 1955) ** 2
            : 0));
}
/** Input must be normalized continuous TT, after Julian-calendar
 * normalization. Output has whole-second display support, but retains a rational
 * numerator/denominator so subsecond input cannot round into the next second. */
function civilFromTT(t) {
    if (t.denominator <= 0n)
        throw new Error('Expected a positive denominator.');
    if (!atLeastMs(t, table[0].ttMs)) {
        const date = new Date(Number(floorRational(t)) * 1000);
        // NASA's published convention: the midpoint of the containing month.
        const y = date.getUTCFullYear() + (date.getUTCMonth() + 0.5) / 12;
        return {
            time: subtractMs(t, BigInt(Math.round(nasaDeltaT(y) * 1000))),
            approximate: true,
            basis: 'UT1 estimate',
            leapSecond: false,
        };
    }
    let i = table.length - 1;
    while (i > 0 && !atLeastMs(t, table[i].ttMs))
        i--;
    const row = table[i], next = table[i + 1];
    // POSIX/Date cannot represent 23:59:60. Preserve its flag explicitly.
    const leapSecond = !!next &&
        next.offsetMs - row.offsetMs === 1000n &&
        atLeastMs(t, next.ttMs - 1000n);
    const time = subtractMs(t, row.offsetMs + (leapSecond ? 1000n : 0n));
    const approximate = atLeastMs(time, publishedThroughMs);
    return {
        time,
        approximate,
        basis: approximate ? 'UTC projection' : 'UTC',
        leapSecond,
    };
}

return exports;})();
const DEFAULT_SEQUENCE=[5,13,5,5,7,11,9,4];
const DEFAULT_ECLIPSES=[-11253795384,-10684827263,-10115859443,-9546891833,-8977924433,-8408957006,-7839989585,-7271021944,-6702054195,-6133086020,-5564117556,-4995148575,-4426179187,-3857209177,-3288238726,-2719267746,-2150296299,-1581324348,-1012352055,-443379455,125593364,694566337,1263539259,1832512139,2401484786,2970457223,3539429220,4108400891,4677372055,5246342779,5815312981,6384282795,6953252190,7522221186,8091189911,8660158392,9229126755,9798095001,10367063342,10936031778,11505000393,12073969295,12642938541,13211908225,13780878323,14349848986,14918820180,15487791957,16056764302,16625737223,17194710682,17763684566,18332658941,18901633621,19470608606,20039583666,20608558884,21177534004,21746509035,22315483795,22884458336,23453432492,24022406294,24591379667,25160352680,25729325224,26298297440,26867269261,27436240877,28005212105];
// The same instants as Unix seconds (UTC, POSIX days of 86400 s), precomputed
// with the embedded civil model: leap-second table 1972-2027, NASA Delta-T
// (UT1 estimate) before 1972, TAI-UTC held at 37 s after the table. Clients
// that read device Unix time need no TT or leap-second logic.
const DEFAULT_ECLIPSES_UNIX=["-11253795486.968","-10684827340.124","-10115859492.780","-9546891859.112","-8977924443.862","-8408957014.511","-7839989594.977","-7271021955.471","-6702054209.003","-6133086036.449","-5564117571.512","-4995148587.324","-4426179194.600","-3857209183.600","-3288238731.185","-2719267740.393","-2150296298.803","-1581324369.140","-1012352078.953","-443379486.426","125593319.816","694566278.816","1263539192.816","1832512069.816","2401484716.816","2970457153.816","3539429150.816","4108400821.816","4677371985.816","5246342709.816","5815312911.816","6384282725.816","6953252120.816","7522221116.816","8091189841.816","8660158322.816","9229126685.816","9798094931.816","10367063272.816","10936031708.816","11505000323.816","12073969225.816","12642938471.816","13211908155.816","13780878253.816","14349848916.816","14918820110.816","15487791887.816","16056764232.816","16625737153.816","17194710612.816","17763684496.816","18332658871.816","18901633551.816","19470608536.816","20039583596.816","20608558814.816","21177533934.816","21746508965.816","22315483725.816","22884458266.816","23453432422.816","24022406224.816","24591379597.816","25160352610.816","25729325154.816","26298297370.816","26867269191.816","27436240807.816","28005212035.816"];
function createFractonicaAPI(
  CBT,
  civil,
  DEFAULT_SEQUENCE,
  DEFAULT_ECLIPSES,
  DEFAULT_ECLIPSES_UNIX,
) {
  /** Core factory body. CBT, civil, DEFAULT_SEQUENCE and DEFAULT_ECLIPSES are
   * embedded by build-fractonica.mjs; the delivered file needs no dependencies. */
  const LIMIT = 1024;
  const integer = (v, name = 'index') => {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
    if (typeof v === 'string' && /^[+-]?\d+$/.test(v)) return BigInt(v);
    throw new TypeError(
      name + ' must be a safe integer, BigInt or integer string.',
    );
  };
  function rational(value, denominator) {
    let n, d;
    if (denominator !== undefined) {
      n = integer(value);
      d = integer(denominator);
    } else if (value && typeof value === 'object' && 'numerator' in value) {
      n = integer(value.numerator);
      d = integer(value.denominator);
    } else if (typeof value === 'bigint') {
      n = value;
      d = 1n;
    } else {
      if (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        !Number.isSafeInteger(value)
      )
        throw new RangeError('Use an exact string for unsafe integers.');
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new RangeError('Expected a finite value.');
      const s = String(value).trim(),
        ratio = s.match(/^([+-]?\d+)\/(\d+)$/);
      if (ratio) return rational(ratio[1], ratio[2]);
      const m = s.match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i);
      if (!m || s.length > 10000)
        throw new TypeError(
          'Expected a decimal, fraction string or rational object.',
        );
      const e = Number(m[3] || 0),
        places = (m[2].split('.')[1] || '').length;
      if (!Number.isInteger(e) || Math.abs(e) > 10000)
        throw new RangeError('Exponent exceeds 10000.');
      n = BigInt(m[2].replace('.', '')) * (m[1] === '-' ? -1n : 1n);
      d = 10n ** BigInt(places);
      if (e >= 0) n *= 10n ** BigInt(e);
      else d *= 10n ** BigInt(-e);
    }
    if (!d) throw new RangeError('Zero denominator.');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    let a = n < 0n ? -n : n,
      b = d;
    while (b) {
      const r = a % b;
      a = b;
      b = r;
    }
    return Object.freeze({
      numerator: n / (a || 1n),
      denominator: d / (a || 1n),
    });
  }
  const add = (a, b) =>
    rational(
      a.numerator * b.denominator + b.numerator * a.denominator,
      a.denominator * b.denominator,
    );
  const sub = (a, b) =>
    rational(
      a.numerator * b.denominator - b.numerator * a.denominator,
      a.denominator * b.denominator,
    );
  const mul = (a, b) =>
    rational(a.numerator * b.numerator, a.denominator * b.denominator);
  const div = (a, b) =>
    rational(a.numerator * b.denominator, a.denominator * b.numerator);
  const compare = (a, b) => {
    const n = a.numerator * b.denominator - b.numerator * a.denominator;
    return n < 0n ? -1 : n > 0n ? 1 : 0;
  };
  const floor = (a) =>
    a.numerator / a.denominator -
    (a.numerator < 0n && a.numerator % a.denominator !== 0n ? 1n : 0n);
  const ceil = (a) => -floor(rational(-a.numerator, a.denominator));
  const modulo = (n, d) => ((n % d) + d) % d;
  const number = (a) => {
    const n = (a.numerator < 0n ? -a.numerator : a.numerator).toString(),
      d = a.denominator.toString();
    const leading = (s) => Number(s.slice(0, 16)) / 10 ** (Math.min(16, s.length) - 1);
    const mantissa = (a.numerator < 0n ? -1 : 1) * leading(n) / leading(d);
    const exponent = n.length - d.length;
    // Parse the combined value so an intermediate power of ten cannot overflow
    // or underflow before a representable final result is formed.
    return Number(`${mantissa}e${exponent}`);
  };
  const positiveInt = (n, name, max = LIMIT) => {
    if (!Number.isSafeInteger(n) || n < 1 || n > max)
      throw new RangeError(`${name} must be 1–${max}.`);
    return n;
  };
  const levelOf = (n) => {
    if (!Number.isSafeInteger(n) || n < 0 || n >= LIMIT)
      throw new RangeError('Level must be 0–1023 (glyph = level + 1).');
    return n;
  };
  const escape = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  // Date, zoned ISO string or Unix seconds -> exact Unix seconds.
  function unixSeconds(value) {
    if (value instanceof Date) return rational(value.getTime(), 1000);
    if (typeof value === 'string' && /[T:]/.test(value)) {
      if (!/(Z|[+-]\d\d:\d\d)$/i.test(value))
        throw new TypeError('ISO dates must include a timezone.');
      const ms = Date.parse(value);
      if (!Number.isFinite(ms)) throw new TypeError('Invalid ISO date.');
      return rational(ms, 1000);
    }
    return rational(value);
  }
  function utcToTT(value) {
    const utc = unixSeconds(value);
    const ms = number(utc) * 1000;
    let offset = 0;
    for (const [day, tai] of civil.leapOffsets)
      if (ms >= Date.parse(day + 'T00:00:00Z')) offset = tai + 32.184;
    if (!offset) {
      const date = new Date(ms);
      offset = civil.nasaDeltaT(
        date.getUTCFullYear() + (date.getUTCMonth() + 0.5) / 12,
      );
    }
    return add(utc, rational(Math.round(offset * 1000), 1000));
  }
  // Civil time of a clock timestamp: TT goes through the leap-second /
  // Delta-T model; Unix seconds already are civil time.
  function civilOf(value, timeScale = 'TT') {
    if (timeScale === 'unix')
      return Object.freeze({ time: rational(value), approximate: false, basis: 'Unix', leapSecond: false });
    if (timeScale !== 'TT') throw new TypeError('timeScale must be TT or unix.');
    return civil.civilFromTT(rational(value));
  }
  function formatTimestamp(value, { timeZone, locale = 'en-GB', timeScale = 'TT' } = {}) {
    const t = civilOf(value, timeScale);
    const date = new Date(Number(floor(t.time)) * 1000);
    if (!Number.isFinite(date.getTime()))
      throw new RangeError(
        'Timestamp outside JavaScript Date display range; retain the exact rational.',
      );
    const fmt = new Intl.DateTimeFormat(locale, {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      era: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset',
    });
    const parts = fmt
      .formatToParts(date)
      .map((p) => (p.type === 'second' && t.leapSecond ? '60' : p.value))
      .join('');
    return (t.approximate ? '≈ ' : '') + parts;
  }
  const unitSpan = { cycle: 4n, half: 2n, quarter: 1n };
  function create(options = {}) {
    const sequence = [...(options.sequence ?? DEFAULT_SEQUENCE)];
    if (!sequence.length || sequence.length > 1024)
      throw new RangeError('Sequence needs 1–1024 entries.');
    sequence.forEach((n) => positiveInt(n, 'Harmonic factor', 193710244));
    if (sequence.every((n) => n === 1))
      throw new RangeError('At least one factor must exceed one.');
    // TT: catalogue and query times are TT seconds. UTC: UTC catalogue input
    // converted to TT. unix: catalogue and query times are Unix seconds with
    // no conversion at all (default catalogue: the precomputed Unix table).
    const timeScale = options.timeScale ?? 'TT';
    if (!['TT', 'UTC', 'unix'].includes(timeScale))
      throw new TypeError('timeScale must be TT, UTC or unix.');
    const clockScale = timeScale === 'unix' ? 'unix' : 'TT';
    const times = (
      options.timestamps ??
      (timeScale === 'unix' ? DEFAULT_ECLIPSES_UNIX : DEFAULT_ECLIPSES)
    ).map((v) => (timeScale === 'UTC' ? utcToTT(v) : rational(v)));
    if (times.length < 2)
      throw new RangeError('At least two eclipse timestamps are required.');
    for (let i = 1; i < times.length; i++)
      if (compare(times[i], times[i - 1]) <= 0)
        throw new RangeError('Eclipse timestamps must strictly increase.');
    const ordinals = options.ordinals
      ? options.ordinals.map((v) => integer(v, 'ordinal'))
      : [0n];
    if (!options.ordinals)
      for (let i = 1; i < times.length; i++)
        ordinals.push(
          ordinals[i - 1] +
            BigInt(
              Math.max(
                1,
                Math.round(
                  number(sub(times[i], times[i - 1])) / (6585.32 * 86400),
                ),
              ),
            ),
        );
    if (
      ordinals.length !== times.length ||
      ordinals[0] !== 0n ||
      ordinals.some((n, i) => i > 0 && n <= ordinals[i - 1])
    )
      throw new RangeError(
        'Ordinals must start at zero and strictly increase, one per timestamp.',
      );
    const extent = ordinals.at(-1),
      prefixes = [1n],
      ascending = options.ascending ?? true;
    if (typeof ascending !== 'boolean')
      throw new TypeError('ascending must be boolean.');
    const factorAt = (level) => sequence[levelOf(level) % sequence.length];
    function prefix(level) {
      levelOf(level);
      while (prefixes.length <= level)
        prefixes.push(
          prefixes.at(-1) *
            BigInt(sequence[(prefixes.length - 1) % sequence.length]),
        );
      return prefixes[level];
    }
    function position(value) {
      const p = rational(value);
      if (p.numerator < 0n || p.numerator > extent * p.denominator)
        throw new RangeError('Position outside the eclipse catalogue.');
      return p;
    }
    function timestampAt(value) {
      const p = position(value);
      let lo = 0,
        hi = ordinals.length - 1;
      while (lo + 1 < hi) {
        const m = (lo + hi) >> 1;
        if (BigInt(ordinals[m]) * p.denominator <= p.numerator) lo = m;
        else hi = m;
      }
      return add(
        times[lo],
        mul(
          sub(times[lo + 1], times[lo]),
          div(
            sub(p, rational(ordinals[lo])),
            rational(ordinals[lo + 1] - ordinals[lo]),
          ),
        ),
      );
    }
    function positionAt(value) {
      const t = rational(value);
      if (compare(t, times[0]) < 0 || compare(t, times.at(-1)) > 0)
        throw new RangeError('Timestamp outside the eclipse catalogue.');
      let lo = 0,
        hi = times.length - 1;
      while (lo + 1 < hi) {
        const m = (lo + hi) >> 1;
        if (compare(times[m], t) <= 0) lo = m;
        else hi = m;
      }
      return add(
        rational(ordinals[lo]),
        mul(
          rational(ordinals[lo + 1] - ordinals[lo]),
          div(sub(t, times[lo]), sub(times[lo + 1], times[lo])),
        ),
      );
    }
    const spanOf = (unit) => {
      if (!Object.hasOwn(unitSpan, unit))
        throw new TypeError('Unit must be cycle, half or quarter.');
      return unitSpan[unit];
    };
    const count = (level, unit = 'cycle') =>
      ceil(rational(extent * prefix(level), spanOf(unit)));
    function period(level, index, unit = 'cycle') {
      const p = prefix(level),
        i = integer(index),
        span = spanOf(unit);
      if (i < 0n || i >= count(level, unit))
        throw new RangeError('Period index outside this catalogue.');
      const start = rational(i * span, p),
        nominalEnd = rational((i + 1n) * span, p),
        end =
          compare(nominalEnd, rational(extent)) > 0
            ? rational(extent)
            : nominalEnd;
      const begin = timestampAt(start),
        finish = timestampAt(end);
      const names =
        unit === 'cycle'
          ? ['begin', 'firstPeak', 'middleNode', 'oppositePeak', 'end']
          : ['begin', 'quarter', 'middle', 'threeQuarter', 'end'];
      const events = names.map((name, k) => {
        const at = add(start, rational(span * BigInt(k), 4n * p));
        return Object.freeze({
          name,
          position: at,
          time: compare(at, end) <= 0 ? timestampAt(at) : null,
          outside: compare(at, end) > 0,
        });
      });
      return Object.freeze({
        level,
        index: i,
        unit,
        prefix: p,
        factor: factorAt(level),
        start,
        end,
        nominalEnd,
        startTime: begin,
        endTime: finish,
        duration: sub(finish, begin),
        clipped: compare(end, nominalEnd) < 0,
        events: Object.freeze(events),
      });
    }
    function periodAt(value, level, unit = 'cycle') {
      const p = position(value),
        span = spanOf(unit),
        product = p.numerator * prefix(level),
        closing = p.numerator === extent * p.denominator;
      const index = (product - (closing ? 1n : 0n)) / (span * p.denominator);
      return period(level, index, unit);
    }
    function children(parent, { offset = 0n, limit = 100 } = {}) {
      const p = period(parent.level, parent.index, parent.unit);
      if (p.unit !== 'cycle')
        throw new TypeError(
          'Nested children use full-cycle parents. Use periods() for half/quarter intervals.',
        );
      const first = p.index * BigInt(factorAt(p.level)),
        last = ceil(mul(p.end, rational(prefix(p.level + 1), 4n))),
        total = last - first;
      const skip = integer(offset);
      positiveInt(limit, 'Page limit', 10000);
      if (skip < 0n || skip > total)
        throw new RangeError('Child offset outside the parent.');
      const end = skip + BigInt(limit) < total ? skip + BigInt(limit) : total;
      const items = [];
      for (let j = skip; j < end; j++)
        items.push(period(p.level + 1, first + j));
      return { total, offset: skip, next: end < total ? end : null, items };
    }
    function* periods(level, { from = 0n, limit = 100, unit = 'cycle' } = {}) {
      const start = integer(from),
        total = count(level, unit);
      positiveInt(limit, 'Limit', 10000);
      if (start < 0n || start > total)
        throw new RangeError('Period offset outside the catalogue.');
      for (let i = start; i < total && i < start + BigInt(limit); i++)
        yield period(level, i, unit);
    }
    function* tree(parent, { levels = 5, limit = 10000 } = {}) {
      positiveInt(levels, 'Levels');
      positiveInt(limit, 'Tree limit', 100000);
      const stack = [
        { period: period(parent.level, parent.index, parent.unit), depth: 0 },
      ];
      let seen = 0;
      while (stack.length) {
        if (seen++ >= limit)
          throw new RangeError(
            'Tree limit exceeded; reduce levels or paginate.',
          );
        const node = stack.pop();
        yield node;
        if (node.depth + 1 < levels) {
          const next = children(node.period, { limit: 10000 });
          if (next.next !== null)
            throw new RangeError(
              'Too many children; paginate with children().',
            );
          for (let i = next.items.length - 1; i >= 0; i--)
            stack.push({ period: next.items[i], depth: node.depth + 1 });
        }
      }
    }
    // A glyph of d strokes has extreme M = (3^d - 1)/2 and 4M cyclic states;
    // one full cycle (4/P Saros units) spans all of them.
    const strokesOf = (strokes = 2) => {
      positiveInt(strokes, 'Glyph strokes', 32);
      return { depth: strokes, m: (3n ** BigInt(strokes) - 1n) / 2n };
    };
    function stateOf(index, m) {
      const value =
        index <= m ? index : index <= 3n * m ? 2n * m - index : index - 4n * m;
      const derivative =
        index === m || index === 3n * m
          ? 0
          : index < m || index > 3n * m
            ? 1
            : -1;
      return { value, derivative };
    }
    function phaseAt(value, level, { strokes = 2 } = {}) {
      const p = position(value),
        factor = factorAt(level),
        { depth, m } = strokesOf(strokes),
        units = prefix(level) * m;
      const index = modulo(
        (p.numerator * units) / p.denominator + (ascending ? 0n : 2n * m),
        4n * m,
      );
      const state = stateOf(index, m);
      return Object.freeze({
        level,
        factor,
        index,
        states: 4n * m,
        value: state.value,
        derivative: state.derivative,
        depth,
        trits: Object.freeze(CBT.toTrits(state.value, depth)),
      });
    }
    // Odometer: `digits` phase indices, coarsest first. Digit 0 equals
    // phaseAt().index; each further digit runs one full cycle inside one state
    // of its left neighbour. `next` is the position where the finest digit
    // next changes.
    function phaseDigits(value, level, { strokes = 2, digits = 2 } = {}) {
      const p = position(value),
        { m } = strokesOf(strokes),
        q = 4n * m;
      positiveInt(digits, 'Odometer digits', 64);
      const fine = q ** BigInt(digits - 1),
        units = prefix(level) * m * fine;
      const raw = (p.numerator * units) / p.denominator,
        step = modulo(raw + (ascending ? 0n : 2n * m * fine), q * fine);
      const out = [];
      let rest = step;
      for (let i = 0; i < digits; i++) {
        out.unshift(rest % q);
        rest /= q;
      }
      const next = rational(raw + 1n, units);
      return Object.freeze({
        states: q,
        digits: Object.freeze(out),
        step,
        next,
        nextTime: compare(next, rational(extent)) <= 0 ? timestampAt(next) : null,
      });
    }
    // Position of the current cycle inside its parent: 0 for the first of
    // `siblings` cycles. Level 0 has no parent; its siblings are the cycles
    // of the whole catalogue.
    function counterAt(value, level) {
      const cycle = periodAt(value, level).index;
      if (level === 0) return Object.freeze({ cycle, local: cycle, siblings: count(0) });
      const siblings = BigInt(factorAt(level - 1));
      return Object.freeze({ cycle, local: cycle % siblings, siblings });
    }
    // Next quarter boundary of the current cycle. Ascending families reach
    // their peak first; descending families their valley.
    function nextThreshold(value, level) {
      const p = position(value),
        cycle = periodAt(p, level);
      const names = ascending
        ? { firstPeak: 'peak', middleNode: 'node', oppositePeak: 'valley', end: 'end' }
        : { firstPeak: 'valley', middleNode: 'node', oppositePeak: 'peak', end: 'end' };
      const event = cycle.events.find(
        (e) => e.name !== 'begin' && compare(e.position, p) > 0,
      ) ?? cycle.events.at(-1);
      return Object.freeze({ name: names[event.name], position: event.position, time: event.time });
    }
    // Sync periods: `cycles` consecutive cycles at `level`, counted from the
    // cycle that begins at catalogue ordinal `anchor`, compared with `days`
    // whole days. Each sync's start drifts from the exact day grid by
    // cycles*T - days*daySeconds; drift is that offset accumulated since the
    // anchor, in TT seconds.
    function solarSync({ anchor = 20, level = 6, cycles = 19, days = 4, daySeconds = 86400 } = {}) {
      levelOf(level);
      positiveInt(cycles, 'Sync cycles', 1e9);
      positiveInt(days, 'Sync days', 1e9);
      const a = integer(anchor, 'anchor ordinal'),
        p = prefix(level),
        n = BigInt(cycles),
        dayLength = rational(daySeconds);
      if ((a * p) % 4n !== 0n)
        throw new RangeError('The anchor ordinal must start a cycle at this level.');
      const anchorCycle = (a * p) / 4n,
        anchorTime = timestampAt(rational(a));
      const syncPosition = (k) => rational((anchorCycle + n * k) * 4n, p);
      function at(time) {
        const t = rational(time),
          cycle = floor(mul(positionAt(t), rational(p, 4n))),
          sync = floor(rational(cycle - anchorCycle, n)),
          startTime = timestampAt(syncPosition(sync)),
          endTime = timestampAt(syncPosition(sync + 1n)),
          nominalStart = add(anchorTime, mul(rational(sync * BigInt(days)), dayLength)),
          phase = div(sub(t, startTime), sub(endTime, startTime)),
          quarter = Number(floor(mul(phase, rational(4n)))),
          names = ['peak', 'node', 'valley', 'end'];
        return Object.freeze({
          sync,
          start: syncPosition(sync),
          end: syncPosition(sync + 1n),
          startTime,
          endTime,
          nominalStart,
          drift: sub(startTime, nominalStart),
          phase,
          quarter,
          threshold: Object.freeze({
            name: names[quarter],
            time: add(startTime, mul(sub(endTime, startTime), rational(quarter + 1, 4))),
          }),
        });
      }
      function digits(time, { strokes = 2, digits: count = 3 } = {}) {
        const { m } = strokesOf(strokes),
          q = 4n * m;
        positiveInt(count, 'Odometer digits', 64);
        let step = floor(mul(at(time).phase, rational(q ** BigInt(count))));
        const out = [];
        for (let i = 0; i < count; i++) {
          out.unshift(step % q);
          step /= q;
        }
        return Object.freeze(out);
      }
      return Object.freeze({ anchor: a, level, cycles, days, daySeconds: dayLength, anchorTime, at, digits });
    }
    function glyphSVG(value, level, style = {}, { strokes = 2 } = {}) {
      const phase = phaseAt(value, level, { strokes });
      return CBT.fromIndex(phase.index, { depth: phase.depth }).toSVG(style);
    }
    function glyphsSVG(value, { fromLevel = 0, levels = 5, style = {}, strokes = 2 } = {}) {
      levelOf(fromLevel);
      positiveInt(levels, 'Glyph count', 1024);
      levelOf(fromLevel + levels - 1);
      const phases = Array.from({ length: levels }, (_, i) =>
        phaseAt(value, fromLevel + i, { strokes }),
      );
      const geos = phases.map((p) =>
        CBT.geometry(CBT.fromIndex(p.index, { depth: p.depth }), style),
      );
      const scale = geos[0].style.scale,
        gap = geos[0].style.gap * scale;
      const heights = geos.map(
          (g) => (g.bounds.maxY - g.bounds.minY + 2 * g.style.padding) * scale,
        ),
        height = Math.max(...heights);
      let width = 0;
      const body = geos
        .map((g, i) => {
          const w =
            (g.bounds.maxX - g.bounds.minX + 2 * g.style.padding) * scale;
          const svg = glyphSVG(value, fromLevel + i, style, { strokes }).replace(
            '<svg ',
            `<svg x="${width}" y="${height - heights[i]}" `,
          );
          width += w + gap;
          return svg;
        })
        .join('');
      width -= gap;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Fractonica glyphs ${fromLevel + 1} to ${fromLevel + levels}, most significant first">${body}</svg>`;
    }
    const point = (arc, t) => ({
      x: arc.center.x + arc.radius * Math.cos(arc.start + arc.sweep * t),
      y: arc.center.y + arc.radius * Math.sin(arc.start + arc.sweep * t),
    });
    function child(parent, m, local, index) {
      if (m === 1) return { ...parent, level: parent.level + 1, index };
      const delta = parent.sweep / m;
      if (Math.abs(delta) >= Math.PI)
        throw new RangeError(
          'Circle subdivision must be shorter than a semicircle.',
        );
      const middle = parent.start + (local + 0.5) * delta,
        r = parent.radius / Math.cos(delta / 2);
      return {
        center: {
          x: parent.center.x + r * Math.cos(middle),
          y: parent.center.y + r * Math.sin(middle),
        },
        radius: parent.radius * Math.tan(Math.abs(delta / 2)),
        start: middle - Math.sign(delta) * (Math.PI / 2 + Math.abs(delta) / 2),
        sweep: delta + (index % 2n ? -1 : 1) * (ascending ? 1 : -1) * Math.PI,
        level: parent.level + 1,
        index,
      };
    }
    function arc(
      level,
      index,
      { root = 'wave', relativeTo, nominal = false } = {},
    ) {
      levelOf(level);
      const i = integer(index);
      if (i < 0n || (!nominal && i >= count(level, 'half')))
        throw new RangeError('Arc outside the catalogue.');
      if (
        typeof root === 'object' &&
        (!Number.isFinite(root.start) ||
          !Number.isFinite(root.sweep) ||
          !root.sweep ||
          Math.abs(root.sweep) > 2 * Math.PI ||
          (root.period !== undefined &&
            (!Number.isFinite(root.period) || root.period <= 0)))
      )
        throw new RangeError(
          'Carrier needs finite start, nonzero sweep up to a full circle and a positive period.',
        );
      if (typeof root !== 'object' && !['wave', 'ring'].includes(root))
        throw new TypeError('Root geometry must be wave or ring.');
      if (root === 'ring' && extent <= 2n)
        throw new RangeError('A ring requires more than two Saros intervals.');
      const indices = [i];
      for (let l = level - 1; l >= 0; l--)
        indices.unshift(indices[0] / BigInt(factorAt(l)));
      const r = indices[0],
        direction = ascending ? 1 : -1;
      const inherited =
        typeof root === 'object' ? root.arcs?.[Number(r)] : undefined;
      if (typeof root === 'object' && root.arcs && !inherited)
        throw new RangeError(
          'Carrier sequence does not cover this catalogue interval.',
        );
      let result = {
        center: inherited
          ? { ...inherited.center }
          : { x: root !== 'wave' ? 0 : Number(r) * 2 + 1, y: 0 },
        radius: inherited?.radius ?? 1,
        start: inherited
          ? inherited.start
          : typeof root === 'object'
            ? root.start +
              (root.sweep * 2 * Number(r)) / (root.period ?? Number(extent))
            : root === 'ring'
              ? ((4 * Math.PI * Number(r)) / Number(extent)) * direction
              : Math.PI,
        sweep: inherited
          ? inherited.sweep
          : typeof root === 'object'
            ? (root.sweep * 2) / (root.period ?? Number(extent))
            : root === 'ring'
              ? ((4 * Math.PI) / Number(extent)) * direction
              : Math.PI * (r % 2n ? -1 : 1) * direction,
        level: 0,
        index: r,
      };
      const ref = relativeTo
        ? { level: levelOf(relativeTo.level), index: integer(relativeTo.index) }
        : null;
      if (ref && (ref.level > level || indices[ref.level] !== ref.index))
        throw new RangeError('relativeTo must identify an ancestor arc.');
      for (let l = 0; l <= level; l++) {
        if (ref && l === ref.level)
          result = { ...result, center: { x: 0, y: 0 }, radius: 1 };
        if (ref && l < ref.level)
          result = { ...result, center: { x: 0, y: 0 }, radius: 1 };
        if (l < level)
          result = child(
            result,
            factorAt(l),
            Number(indices[l + 1] % BigInt(factorAt(l))),
            indices[l + 1],
          );
        result.start = moduloAngle(result.start);
      }
      if (!Number.isFinite(result.radius) || result.radius === 0)
        throw new RangeError(
          'Geometry is below floating-point range; use relativeTo to rebase the drawing.',
        );
      return result;
    }
    function compose(
      ctx,
      {
        position: at = rational(0n),
        focus,
        levels = 5,
        root = 'wave',
        width = ctx.canvas.width,
        height = ctx.canvas.height,
        scale,
        offsetX = width / 2,
        offsetY = height / 2,
        minRadius = 2,
        maxArcs = 4000,
        lineWidth = 1.4,
        color = '#a9ddcb',
        gaugeColor = '#77edaa',
        background = '#0d1b14',
        clear = true,
      } = {},
    ) {
      const p = position(at);
      positiveInt(levels, 'Levels', 1024);
      positiveInt(maxArcs, 'maxArcs', 100000);
      if (
        ![width, height, lineWidth, minRadius].every(
          (n) => Number.isFinite(n) && n > 0,
        )
      )
        throw new RangeError(
          'Canvas dimensions, lineWidth and minRadius must be positive.',
        );
      const baseLevel = focus ? levelOf(focus.level) : 0,
        last = Math.min(LIMIT - 1, baseLevel + levels - 1),
        relativeTo = focus
          ? { level: baseLevel, index: integer(focus.index) }
          : undefined;
      const zoom =
        scale ??
        (focus
          ? Math.min(width, height) / 3.5
          : root !== 'wave'
            ? Math.min(width, height) / 3.5
            : Math.min(width / (Number(extent) + 2), height / 4));
      if (
        !Number.isFinite(zoom) ||
        zoom <= 0 ||
        !Number.isFinite(offsetX) ||
        !Number.isFinite(offsetY)
      )
        throw new RangeError('Invalid canvas transform.');
      const tx =
          offsetX -
          (focus || root !== 'wave' ? 0 : (Number(extent) / 2) * zoom),
        ty = offsetY;
      const visible = (a) =>
        Math.abs(a.center.x * zoom + tx - width / 2) <=
          width / 2 + a.radius * zoom + 4 &&
        Math.abs(a.center.y * zoom + ty - height / 2) <=
          height / 2 + a.radius * zoom + 4;
      const queue = [];
      if (focus)
        queue.push(arc(baseLevel, relativeTo.index, { root, relativeTo }));
      else {
        const roots = count(0, 'half');
        if (roots > BigInt(maxArcs))
          throw new RangeError(
            'Root count exceeds maxArcs; focus a specific arc.',
          );
        for (let i = roots - 1n; i >= 0n; i--) queue.push(arc(0, i, { root }));
      }
      const arcs = [],
        markers = [];
      let culled = 0,
        capped = false;
      ctx.save();
      try {
        if (clear) {
          ctx.clearRect(0, 0, width, height);
          if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, width, height);
          }
        }
        ctx.translate(tx, ty);
        ctx.scale(zoom, zoom);
        ctx.lineWidth = lineWidth / zoom;
        ctx.lineCap = 'round';
        ctx.strokeStyle = color;
        while (queue.length && arcs.length < maxArcs) {
          const a = queue.pop();
          if (!visible(a) || a.radius * zoom < minRadius) {
            culled++;
            continue;
          }
          arcs.push(a);
          ctx.globalAlpha = Math.min(1, (a.radius * zoom) / (minRadius * 4));
          ctx.beginPath();
          ctx.arc(
            a.center.x,
            a.center.y,
            a.radius,
            a.start,
            a.start +
              a.sweep *
                Math.min(
                  1,
                  number(rational(extent * prefix(a.level) - 2n * a.index, 2n)),
                ),
            a.sweep < 0,
          );
          ctx.stroke();
          const local = sub(
            mul(p, rational(prefix(a.level), 2n)),
            rational(a.index),
          );
          if (a.index === periodAt(p, a.level, 'half').index)
            markers.push({
              level: a.level,
              index: a.index,
              arc: a,
              progress: number(local),
              point: point(a, number(local)),
            });
          if (a.level < last) {
            const m = factorAt(a.level),
              radius =
                m === 1
                  ? a.radius
                  : a.radius * Math.tan(Math.abs(a.sweep / m) / 2);
            if (
              radius * zoom >= minRadius &&
              m <= maxArcs - arcs.length - queue.length
            ) {
              for (let j = m - 1; j >= 0; j--) {
                const index = a.index * BigInt(m) + BigInt(j);
                if (index < count(a.level + 1, 'half'))
                  queue.push(child(a, m, j, index));
              }
            } else {
              culled += m;
              if (radius * zoom >= minRadius) capped = true;
            }
          }
        }
        markers.sort((a, b) => a.level - b.level);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = gaugeColor;
        ctx.fillStyle = gaugeColor;
        ctx.lineWidth = (lineWidth * 1.7) / zoom;
        markers.forEach((m, i) => {
          ctx.beginPath();
          if (i && markers[i - 1].level === m.level - 1) {
            const parent = markers[i - 1],
              local = Number(m.index % BigInt(factorAt(parent.level))),
              middle = (local + 0.5) / factorAt(parent.level);
            ctx.arc(
              parent.arc.center.x,
              parent.arc.center.y,
              parent.arc.radius,
              parent.arc.start + parent.arc.sweep * parent.progress,
              parent.arc.start + parent.arc.sweep * middle,
              parent.arc.sweep * (middle - parent.progress) < 0,
            );
            const attach = point(parent.arc, middle);
            ctx.moveTo(attach.x, attach.y);
          } else ctx.moveTo(m.arc.center.x, m.arc.center.y);
          ctx.lineTo(m.point.x, m.point.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(m.point.x, m.point.y, 3 / zoom, 0, 2 * Math.PI);
          ctx.fill();
        });
      } finally {
        ctx.restore();
      }
      return {
        arcs,
        markers,
        culled,
        capped: capped || queue.length > 0,
        transform: { scale: zoom, x: tx, y: ty },
      };
    }
    return Object.freeze({
      timeScale: clockScale,
      sequence: Object.freeze(sequence),
      timestamps: Object.freeze(times),
      ordinals: Object.freeze(ordinals),
      ascending,
      extent,
      factorAt,
      prefix,
      count,
      timestampAt,
      positionAt,
      period,
      periodAt,
      periodAtTime: (time, level, unit) =>
        periodAt(positionAt(time), level, unit),
      children,
      periods,
      tree,
      phaseAt,
      phaseDigits,
      counterAt,
      nextThreshold,
      solarSync,
      glyphSVG,
      glyphsSVG,
      arc,
      compose,
    });
  }
  const moduloAngle = (x) =>
    ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Period names: level 0 is alpha. After omega the alphabet repeats with a
  // numeric suffix (alpha1, beta1, ...).
  const GREEK = 'αβγδεζηθικλμνξοπρστυφχψω';
  function periodName(level) {
    levelOf(level);
    const letter = GREEK[level % GREEK.length],
      cycle = Math.floor(level / GREEK.length),
      suffix = cycle ? String(cycle) : '';
    return Object.freeze({ level, depth: level + 1, letter, suffix, text: letter + suffix });
  }
  // Catalogues that stored pre-reform (before 1582-10-15) Julian calendar
  // fields as if they were Gregorian are off by the calendar difference
  // (10 days in 1582, 1 day per non-leap Gregorian century before that).
  // Re-read such a timestamp's fields as Julian; later values pass through.
  const REFORM_SECONDS = -12219292800n; // 1582-10-15T00:00:00 Gregorian
  function correctJulianTimestamp(seconds) {
    const big = typeof seconds === 'bigint';
    const t = rational(seconds);
    if (compare(t, rational(REFORM_SECONDS)) >= 0) return seconds;
    const days = floor(rational(t.numerator, t.denominator * 86400n)),
      within = sub(t, rational(days * 86400n));
    // Proleptic Gregorian fields of `days` (days since 1970-01-01) ...
    const z = days + 719468n,
      era = (z >= 0n ? z : z - 146096n) / 146097n,
      doe = z - era * 146097n,
      yoe = (doe - doe / 1460n + doe / 36524n - doe / 146096n) / 365n,
      doy = doe - (365n * yoe + yoe / 4n - yoe / 100n),
      mp = (5n * doy + 2n) / 153n,
      day = doy - (153n * mp + 2n) / 5n + 1n,
      month = mp < 10n ? mp + 3n : mp - 9n,
      year = yoe + era * 400n + (month <= 2n ? 1n : 0n);
    // ... re-read as a Julian calendar date (JDN), back to days since epoch.
    const a = (14n - month) / 12n,
      y = year + 4800n - a,
      mm = month + 12n * a - 3n,
      jdn = day + (153n * mm + 2n) / 5n + 365n * y + y / 4n - 32083n;
    const out = add(rational((jdn - 2440588n) * 86400n), within);
    if (big && out.denominator === 1n) return out.numerator;
    return out.denominator === 1n && !big ? Number(out.numerator) : out;
  }
  return Object.freeze({
    version: '2.0.0',
    periodName,
    correctJulianTimestamp,
    create,
    CBT,
    rational,
    compare,
    number,
    fromUTC: utcToTT,
    fromUnix: unixSeconds,
    toUnix: (value) => civil.civilFromTT(rational(value)).time,
    toCivil: (value, { timeScale = 'TT' } = {}) => civilOf(value, timeScale),
    formatTimestamp,
    stringify: (value, space = 2) =>
      JSON.stringify(
        value,
        (_key, v) => (typeof v === 'bigint' ? v.toString() : v),
        space,
      ),
    defaults: Object.freeze({
      sequence: Object.freeze(DEFAULT_SEQUENCE),
      timestamps: Object.freeze(DEFAULT_ECLIPSES),
      unixTimestamps: Object.freeze(DEFAULT_ECLIPSES_UNIX),
      timeScale: 'TT',
      family: 141,
      kind: 'solar',
    }),
  });
}

const base=createFractonicaAPI(CBT,civil,DEFAULT_SEQUENCE,DEFAULT_ECLIPSES,DEFAULT_ECLIPSES_UNIX);
const calendarModule=(()=>{const exports={};"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cycleNames = void 0;
exports.calendarPhaseNames = calendarPhaseNames;
exports.createCalendarAPI = createCalendarAPI;
exports.cycleNames = Object.freeze([
    'Alpha',
    'Beta',
    'Gamma',
    'Delta',
    'Epsilon',
]);
function calendarPhaseNames(ascending) {
    return ascending
        ? ['Ascent', 'Peak', 'Descent', 'Valley', 'Ascent']
        : ['Descent', 'Valley', 'Ascent', 'Peak', 'Descent'];
}
// Dependency injection keeps the exact same calendar code in the app and UMD file.
function createCalendarAPI(F, render, makeLoop) {
    const fraction = F.rational;
    function formatCalendarDate(value, options = {}) {
        if (!value)
            return 'Outside catalogue';
        const civil = F.toCivil(value, { timeScale: options.timeScale ?? 'TT' }).time;
        const scaled = civil.numerator * 1000n;
        const ms = scaled / civil.denominator -
            (scaled < 0n && scaled % civil.denominator ? 1n : 0n);
        const date = new Date(Number(ms));
        if (!Number.isFinite(date.getTime()))
            throw new RangeError('Timestamp outside JavaScript Date display range.');
        return new Intl.DateTimeFormat(options.locale ?? 'en-GB', {
            timeZone: options.timeZone,
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            ...(date.getUTCFullYear() <= 0 ? { era: 'short' } : {}),
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).format(date);
    }
    function periodLabel(period) {
        for (const [scale, unit] of [
            [31557600n, 'yr'],
            [86400n, 'd'],
            [3600n, 'h'],
            [60n, 'min'],
            [1n, 's'],
        ]) {
            if (period.numerator >= scale * period.denominator || scale === 1n) {
                const value = F.number(fraction(period.numerator, period.denominator * scale));
                return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value)} ${unit}`;
            }
        }
        return '';
    }
    const add = (a, b) => fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
    const sub = (a, b) => fraction(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
    const divide = (a, n) => fraction(a.numerator, a.denominator * n);
    const times = (a, n) => fraction(a.numerator * n, a.denominator);
    const ceiling = (a) => (a.numerator + a.denominator - 1n) / a.denominator;
    const ratio = (a, b) => fraction(a.numerator * b.denominator, a.denominator * b.numerator);
    // Calendar periods and glyphs use the same harmonic timeline as the gauge.
    function createCycleCalendar(clock, capacities = Array.from({ length: 5 }, (_, i) => clock.factorAt(i)), dateOptions = {}) {
        if (capacities.length < 5)
            throw new Error('Five calendar amplitudes are required.');
        capacities.forEach((n, level) => {
            if (n !== clock.factorAt(level))
                throw new Error('Calendar factors must match the gauge timeline.');
        });
        const radix = (level) => BigInt(clock.factorAt(Math.max(0, level - 1)));
        function cycle(address) {
            if (!address.length || address.length > 5)
                throw new Error('Choose Alpha through Epsilon.');
            const root = clock.period(0, address[0]);
            let start = root.start, span = sub(root.nominalEnd, root.start), count = clock.count(0);
            for (let level = 1; level < address.length; level++) {
                span = divide(span, radix(level));
                const available = sub(fraction(clock.extent), start);
                count = ceiling(ratio(available, span));
                if (count > radix(level))
                    count = radix(level);
                const index = address[level];
                if (index < 0n || index >= count)
                    throw new Error('Cycle is outside its selected parent.');
                start = add(start, times(span, index));
            }
            const nominalEnd = add(start, span), end = F.compare(nominalEnd, fraction(clock.extent)) > 0
                ? fraction(clock.extent)
                : nominalEnd;
            const ascending = clock.ascending;
            return {
                ascending,
                direction: ascending ? 'ascending' : 'descending',
                address: [...address],
                level: address.length - 1,
                index: address.at(-1),
                count,
                start,
                end,
                nominalEnd,
                startTime: clock.timestampAt(start),
                endTime: clock.timestampAt(end),
                clipped: F.compare(end, nominalEnd) < 0,
                events: Array.from({ length: 5 }, (_, i) => {
                    const position = add(start, divide(times(span, BigInt(i)), 4n));
                    return {
                        label: calendarPhaseNames(ascending)[i],
                        position,
                        time: F.compare(position, end) <= 0
                            ? clock.timestampAt(position)
                            : null,
                    };
                }),
            };
        }
        function children(parent, offset = 0n, limit = 96) {
            if (parent.level === 4)
                return { total: 0n, nominal: 0n, items: [], offset };
            const nominal = radix(parent.level + 1), span = divide(sub(parent.nominalEnd, parent.start), nominal), total = ceiling(ratio(sub(parent.end, parent.start), span));
            if (offset < 0n || offset >= total)
                offset = 0n;
            const size = BigInt(Math.max(1, Math.min(96, limit))), end = offset + size < total ? offset + size : total;
            const items = [];
            for (let i = offset; i < end; i++)
                items.push(cycle([...parent.address, i]));
            return { total, nominal, items, offset };
        }
        function at(position) {
            const root = clock.periodAt(position, 0), address = [root.index];
            let p = cycle(address);
            while (address.length < 5) {
                const r = radix(address.length), local = ratio(sub(position, p.start), sub(p.nominalEnd, p.start));
                let i = (local.numerator * r) / local.denominator;
                const total = children(p, 0n, 1).total;
                if (i >= total)
                    i = total - 1n;
                address.push(i);
                p = cycle(address);
            }
            return address;
        }
        function step(address, direction) {
            const p = cycle(address), next = p.index + BigInt(direction);
            if (next < 0n || next >= p.count)
                return address;
            return [...address.slice(0, -1), next];
        }
        const glyphStyle = (print) => ({
            color: print ? '#173e27' : '#e6eddf',
            thickness: 0.3,
            scale: 7,
        });
        function glyphsAt(position, levels = 5, print = false) {
            return clock.glyphsSVG(position, { levels, style: glyphStyle(print) });
        }
        function group(p, print = false, position = p.start) {
            return glyphsAt(position, p.level + 1, print);
        }
        const date = (t) => formatCalendarDate(t, { timeScale: clock.timeScale, ...dateOptions });
        function view(p, selectedChild, offset = 0n, print = false, position = p.start) {
            const page = children(p, offset), names = calendarPhaseNames(p.ascending);
            return {
                direction: p.direction,
                name: exports.cycleNames[p.level],
                cycle: String(p.index + 1n),
                parent: p.level
                    ? `${exports.cycleNames[p.level - 1]} ${p.address[p.level - 1] + 1n}`
                    : 'Saros series',
                address: group(p, print, position),
                duration: periodLabel(sub(p.endTime, p.startTime)),
                thresholds: p.events.map((event, i) => ({
                    label: names[i],
                    date: date(event.time),
                    glyph: event.time
                        ? clock.glyphSVG(event.position, p.level, glyphStyle(print))
                        : '',
                })),
                children: page.items.map((child) => ({
                    index: String(child.index),
                    label: `${exports.cycleNames[child.level]} ${child.index + 1n}`,
                    glyph: group(child, print),
                    date: date(child.startTime),
                    selected: child.index === selectedChild,
                    fraction: Number(child.index) / Number(page.nominal),
                })),
                childName: exports.cycleNames[p.level + 1] ?? '',
                partial: p.clipped,
                childrenTotal: String(page.total),
                childrenSlots: String(page.nominal),
            };
        }
        function geometrySVG(address, print = false, offset = 0n) {
            const p = cycle(address), level = p.level;
            const global = clock.periodAt(p.start, level).index;
            // Rebase at the nearest shared ancestor before converting tiny radii to pixels.
            let left = global * 2n, right = left + 1n;
            let reference;
            for (let l = level - 1; l >= 0; l--) {
                left /= BigInt(clock.factorAt(l));
                right /= BigInt(clock.factorAt(l));
                if (left === right) {
                    reference = { level: l, index: left };
                    break;
                }
            }
            const ink = print ? '#17402b' : '#8cf2a2';
            const muted = print ? '#547363' : '#adc2b3';
            const escape = (text) => text.replace(/[&<>"']/g, (c) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[c]);
            const arcs = [];
            function append(l, index, child, label) {
                if (index >= clock.count(l, 'half'))
                    return;
                const period = clock.period(l, index, 'half');
                const progress = F.number(ratio(sub(period.end, period.start), sub(period.nominalEnd, period.start)));
                arcs.push({
                    arc: clock.arc(l, index, {
                        root: dateOptions.geometryRoot ?? 'wave',
                        relativeTo: reference,
                    }),
                    start: period.start,
                    end: period.end,
                    progress,
                    child,
                    label,
                });
            }
            for (let i = 0n; i < 2n; i++)
                append(level, global * 2n + i, false, '');
            if (level < 4) {
                const page = children(p, offset);
                for (const child of page.items) {
                    const index = clock.periodAt(child.start, level + 1).index;
                    for (let i = 0n; i < 2n; i++)
                        append(level + 1, index * 2n + i, true, `${exports.cycleNames[level + 1]} ${child.index + 1n}`);
                }
            }
            const bounds = {
                x0: Infinity,
                x1: -Infinity,
                y0: Infinity,
                y1: -Infinity,
            };
            for (const { arc: a, progress } of arcs)
                for (let i = 0; i <= 64; i++) {
                    const angle = a.start + (a.sweep * progress * i) / 64;
                    const x = a.center.x + a.radius * Math.cos(angle), y = a.center.y + a.radius * Math.sin(angle);
                    bounds.x0 = Math.min(bounds.x0, x);
                    bounds.x1 = Math.max(bounds.x1, x);
                    bounds.y0 = Math.min(bounds.y0, y);
                    bounds.y1 = Math.max(bounds.y1, y);
                }
            const scale = Math.min(980 / (bounds.x1 - bounds.x0), 660 / (bounds.y1 - bounds.y0));
            const point = (a, t) => ({
                x: 600 +
                    (a.center.x +
                        a.radius * Math.cos(a.start + a.sweep * t) -
                        (bounds.x0 + bounds.x1) / 2) *
                        scale,
                y: 520 +
                    (a.center.y +
                        a.radius * Math.sin(a.start + a.sweep * t) -
                        (bounds.y0 + bounds.y1) / 2) *
                        scale,
            });
            const paths = arcs
                .map(({ arc: a, progress, child, label, start }) => {
                const x = point(a, 0), y = point(a, progress), mid = point(a, progress / 2), sweep = a.sweep * progress;
                const path = `<path d="M${x.x} ${x.y} A${a.radius * scale} ${a.radius * scale} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${y.x} ${y.y}" fill="none" stroke="${child ? muted : ink}" stroke-width="${child ? 1.4 : 3}"/>`;
                const childIndex = a.index / 2n - global * BigInt(clock.factorAt(level));
                return ((child
                    ? `<g class="calendar-orbit-item" data-cycle-index="${childIndex}" role="button" tabindex="0" aria-label="Open ${escape(label)}"><title>${escape(label)} · ${escape(date(clock.timestampAt(start)))}</title>`
                    : '') +
                    path +
                    (child
                        ? `<circle cx="${x.x}" cy="${x.y}" r="3" fill="${muted}"/><text x="${mid.x}" y="${mid.y - 12}" text-anchor="middle" font-size="11" fill="${muted}"><title>${escape(date(clock.timestampAt(start)))}</title>${escape(label)}</text>`
                        : '') +
                    (child ? '</g>' : ''));
            })
                .join('');
            const markers = p.events
                .filter((e) => e.time)
                .map((e, i) => {
                const parentIndex = Math.min(arcs.filter((a) => !a.child).length - 1, Math.floor(i / 2));
                const parent = arcs[parentIndex];
                const q = point(parent.arc, i / 2 - parentIndex);
                const svg = clock
                    .glyphSVG(e.position, level, glyphStyle(print))
                    .replace(/<svg\b[^>]*>/, (tag) => tag
                    .replace(/\s(?:width|height|x|y)="[^"]*"/g, '')
                    .replace('>', ` x="${q.x - 20}" y="${q.y - 65}" width="40" height="40">`));
                return `<g>${svg}<circle cx="${q.x}" cy="${q.y}" r="5" fill="${ink}"/><text x="${q.x}" y="${q.y + 24}" text-anchor="middle" fill="${ink}" font-size="14">${e.label}</text><text x="${q.x}" y="${q.y + 43}" text-anchor="middle" fill="${muted}" font-size="12">${escape(date(e.time))}</text></g>`;
            })
                .join('');
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1000" style="font-family:system-ui,sans-serif"><text x="600" y="65" text-anchor="middle" fill="${ink}" font-size="30">${exports.cycleNames[level]} ${p.index + 1n} · gauge geometry</text><text x="600" y="98" text-anchor="middle" fill="${muted}" font-size="16">Two half-cycle arcs · ${level < 4 ? clock.factorAt(level) + ' ' + exports.cycleNames[level + 1] + ' full cycles' : 'Epsilon cycle'} · ${periodLabel(sub(p.endTime, p.startTime))}</text>${paths}${markers}<text x="600" y="960" text-anchor="middle" fill="${muted}" font-size="14">Exact gauge arcs and phase glyphs · ${p.clipped ? 'partial catalogue cycle' : 'complete cycle'}</text></svg>`;
        }
        /** Collapse a cycle to a closed loop, preserving every geometric length ratio.
         * Dates and glyphs still sample the unmodified gauge's exact rational phase.
         */
        function loop(address) {
            const p = cycle(address), level = p.level;
            const global = clock.periodAt(p.start, level).index;
            let left = global * 2n, right = left + 1n;
            let reference;
            for (let l = level - 1; l >= 0; l--) {
                left /= BigInt(clock.factorAt(l));
                right /= BigInt(clock.factorAt(l));
                if (left === right) {
                    reference = { level: l, index: left };
                    break;
                }
            }
            // Include all nominal halves so the loop always closes. Uncatalogued
            // portions remain explicit; we never fabricate their eclipse dates.
            const childLevel = level + 1, count = clock.factorAt(level);
            if (count > 256)
                throw new RangeError('Closed loops support up to 256 cycles; use paged gauge geometry for larger factors.');
            const first = global * BigInt(count);
            const halves = Array.from({ length: count * 2 }, (_, i) => clock.arc(childLevel, first * 2n + BigInt(i), {
                root: dateOptions.geometryRoot ?? 'wave',
                relativeTo: reference,
                nominal: true,
            }));
            const geometry = makeLoop(halves.map((a) => a.radius * Math.abs(a.sweep)));
            const span = sub(p.nominalEnd, p.start);
            const position = (i) => add(p.start, divide(times(span, BigInt(i)), BigInt(count * 4)));
            const landmarks = Array.from({ length: count * 4 + 1 }, (_, i) => {
                const at = position(i);
                return {
                    position: at,
                    time: F.compare(at, p.end) <= 0 ? clock.timestampAt(at) : null,
                    label: calendarPhaseNames(p.ascending)[i % 4],
                    boundary: i % 4 === 0,
                };
            });
            return { ...geometry, cycle: p, childLevel, count, first, landmarks };
        }
        function loopSVG(address, print = false, selectedChild) {
            const selected = cycle(address);
            if (clock.factorAt(selected.level) > 256)
                return geometrySVG(address, print).replace('Two half-cycle arcs', 'Large subdivision · paged gauge geometry (closed loops: up to 256 cycles)');
            const data = loop(address), { arcs, cycle: p, landmarks } = data;
            const ink = print ? '#245139' : '#8cf2a2', muted = print ? '#536159' : '#bdc8bf';
            const esc = (x) => x.replace(/[&<>"']/g, (c) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[c]);
            const at = (a, t) => ({
                x: a.center.x + a.radius * Math.cos(a.start + t * a.sweep),
                y: a.center.y + a.radius * Math.sin(a.start + t * a.sweep),
            });
            const bounds = { x0: -1, x1: 1, y0: -1, y1: 1 };
            for (const a of arcs)
                for (let i = 0; i <= 64; i++) {
                    const q = at(a, i / 64);
                    bounds.x0 = Math.min(bounds.x0, q.x);
                    bounds.x1 = Math.max(bounds.x1, q.x);
                    bounds.y0 = Math.min(bounds.y0, q.y);
                    bounds.y1 = Math.max(bounds.y1, q.y);
                }
            const scale = Math.min(780 / (bounds.x1 - bounds.x0), 760 / (bounds.y1 - bounds.y0));
            const project = (q) => ({
                x: 600 + scale * (q.x - (bounds.x0 + bounds.x1) / 2),
                y: 620 + scale * (q.y - (bounds.y0 + bounds.y1) / 2),
            });
            const origin = project({ x: 0, y: 0 });
            const paths = arcs
                .map((a, i) => {
                const index = Math.floor(i / 2);
                const begin = landmarks[i * 2].position, finish = landmarks[i * 2 + 2].position;
                const through = Math.max(0, Math.min(1, F.number(ratio(sub(p.end, begin), sub(finish, begin)))));
                const path = (from, to, future) => {
                    const start = project(at(a, from)), end = project(at(a, to)), sweep = a.sweep * (to - from);
                    return `<path ${future ? '' : `data-source-length="${a.sourceLength}"`} d="M${start.x} ${start.y} A${a.radius * scale} ${a.radius * scale} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end.x} ${end.y}" stroke="${ink}" stroke-width="${selectedChild === BigInt(index) ? 3.5 : 2}" fill="none" ${future ? 'stroke-dasharray="4 6" opacity=".35"' : ''}/>`;
                };
                return `<g ${p.level < 4 && through > 0 ? `class="calendar-orbit-item" data-cycle-index="${index}" role="button" tabindex="0" aria-label="Open ${exports.cycleNames[p.level + 1]} ${index + 1}"` : ''}><title>Cycle ${index + 1} · half ${(i % 2) + 1} · source length ${a.sourceLength}</title>${through > 0 ? path(0, through, false) : ''}${through < 1 ? path(through, 1, true) : ''}</g>`;
            })
                .join('');
            const sparse = data.count <= 7;
            const occupied = [];
            const labels = landmarks
                .slice(0, -1)
                .map((e, i) => {
                const a = arcs[Math.floor(i / 2)], q = project(at(a, (i % 2) / 2));
                const theta = Math.atan2(q.y - origin.y, q.x - origin.x);
                let label = {
                    x: q.x + 38 * Math.cos(theta),
                    y: q.y + 38 * Math.sin(theta),
                };
                for (let trial = 0; trial < 160; trial++) {
                    const angle = theta + (trial % 2 ? 1 : -1) * Math.floor(trial / 2) * 0.35;
                    const distance = 38 + Math.floor(trial / 14) * 17;
                    const candidate = {
                        x: Math.max(85, Math.min(1115, q.x + distance * Math.cos(angle))),
                        y: Math.max(160, Math.min(1080, q.y + distance * Math.sin(angle))),
                    };
                    label = candidate;
                    if (!occupied.some((o) => Math.abs(o.x - label.x) < (sparse ? 190 : 155) &&
                        Math.abs(o.y - label.y) < (sparse ? 58 : 45)))
                        break;
                }
                occupied.push(label);
                const caption = e.boundary
                    ? `B${Math.floor(i / 4) + 1} · ${e.label}`
                    : e.label;
                const glyph = e.time === null
                    ? ''
                    : clock
                        .glyphSVG(e.position, data.childLevel, glyphStyle(print))
                        .replace(/<svg\b[^>]*>/, (tag) => tag
                        .replace(/\s(?:width|height|x|y)="[^"]*"/g, '')
                        .replace('>', ` x="${label.x - 74}" y="${label.y - 22}" width="${sparse ? 30 : 24}" height="${sparse ? 42 : 35}">`));
                const endDate = i === 0 ? ` · end ${date(landmarks.at(-1).time)}` : '';
                return `<g><title>${esc(caption + ' · ' + date(e.time) + endDate)}</title><path d="M${q.x} ${q.y} L${label.x} ${label.y}" stroke="${muted}" opacity=".35" fill="none"/><circle cx="${q.x}" cy="${q.y}" r="${e.boundary ? 5 : 3}" fill="${print ? 'white' : '#101c16'}" stroke="${ink}"/>${glyph}<text x="${label.x + 10}" y="${label.y - 5}" text-anchor="middle" fill="${ink}" font-size="${sparse ? 17 : 13}">${esc(caption)}</text><text x="${label.x + 10}" y="${label.y + 12}" text-anchor="middle" fill="${muted}" font-size="${sparse ? 14 : 11}">${esc(date(e.time))}</text></g>`;
            })
                .join('');
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" style="font-family:system-ui,sans-serif"><text x="600" y="55" text-anchor="middle" fill="${ink}" font-size="28">${exports.cycleNames[p.level]} ${p.index + 1n} · closed arc loop</text><text x="600" y="87" text-anchor="middle" fill="${muted}" font-size="15">${data.count} ${exports.cycleNames[p.level + 1] ?? 'sub'} cycles · B = shared boundary · extrema and zero marked within each cycle</text><circle cx="${origin.x}" cy="${origin.y}" r="${scale}" fill="none" stroke="${muted}" opacity=".2" stroke-dasharray="3 6"/>${paths}${labels}<text x="600" y="1142" text-anchor="middle" fill="${muted}" font-size="13">One length scale preserves cycle sizes and both half-arc ratios. Dates follow the original phase.</text><text x="600" y="1167" text-anchor="middle" fill="${muted}" font-size="12">${data.alternating ? 'Alternating circular arcs · tangent joins · closed at B1' : 'Weighted circle: an alternating tangent closure is not possible for these length ratios.'}${p.clipped ? ' · Dashed portions extend beyond the catalogue' : ''}</text></svg>`;
        }
        function svg(address, options = {}) {
            if (!options.mode || options.mode === 'loop')
                return loopSVG(address, options.print ?? true, options.selectedChild);
            if (options.mode === 'geometry')
                return geometrySVG(address, options.print ?? true, options.offset ?? 0n);
            return render(view(cycle(address), options.selectedChild, options.offset ?? 0n, options.print ?? true), options.print ?? true);
        }
        return {
            cycle,
            children,
            at,
            step,
            view,
            group,
            radix,
            svg,
            formatDate: date,
            glyphsAt,
            geometrySVG,
            loop,
            loopSVG,
        };
    }
    return {
        createCycleCalendar,
        formatCalendarDate,
        cycleNames: exports.cycleNames,
        calendarPhaseNames,
    };
}

return exports;})();
const circleModule=(()=>{const exports={};"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarCircleSVG = calendarCircleSVG;
exports.circularCalendarPrintHTML = circularCalendarPrintHTML;
const escape = (v) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function glyph(svg, x, y, width, height) {
    return svg.replace(/<svg\b[^>]*>/, (tag) => tag
        .replace(/\s(?:width|height|x|y)="[^"]*"/g, '')
        .replace('>', ` x="${x}" y="${y}" width="${width}" height="${height}">`));
}
const point = (radius, angle) => ({
    x: 600 + radius * Math.sin(angle),
    y: 600 - radius * Math.cos(angle),
});
function wedge(from, to) {
    const a = point(172, from), b = point(415, from), c = point(415, to), d = point(172, to), large = to - from > Math.PI ? 1 : 0;
    return `M${a.x} ${a.y} L${b.x} ${b.y} A415 415 0 ${large} 1 ${c.x} ${c.y} L${d.x} ${d.y} A172 172 0 ${large} 0 ${a.x} ${a.y} Z`;
}
function calendarCircleSVG(view, print = false) {
    const ink = print ? '#142e22' : '#dcebd4', muted = print ? '#496451' : '#a5baa0', line = print ? '#b2c4b5' : '#36503d', accent = print ? '#28673b' : '#c3e8a4', fill = print ? '#f1f6ed' : '#1f3928';
    const children = view.children
        .map((item, i) => {
        const angle = 2 * Math.PI * (item.fraction ?? i / view.children.length), step = (2 * Math.PI) /
            Number(view.childrenSlots ?? view.childrenTotal ?? view.children.length), p = point(230, angle), degrees = (angle * 180) / Math.PI - 90, left = degrees > 90 && degrees < 270;
        const dateParts = item.date.split(/, (?=\d{2}:)/);
        const dateLines = dateParts
            .map((line, j) => `<text x="0" y="${14 + j * 16}" text-anchor="${left ? 'end' : 'start'}" fill="${muted}" font-size="14">${escape(line)}</text>`)
            .join('');
        return `<g class="calendar-orbit-item" data-cycle-index="${escape(item.index)}" role="button" tabindex="0" aria-label="Open ${escape(item.label)} · ${escape(item.date)}" aria-pressed="${!!item.selected}"><title>${escape(item.label)} — ${escape(item.date)}</title><path class="calendar-sector" d="${wedge(angle - step / 2, angle + step / 2)}" fill="${item.selected ? fill : 'transparent'}" stroke="${line}" stroke-width=".6"/><g class="calendar-oriented-glyph" transform="rotate(${left ? degrees + 180 : degrees} ${p.x} ${p.y})">${glyph(item.glyph, p.x - 24, p.y - 29, 48, 58)}</g><g transform="translate(${600 + 286 * Math.cos((degrees * Math.PI) / 180)} ${600 + 286 * Math.sin((degrees * Math.PI) / 180)}) rotate(${left ? degrees + 180 : degrees})"><text x="0" y="-6" text-anchor="${left ? 'end' : 'start'}" fill="${accent}" font-size="14">${escape(item.label)}</text>${dateLines}</g></g>`;
    })
        .join('');
    const spots = [
        { x: 600, y: 53 },
        { x: 1090, y: 600 },
        { x: 600, y: 1138 },
        { x: 110, y: 600 },
    ];
    const thresholds = view.thresholds
        .slice(0, 4)
        .map((t, i) => {
        const p = point(442, (i * Math.PI) / 2), s = spots[i];
        const dateLines = t.date
            .split(/, (?=\d{2}:)/)
            .map((line, j) => `<text x="${s.x}" y="${s.y + 38 + j * 16}" text-anchor="middle" fill="${ink}" font-size="14">${escape(line)}</text>`)
            .join('');
        return `<g><circle cx="${p.x}" cy="${p.y}" r="6" fill="${accent}"/>${glyph(t.glyph, s.x - 24, s.y - 35, 48, 40)}<text x="${s.x}" y="${s.y + 18}" text-anchor="middle" fill="${accent}" font-size="16">${escape(t.label)}</text>${dateLines}</g>`;
    })
        .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200" role="group" aria-label="${escape(view.name)} circular calendar" style="font-family:system-ui,sans-serif"><style>.calendar-orbit-item{cursor:pointer;outline:none}.calendar-orbit-item:hover .calendar-sector,.calendar-orbit-item:focus .calendar-sector{fill:${fill};stroke:${accent};stroke-width:2}</style><circle cx="600" cy="600" r="442" fill="none" stroke="${line}" stroke-width="2"/><circle cx="600" cy="600" r="172" fill="none" stroke="${line}"/>${children}${thresholds}<text x="600" y="523" text-anchor="middle" fill="${muted}" font-size="15">${escape(view.parent)}</text><text x="600" y="567" text-anchor="middle" fill="${accent}" font-size="40">${escape(view.name)}</text><text x="600" y="596" text-anchor="middle" fill="${ink}" font-size="19">${view.direction === 'descending' ? 'Descending' : 'Ascending'} · Cycle ${escape(view.cycle)}</text>${glyph(view.address, 505, 615, 190, 55)}<text x="600" y="700" text-anchor="middle" fill="${ink}" font-size="15">${escape(view.duration)}</text><text x="600" y="729" text-anchor="middle" fill="${muted}" font-size="14">${view.children.length ? `${view.childrenTotal ?? view.children.length} ${escape(view.childName)} cycles` : 'Five thresholds · complete cycle'}</text>${view.partial ? `<text x="600" y="753" text-anchor="middle" fill="${muted}" font-size="12">Partial catalogue cycle</text>` : ''}</svg>`;
}
function circularCalendarPrintHTML(views, title) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>@page{size:A3 portrait;margin:10mm}body{font:14px system-ui;color:#142e22;margin:0}h1{font-size:20px}section{break-after:page}section:last-child{break-after:auto}section>svg{width:100%;height:auto}button{padding:10px 18px}@media print{button{display:none}section{break-inside:avoid}}</style></head><body><button onclick="window.print()">Print / save PDF</button>${views.map((v) => `<section><h1>${escape(title)} · ${escape(v.name)} ${escape(v.cycle)}</h1>${calendarCircleSVG(v, true)}</section>`).join('')}</body></html>`;
}

return exports;})();
const loopModule=(()=>{const exports={};"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closedArcLoop = closedArcLoop;
/** A closed, tangent arc chain whose lengths share one scale factor.
 * Each source half-cycle becomes a circular arc. Its footprint on a carrier
 * circle is solved, rather than spacing endpoints uniformly and losing ratios.
 */
function closedArcLoop(lengths) {
    if (lengths.length < 2 ||
        lengths.length % 2 ||
        lengths.some((x) => !Number.isFinite(x) || x <= 0))
        throw new RangeError('Provide positive lengths for complete pairs of arcs.');
    const pi = Math.PI, tau = 2 * pi, maximum = Math.max(...lengths);
    const normalized = lengths.map((x) => x / maximum);
    // For carrier angle d: radius=tan(d/2), sweep=d ± pi.
    const lengthAt = (d, sign) => Math.tan(d / 2) * (pi + sign * d);
    function angleAt(length, sign) {
        let lo = 0, hi = pi - 1e-9;
        for (let j = 0; j < 48; j++) {
            const mid = (lo + hi) / 2;
            if (lengthAt(mid, sign) < length)
                lo = mid;
            else
                hi = mid;
        }
        return (lo + hi) / 2;
    }
    const anglesAt = (scale) => normalized.map((x, i) => angleAt(x * scale, i % 2 ? -1 : 1));
    let lo = 0, hi = (2 - 1e-8) / Math.max(...normalized.filter((_, i) => i % 2));
    const feasible = anglesAt(hi).reduce((a, b) => a + b, 0) >= tau;
    let angles;
    if (feasible) {
        for (let j = 0; j < 58; j++) {
            const mid = (lo + hi) / 2;
            if (anglesAt(mid).reduce((a, b) => a + b, 0) < tau)
                lo = mid;
            else
                hi = mid;
        }
        angles = anglesAt((lo + hi) / 2);
    }
    else {
        // Two unequal arcs alone cannot form a closed tangent alternating chain.
        // A weighted circle is the exact length-preserving degenerate projection.
        const total = normalized.reduce((a, b) => a + b, 0);
        angles = normalized.map((x) => (tau * x) / total);
    }
    let theta = -pi / 2;
    const arcs = angles.map((delta, i) => {
        const begin = theta;
        theta += delta;
        return feasible
            ? {
                center: {
                    x: Math.cos(begin + delta / 2) / Math.cos(delta / 2),
                    y: Math.sin(begin + delta / 2) / Math.cos(delta / 2),
                },
                radius: Math.tan(delta / 2),
                start: begin - pi / 2,
                sweep: delta + (i % 2 ? -pi : pi),
                sourceLength: lengths[i],
            }
            : {
                center: { x: 0, y: 0 },
                radius: 1,
                start: begin,
                sweep: delta,
                sourceLength: lengths[i],
            };
    });
    return { arcs, alternating: feasible };
}

return exports;})();
const gregorianModule=(()=>{const exports={};"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gregorianTicks = gregorianTicks;
/** Bounded local Gregorian sampling. Boundary search handles short/long civil days. */
function gregorianTicks(startMs, endMs, timeZone, locale = 'en-GB') {
    const format = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        era: 'short',
    });
    const parts = (ms) => {
        const p = Object.fromEntries(format.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
        return {
            year: p.era === 'BC' ? 1 - Number(p.year) : Number(p.year),
            month: Number(p.month),
            day: Number(p.day),
        };
    };
    const key = (p) => p.year * 400 + p.month * 32 + p.day;
    const utc = (y, m, d) => {
        const date = new Date(0);
        date.setUTCFullYear(y, m - 1, d);
        date.setUTCHours(0, 0, 0, 0);
        return date;
    };
    const span = (endMs - startMs) / 86400000;
    const unit = span <= 62 ? 'day' : span <= 1096 ? 'month' : 'year';
    const step = unit === 'year'
        ? Math.max(1, [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((n) => span / 365.2425 / n <= 32) ?? Math.ceil(span / 365.2425 / 32))
        : 1;
    const first = parts(startMs), cursor = utc(first.year, unit === 'year' ? 1 : first.month, unit === 'day' ? first.day : 1);
    if (unit === 'year')
        cursor.setUTCFullYear(Math.floor(first.year / step) * step);
    const ticks = [];
    for (let i = 0; i < 100; i++) {
        const target = {
            year: cursor.getUTCFullYear(),
            month: cursor.getUTCMonth() + 1,
            day: cursor.getUTCDate(),
        };
        let lo = cursor.getTime() - 36 * 3600000, hi = cursor.getTime() + 36 * 3600000;
        // Find the first real instant on this local civil date, including DST gaps.
        while (hi - lo > 1) {
            const mid = Math.floor((lo + hi) / 2);
            if (key(parts(mid)) < key(target))
                lo = mid;
            else
                hi = mid;
        }
        if (hi > endMs)
            break;
        if (hi >= startMs && key(parts(hi)) === key(target)) {
            const kind = target.month === 1 && target.day === 1 ? 'year' : unit;
            const label = kind === 'year'
                ? String(target.year)
                : new Intl.DateTimeFormat(locale, {
                    timeZone,
                    ...(kind === 'day'
                        ? { day: '2-digit', month: 'short' }
                        : { month: 'short' }),
                }).format(new Date(hi));
            ticks.push({ ms: hi, label, kind });
        }
        if (unit === 'day')
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        else if (unit === 'month')
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        else
            cursor.setUTCFullYear(cursor.getUTCFullYear() + step);
    }
    return { ticks, unit, step };
}

return exports;})();
const arcCalendarModule=(()=>{const exports={};"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createArcCalendarAPI = createArcCalendarAPI;
/** Portable half-arc calendar. Only translation and uniform scale change geometry. */
function createArcCalendarAPI(F, sample) {
    function createArcCalendar(clock, options = {}) {
        const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
        const root = options.geometryRoot ?? 'wave';
        const sub = (a, b) => F.rational(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
        const ratio = (a, b) => F.number(F.rational(a.numerator * b.denominator, a.denominator * b.numerator));
        const lerp = (a, b, n, d) => F.rational(a.numerator * b.denominator * d +
            (b.numerator * a.denominator - a.numerator * b.denominator) * n, a.denominator * b.denominator * d);
        const ms = (tt) => F.number(F.toCivil(tt, { timeScale: clock.timeScale }).time) * 1000;
        const date = (tt) => new Intl.DateTimeFormat(options.locale ?? 'en-GB', {
            timeZone: options.timeZone,
            year: 'numeric',
            month: 'short',
            day: '2-digit',
        }).format(new Date(ms(tt)));
        const hour = (tt) => new Intl.DateTimeFormat(options.locale ?? 'en-GB', {
            timeZone: options.timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).format(new Date(ms(tt)));
        function scalar(value, print = false) {
            return F.CBT.svg(F.CBT.fromDecimal(value, { depth: 2, mode: 'scalar' }), {
                color: print ? '#244a36' : '#e6eddf',
                scale: 7,
            });
        }
        function view(level, index, offset = 0n) {
            const period = clock.period(level, index, 'half'), reference = { level, index };
            const native = (l, i) => clock.arc(l, i, { root, relativeTo: reference });
            const parent = native(level, index), factor = clock.factorAt(level);
            const first = index * BigInt(factor), available = clock.count(level + 1, 'half') - first;
            const count = available < BigInt(factor) ? available : BigInt(factor);
            if (offset < 0n || offset >= count)
                offset = 0n;
            const children = [];
            const fine = [];
            for (let j = offset; j < count && j < offset + 96n; j++) {
                const global = first + j, p = clock.period(level + 1, global, 'half'), arc = native(level + 1, global);
                const through = ratio(sub(p.end, p.start), sub(p.nominalEnd, p.start));
                const signed = (j + 1n) * (arc.sweep > 0 ? 1n : -1n);
                children.push({
                    index: global,
                    local: j,
                    period: p,
                    arc,
                    through,
                    signed,
                });
                const m = BigInt(clock.factorAt(level + 1));
                for (let k = 0n; k < m && fine.length < 1536; k++) {
                    const at = global * m + k;
                    if (at >= clock.count(level + 2, 'half'))
                        break;
                    const p2 = clock.period(level + 2, at, 'half');
                    fine.push({
                        arc: native(level + 2, at),
                        through: ratio(sub(p2.end, p2.start), sub(p2.nominalEnd, p2.start)),
                    });
                }
            }
            const sampling = sample(ms(period.startTime), ms(period.endTime), options.timeZone, options.locale);
            const ticks = sampling.ticks.map((t) => ({
                ...t,
                position: clock.positionAt(F.fromUTC(new Date(t.ms))),
            }));
            return {
                period,
                parent,
                children,
                fine,
                count,
                offset,
                ticks,
                samplingUnit: sampling.unit,
                through: ratio(sub(period.end, period.start), sub(period.nominalEnd, period.start)),
            };
        }
        function svg(level, index, { print = false, offset = 0n } = {}) {
            const data = view(level, index, offset), { period, parent, children, fine } = data;
            const ink = print ? '#234d35' : '#8cf2a2', pale = print ? '#9ca99f' : '#91aaa0', text = print ? '#33473b' : '#d2ddd5';
            const esc = (s) => s.replace(/[&<>"']/g, (c) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[c]);
            const point = (a, t) => ({
                x: a.center.x + a.radius * Math.cos(a.start + t * a.sweep),
                y: a.center.y + a.radius * Math.sin(a.start + t * a.sweep),
            });
            const all = [
                { arc: parent, through: data.through },
                ...children,
                ...fine,
            ];
            const bounds = {
                x0: Infinity,
                x1: -Infinity,
                y0: Infinity,
                y1: -Infinity,
            };
            for (const { arc, through } of all)
                for (let j = 0; j <= 48; j++) {
                    const q = point(arc, (through * j) / 48);
                    bounds.x0 = Math.min(bounds.x0, q.x);
                    bounds.x1 = Math.max(bounds.x1, q.x);
                    bounds.y0 = Math.min(bounds.y0, q.y);
                    bounds.y1 = Math.max(bounds.y1, q.y);
                }
            const scale = Math.min(850 / Math.max(1e-12, bounds.x1 - bounds.x0), 650 / Math.max(1e-12, bounds.y1 - bounds.y0));
            const project = (q) => ({
                x: 600 + scale * (q.x - (bounds.x0 + bounds.x1) / 2),
                y: 540 + scale * (q.y - (bounds.y0 + bounds.y1) / 2),
            });
            const path = (arc, through, color, width, opacity = 1) => {
                const a = project(point(arc, 0)), b = project(point(arc, through)), s = arc.sweep * through;
                return `<path data-level="${arc.level}" data-index="${arc.index}" data-sweep="${arc.sweep}" d="M${a.x} ${a.y} A${arc.radius * scale} ${arc.radius * scale} 0 ${Math.abs(s) > Math.PI ? 1 : 0} ${s > 0 ? 1 : 0} ${b.x} ${b.y}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
            };
            const lines = fine.map((x) => path(x.arc, x.through, pale, 1, 0.48)).join('') +
                path(parent, data.through, ink, 3.5) +
                children
                    .map((x) => `<g data-arc-index="${x.index}" role="button" tabindex="0" aria-label="Inspect ${names[level + 1] ?? 'child'} arc ${x.local + 1n}"><title>${x.signed > 0n ? '+' : ''}${x.signed} · ${(Math.abs(x.arc.sweep) * 180) / Math.PI}°</title>${path(x.arc, x.through, ink, 2)}</g>`)
                    .join('');
            // The carrier is the date rail. Child nodes carry only local clock times.
            const occupied = [];
            const label = (q, value, normal, distance, size, color) => {
                let at = {
                    x: q.x + distance * Math.cos(normal),
                    y: q.y + distance * Math.sin(normal),
                };
                for (let k = 0; k < 8 &&
                    occupied.some((p) => Math.abs(p.x - at.x) < 65 && Math.abs(p.y - at.y) < 21); k++)
                    at = {
                        x: q.x + (distance + 18 * (k + 1)) * Math.cos(normal),
                        y: q.y + (distance + 18 * (k + 1)) * Math.sin(normal),
                    };
                occupied.push(at);
                return `<path d="M${q.x} ${q.y} L${at.x} ${at.y}" stroke="${color}" opacity=".35"/><text x="${at.x}" y="${at.y - 4}" text-anchor="middle" font-size="${size}" fill="${color}">${esc(value)}</text>`;
            };
            const calendarTicks = data.ticks
                .map((t, i) => {
                const progress = ratio(sub(t.position, period.start), sub(period.nominalEnd, period.start));
                const q = project(point(parent, progress)), angle = parent.start + progress * parent.sweep;
                return `<g data-calendar-tick="${t.kind}" data-utc-ms="${t.ms}"><circle cx="${q.x}" cy="${q.y}" r="${t.kind === 'year' ? 4 : 2.5}" fill="${text}"/>${t.kind === 'year' || i % Math.max(1, Math.ceil(data.ticks.length / 28)) === 0 ? label(q, t.label, angle, 40, t.kind === 'year' ? 18 : 14, text) : ''}</g>`;
            })
                .join('');
            const seen = new Set();
            const nodes = children
                .map((x) => {
                const middle = project(point(x.arc, x.through / 2)), angle = x.arc.start + (x.arc.sweep * x.through) / 2;
                const g = scalar(x.signed, print).replace(/<svg\b[^>]*>/, (tag) => tag
                    .replace(/\s(?:width|height|x|y)="[^"]*"/g, '')
                    .replace('>', ` x="${middle.x - 18 + 30 * Math.cos(angle)}" y="${middle.y - 30 + 30 * Math.sin(angle)}" width="36" height="48">`));
                const marks = [
                    { p: x.period.start, t: 0 },
                    { p: lerp(x.period.start, x.period.nominalEnd, 1n, 2n), t: 0.5 },
                    { p: x.period.end, t: x.through },
                ]
                    .filter((e) => e.t <= x.through)
                    .map((e) => {
                    const key = `${e.p.numerator}/${e.p.denominator}`;
                    if (seen.has(key))
                        return '';
                    seen.add(key);
                    const q = project(point(x.arc, e.t)), a = x.arc.start + x.arc.sweep * e.t;
                    return `<g><title>${esc(date(clock.timestampAt(e.p)) + ' ' + hour(clock.timestampAt(e.p)))}</title><circle cx="${q.x}" cy="${q.y}" r="3" fill="${ink}"/>${label(q, hour(clock.timestampAt(e.p)), a + Math.PI, 25, 13, text)}</g>`;
                })
                    .join('');
                return `<g data-scalar-index="${x.signed}">${g}${marks}</g>`;
            })
                .join('');
            const degrees = ((Math.abs(parent.sweep) * 180) / Math.PI).toFixed(2);
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1000" style="font-family:system-ui,sans-serif"><text x="600" y="46" text-anchor="middle" font-size="27" fill="${ink}">${names[level] ?? 'Level ' + (level + 1)} · half-cycle arc</text><text x="600" y="78" text-anchor="middle" font-size="16" fill="${text}">${esc(date(period.startTime))} — ${esc(date(period.endTime))} · ${degrees}° · ${parent.sweep > 0 ? 'positive' : 'negative'} curvature</text><text x="600" y="106" text-anchor="middle" font-size="13" fill="${text}">Local ${data.samplingUnit} ticks on the carrier · node labels show hours and minutes</text>${lines}${calendarTicks}${nodes}<text x="600" y="960" text-anchor="middle" font-size="13" fill="${text}">Signed scalar indices count arcs within this parent · pale curves show one further subdivision</text>${children.length < Number(data.count) ? `<text x="600" y="984" text-anchor="middle" fill="${text}" font-size="12">Arcs ${offset + 1n}–${offset + BigInt(children.length)} of ${data.count}</text>` : ''}</svg>`;
        }
        return { view, svg, scalar, date, hour };
    }
    return { createArcCalendar };
}

return exports;})();
/** Exact nominal scales, independent of the catalogue's clipped calendar periods. */
function createScaleAPI(F) {
  const q = F.rational;
  const mul = (a, b) => q(a.numerator * b.numerator, a.denominator * b.denominator);
  const div = (a, b) => q(a.numerator * b.denominator, a.denominator * b.numerator);
  const add = (a, b) => q(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
  const positive = (value, name) => {
    const result = q(value);
    if (result.numerator <= 0n) throw new RangeError(`${name} must be positive.`);
    return result;
  };
  const depthOf = (depth) => {
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > 1023)
      throw new RangeError('Depth must be an integer from 0 to 1023.');
    return depth;
  };
  const branchOf = (branch = 'micro') => {
    if (branch !== 'micro' && branch !== 'macro') throw new TypeError('branch must be micro or macro.');
    return branch;
  };
  const scaleDefaults = Object.freeze({
    // Reciprocal of the supplied atlas's first displayed frequency, in Hz.
    basePeriod: div(q(1), q('439.3883434e-12')),
    sequence: F.defaults.sequence,
    macroMode: 'cumulative',
    cutoff: q('5.391247e-44'),
    basis: 'Atlas entry #1: 439.3883434 pHz; exact recursion, not the rounded later rows.',
  });
  const media = Object.freeze([
    ['vacuum', 'Light in vacuum', 'Vacuum', '299792458', 'Exact vacuum light speed.'],
    ['bounded', 'Light in bounded medium', 'Vacuum + solid', '200000000', 'Shared copper/fiber signal benchmark; not electron drift. Actual speed depends on the guide.'],
    ['diamond', 'Diamond sound', 'Solid', '18000', 'Nominal longitudinal sound; depends on direction and mode.'],
    ['water', 'Water sound', 'Liquid', '1500', 'Nominal sound speed; depends on temperature, salinity and pressure.'],
    ['air', 'Air sound', 'Gas', '343', 'Nominal sound speed near 20 °C.'],
    ['nerve', 'Nerve conduction', 'Solid + liquid', '120', 'Fast-conduction upper benchmark, not a universal tissue speed.'],
    ['chemical', 'Chemical transport', 'Liquid + gas + solid', '0.001', 'Abstract constant-speed proxy at the supplied boundary; not a diffusion law.'],
  ].map(([id, name, phase, speed, note]) => Object.freeze({ id, name, phase, speed: q(speed), note })));
  const aliases = Object.freeze({ light: 'vacuum', copper: 'bounded', fiber: 'bounded', optical: 'bounded', sound: 'air' });
  function medium(id) {
    if (typeof id !== 'string') throw new TypeError('Use a medium ID, such as air or vacuum.');
    const key = id.toLowerCase();
    const result = media.find((item) => item.id === key || item.id === aliases[key]);
    if (!result) throw new RangeError(`Unknown medium: ${id}. Use ${media.map((m) => m.id).join(', ')}.`);
    return result;
  }
  // Metres per unit. A light-year uses an exact Julian year of 31,557,600 s.
  const lengthUnits = Object.freeze(Object.fromEntries(Object.entries({
    m: '1', km: '1000', cm: '.01', mm: '.001', um: '1e-6', nm: '1e-9',
    pm: '1e-12', fm: '1e-15', au: '149597870700', ly: '9460730472580800',
  }).map(([key, value]) => [key, q(value)])));
  const unitOf = (name) => {
    if (typeof name !== 'string') throw new TypeError('Length unit must be a string.');
    const key = name.toLowerCase().replace(/[µμ]/g, 'u');
    if (!Object.hasOwn(lengthUnits, key)) throw new RangeError(`Unknown length unit: ${name}.`);
    return lengthUnits[key];
  };
  function convertLengthExact(value, from = 'm', to = 'm') {
    return div(mul(q(value), unitOf(from)), unitOf(to));
  }
  const numeric = (value) => {
    const result = F.number(value);
    if (!Number.isFinite(result) || (result === 0 && value.numerator !== 0n))
      throw new RangeError('Result is outside the Number range. Use the exact rational variant.');
    return result;
  };
  function convertLength(value, from = 'm', to = 'm') {
    return numeric(convertLengthExact(value, from, to));
  }
  function createScale(options = {}) {
    const basePeriod = positive(options.basePeriod ?? scaleDefaults.basePeriod, 'basePeriod');
    const cutoff = positive(options.cutoff ?? scaleDefaults.cutoff, 'cutoff');
    const sequence = [...(options.sequence ?? scaleDefaults.sequence)];
    if (!sequence.length || sequence.length > 1024 || sequence.some((f) => !Number.isSafeInteger(f) || f < 1 || f > 193710244) || sequence.every((f) => f === 1))
      throw new RangeError('Sequence needs 1–1024 integer factors in 1–193710244, with at least one above 1.');
    const macroMode = options.macroMode ?? scaleDefaults.macroMode;
    if (!['cumulative', 'multiply'].includes(macroMode)) throw new TypeError('macroMode must be cumulative or multiply.');
    const prefixes = [1n];
    const prefix = (depth) => {
      depthOf(depth);
      while (prefixes.length <= depth) {
        const n = prefixes.length;
        prefixes.push(prefixes[n - 1] * BigInt(sequence[(n - 1) % sequence.length]));
      }
      return prefixes[depth];
    };
    let seed;
    const cumulativeSeed = () => {
      if (seed) return seed;
      let term = basePeriod, sum = basePeriod, n = 0;
      while (F.compare(term, cutoff) > 0) {
        if (n >= 1024) throw new RangeError('Cumulative seed did not reach cutoff in 1024 divisions; choose a larger cutoff or faster sequence.');
        term = div(term, q(sequence[n % sequence.length]));
        sum = add(sum, term);
        n++;
      }
      seed = sum;
      return seed;
    };
    function microPeriod(depth) { return div(basePeriod, q(prefix(depth))); }
    function macroPeriod(depth) {
      depthOf(depth);
      if (!depth) return basePeriod;
      return macroMode === 'multiply'
        ? mul(basePeriod, q(prefix(depth)))
        : mul(cumulativeSeed(), q(2n ** BigInt(depth - 1)));
    }
    function period(depth, { branch = 'micro' } = {}) {
      return branchOf(branch) === 'micro' ? microPeriod(depth) : macroPeriod(depth);
    }
    function frequency(depth, options) { return div(q(1), period(depth, options)); }
    function lengthExact(depth, mediumId = 'vacuum', { branch = 'micro', unit = 'm', speed } = {}) {
      const selected = medium(mediumId);
      const velocity = speed === undefined ? selected.speed : positive(speed, 'speed');
      return convertLengthExact(mul(period(depth, { branch }), velocity), 'm', unit);
    }
    function length(depth, mediumId = 'vacuum', options) { return numeric(lengthExact(depth, mediumId, options)); }
    function step(depth, { branch = 'micro' } = {}) {
      depthOf(depth); branchOf(branch);
      const wordBased = branch === 'micro' || macroMode === 'multiply';
      return Object.freeze({
        depth, branch, macroMode,
        operation: !depth ? 'baseline' : branch === 'micro' ? 'divide' : macroMode === 'multiply' ? 'multiply' : depth === 1 ? 'sum' : 'double',
        factor: !depth ? null : wordBased ? sequence[(depth - 1) % sequence.length] : depth === 1 ? null : 2,
        wordPosition: depth && wordBased ? (depth - 1) % sequence.length + 1 : null,
        wordCycle: depth && wordBased ? Math.floor((depth - 1) / sequence.length) + 1 : null,
        period: period(depth, { branch }), frequency: frequency(depth, { branch }),
      });
    }
    return Object.freeze({ basePeriod, sequence: Object.freeze(sequence), macroMode, cutoff,
      period, microPeriod, macroPeriod, frequency, length, lengthExact, step });
  }
  const defaultScale = createScale();
  return Object.freeze({ createScale, scaleDefaults, media, medium, lengthUnits, convertLength, convertLengthExact,
    period: defaultScale.period, microPeriod: defaultScale.microPeriod, macroPeriod: defaultScale.macroPeriod,
    frequency: defaultScale.frequency, length: defaultScale.length, lengthExact: defaultScale.lengthExact, step: defaultScale.step });
}

return Object.freeze({...base,...createScaleAPI(base),...arcCalendarModule.createArcCalendarAPI(base,gregorianModule.gregorianTicks),...calendarModule.createCalendarAPI(base,circleModule.calendarCircleSVG,loopModule.closedArcLoop),calendarCircleSVG:circleModule.calendarCircleSVG,circularCalendarPrintHTML:circleModule.circularCalendarPrintHTML});
});
