import test from 'node:test';
import assert from 'node:assert/strict';
import { testHub, rec } from './helpers.mjs';

test('web: the UI, the clock modules and the diary astronomy for sky tags are served; nothing else of the repository', async (t) => {
  const h = await testHub();
  t.after(h.close);
  const get = (path) => fetch(h.url + path);

  for (const path of ['/', '/app.js', '/fx/model.js', '/fx/astro/index.js', '/fx/astro/moon.js']) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
  }
  const astro = await get('/fx/astro/index.js');
  assert.match(astro.headers.get('content-type'), /javascript/);
  assert.match(await astro.text(), /export const EVENT_INFO/);

  for (const path of ['/fx/astro/nope.js', '/fx/astro/%2e%2e%2fplaces.js', '/fx/astro/index.json', '/fx/astro/..%2f..%2fcore%2fmodel.js']) {
    const r = await get(path);
    assert.equal(r.status, 404, path);
  }

  // sky tags are ordinary tags to the hub: stored and returned as written
  const tags = ['walk', 'sky:full-moon', 'sky:solar-eclipse'];
  const put = await h.admin.put('/v1/records/sky1', rec({ tags }));
  assert.equal(put.status, 201);
  assert.deepEqual((await h.admin.get('/v1/records/sky1')).body.tags, tags);
});
