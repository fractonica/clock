import test from 'node:test';
import assert from 'node:assert/strict';
import '../fractonica.js';
import { createModel } from '../src/core/model.js';
import { createStore, validZone } from '../src/core/store.js';

const model = createModel();
const memory = (initial) => {
  const m = new Map(initial ? [['fractonica-clock/v1', JSON.stringify(initial)]] : []);
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), dump: () => JSON.parse(m.get('fractonica-clock/v1') ?? 'null') };
};
const clockAt = (start) => {
  let now = start;
  return { realNow: () => now, advance: (s) => (now += s) };
};

test('zones are validated', () => {
  assert.ok(validZone(null) && validZone('UTC') && validZone('Europe/Kyiv'));
  assert.ok(!validZone('Europe/Berlinn') && !validZone('') && !validZone(5) && !validZone(undefined));
});

test('invalid settings are ignored and never persisted', () => {
  const storage = memory();
  const store = createStore({ model, storage });
  store.set({ zone: 'Foo/Bar', selectedLevel: 6.5, topDepth: 99, minDepth: 0, maxDepth: 'x', showLetters: 'yes' });
  assert.deepEqual([store.state.zone, store.state.selectedLevel, store.state.topDepth, store.state.minDepth, store.state.maxDepth, store.state.showLetters], [null, 6, 7, 1, 10, false]);
  assert.equal(storage.dump(), null, 'nothing was saved');
  store.set({ zone: 'Asia/Tokyo', selectedLevel: 3 });
  assert.deepEqual(storage.dump().zone, 'Asia/Tokyo');
  assert.throws(() => store.set({ nope: 1 }), /unknown setting/);
});

test('garbage in storage falls back to defaults; blocked storage does not break the store', () => {
  const store = createStore({ model, storage: memory({ zone: 'Nope', selectedLevel: null, topDepth: -3, minDepth: 9, maxDepth: 4 }) });
  assert.equal(store.state.zone, null);
  assert.equal(store.state.selectedLevel, 6);
  assert.ok(store.state.minDepth <= store.state.maxDepth);
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const s2 = createStore({ model, storage: throwing });
  s2.set({ topDepth: 5 });
  assert.equal(s2.state.topDepth, 5);
  assert.doesNotThrow(() => createStore({ model, storage: null }));
});

test('minDepth <= maxDepth is kept', () => {
  const store = createStore({ model, storage: memory() });
  store.set({ maxDepth: 3 });
  store.set({ minDepth: 8 });
  assert.ok(store.state.minDepth <= store.state.maxDepth);
});

test('time: live, travel, pause, time-lapse, edge stop', () => {
  const c = clockAt(1791460800);
  const store = createStore({ model, storage: null, realNow: c.realNow });
  assert.ok(store.live && store.t() === 1791460800);
  const reasons = [];
  store.onTime((r) => reasons.push(r));
  store.setTime(946684800);
  assert.ok(!store.live && !store.playing);
  c.advance(10);
  assert.equal(store.t(), 946684800, 'paused travel does not move');
  store.setRate(3600);
  c.advance(2);
  assert.equal(store.t(), 946684800 + 7200);
  store.pause();
  const frozen = store.t();
  c.advance(5);
  assert.equal(store.t(), frozen);
  store.setTime(model.tMax - 10);
  store.setRate(100);
  c.advance(1);
  assert.equal(store.t(), model.tMax, 'time-lapse stops at the catalogue edge');
  assert.equal(store.rate, 0);
  assert.ok(reasons.includes('edge'));
  store.goLive();
  assert.ok(store.live);
});
