// The Health page outside the browser: the workspace rules for workspace.health (shared/validate.mjs), the parse
// route with a fake chat provider (server/health.mjs, reached through api.mjs so the origin check is real too),
// and the lookup ladder with a fake fetch answering from a recorded response whose numbers are made up
// (tests/fixtures/usda-search-egg.json). HOME points at a temp folder, so the USDA cache never lands in the
// real profile or the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'health-home-'));
process.env.HOME = home; process.env.USERPROFILE = home;
delete process.env.APP_ACCESS_TOKEN; delete process.env.FDC_API_KEY;
for (const key of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete process.env[key];
process.env.OPENAI_API_KEY = 'test-key-not-real';
const { validateWorkspace } = await import('../shared/validate.mjs');
const { handleApi } = await import('../server/api.mjs');
const health = await import('../server/health.mjs');
const recorded = JSON.parse(fs.readFileSync(new URL('./fixtures/usda-search-egg.json', import.meta.url), 'utf8'));

async function call(route, body, headers = {}, local = true) {
  const req = { url: '/api/' + route, method: 'POST', headers: { host: '127.0.0.1:5174', 'content-type': 'application/json', ...headers }, body };
  const result = {};
  await handleApi(req, { writeHead(status) { result.status = status; }, end(value) { result.body = JSON.parse(String(value)); } }, { local });
  return result;
}

// ---- the workspace rules ----
const base = () => ({ version: 1, docs: [], goals: [], conversations: [], generations: [], activity: [] });
const filled = () => ({ ...base(), health: {
  meals: [{ id: 'm1', day: '2026-09-28', meal: 'breakfast', items: [{ id: 'i1', name: 'Egg', grams: 100, quantity: 2, unit: 'large', kcal: 150, protein: 12, carbs: 1, fat: 10, source: 'usda', fdcId: 900001 }] }],
  workouts: [{ id: 'w1', day: '2026-09-28', exercise: 'Bench press', kind: 'strength', sets: [{ reps: 8, weight: 135, unit: 'lb' }] }, { id: 'w2', day: '2026-09-28', exercise: 'Run', kind: 'cardio', distance: 2, distanceUnit: 'mi', minutes: 18, effort: 'easy' }],
  weights: [{ id: 'b1', day: '2026-09-28', weight: 162, unit: 'lb' }],
  foods: [{ id: 'f1', name: 'Toast', per100g: { kcal: 280, protein: 9, carbs: 50, fat: 4 }, unit: 'slice', unitGrams: 30 }],
  regimes: [{ id: 'r1', name: 'Push pull legs', notes: '', days: [{ id: 'd1', name: 'Push', exercises: [{ id: 'e1', name: 'Bench press', sets: 3, reps: '8-12', rest: 120 }] }] }],
  targets: { kcal: 2200, protein: 150, carbs: 220, fat: 70, goal: 'cut', targetWeight: 155, unit: 'lb' },
} });

test('a workspace saved before the Health page validates unchanged', () => {
  const older = base();
  assert.strictEqual(validateWorkspace(older), older);
  const withBoard = { ...base(), board: { view: 'board', columns: [{ id: 'todo', name: 'To do' }], cards: [] }, profile: { name: 'Sam', avatar: 'S', color: 'accent' } };
  assert.strictEqual(validateWorkspace(withBoard), withBoard);
});

test('a workspace with every Health field validates, and one without targets too', () => {
  const full = filled();
  assert.strictEqual(validateWorkspace(full), full);
  delete full.health.targets;
  assert.strictEqual(validateWorkspace(full), full);
});

test('Health fields are bounded', () => {
  const bad = change => { const w = filled(); change(w.health); return () => validateWorkspace(w); };
  assert.throws(bad(h => { h.meals[0].items[0].grams = 20000; }), /health\.meals\[0\]\.items\[0\]\.grams must be a number from 0 to 10000/);
  assert.throws(bad(h => { h.meals[0].items[0].source = 'web'; }), /items\[0\]\.source must be one of/);
  assert.throws(bad(h => { h.meals[0].day = '2026-02-30'; }), /health\.meals\[0\]\.day must be a real calendar date/);
  assert.throws(bad(h => { h.workouts[0].sets[0].reps = 8.5; }), /sets\[0\]\.reps must be a whole number/);
  assert.throws(bad(h => { h.workouts[0].sets[0].weight = -5; }), /sets\[0\]\.weight must be a number from 0 to 2000/);
  assert.throws(bad(h => { h.workouts[1].effort = 'brutal'; }), /workouts\[1\]\.effort must be one of/);
  assert.throws(bad(h => { h.weights[0].unit = 'stone'; }), /weights\[0\]\.unit must be one of: lb, kg/);
  assert.throws(bad(h => { h.foods[0].per100g.fat = 120; }), /foods\[0\]\.per100g\.fat must be a number from 0 to 100/);
  assert.throws(bad(h => { h.regimes[0].days[0].exercises[0].reps = 'lots'; }), /exercises\[0\]\.reps must be a count or a range like 8-12/);
  assert.throws(bad(h => { h.targets.goal = 'recomp'; }), /health\.targets\.goal must be one of: cut, maintain, bulk/);
  assert.throws(bad(h => { h.meals = {}; }), /health\.meals must be an array/);
});

// ---- the parse route ----
const good = { meals: [{ meal: 'breakfast', items: [{ name: 'scrambled eggs', quantity: 2, unit: 'large', grams: 120, kind: 'generic', usdaQuery: 'egg whole cooked scrambled', estimate: { kcal: 180, protein: 12, carbs: 2, fat: 13 } }, { name: 'toast', quantity: 1, unit: 'slice', grams: 30, kind: 'generic', usdaQuery: null, estimate: { kcal: 80, protein: 3, carbs: 15, fat: 1 } }] }],
  workouts: [{ exercise: 'bench press', kind: 'strength', sets: [{ reps: 8, weight: 135, unit: 'lb' }, { reps: 8, weight: 135, unit: 'lb' }, { reps: 8, weight: 135, unit: 'lb' }], distance: null }, { exercise: 'run', kind: 'cardio', distance: 2, distanceUnit: 'mi', minutes: 18 }],
  bodyweight: { weight: 162, unit: 'lb' }, extra: 'dropped' };
function fakeChat(text) { const seen = []; health.deps.chat = async body => { seen.push(body); return { text, provider: body.provider, model: body.model }; }; return seen; }

test('parse sends the text to the provider with a key and returns the checked structure', async () => {
  const seen = fakeChat('Here you go:\n```json\n' + JSON.stringify(good) + '\n```');
  const reply = await call('health/parse', { text: '2 eggs and toast; bench 3x8 at 135, ran 2 miles in 18 min; weighed 162', today: '2026-09-28', provider: 'claude', model: 'claude-opus-5-5' });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  // Claude has no key in this test, so the first provider that does is used, with its default model.
  assert.equal(reply.body.provider, 'openai');
  assert.equal(seen[0].provider, 'openai');
  assert.match(seen[0].messages[0].content, /Today is 2026-09-28\.[\s\S]*bench 3x8 at 135/);
  const parsed = reply.body.parsed;
  assert.deepEqual(Object.keys(parsed).sort(), ['bodyweight', 'meals', 'workouts']);
  assert.equal(parsed.meals[0].items.length, 2);
  assert.equal(parsed.meals[0].items[1].usdaQuery, undefined, 'a null reads as absent');
  assert.equal(parsed.workouts[0].sets.length, 3);
  assert.equal(parsed.workouts[0].distance, undefined);
  assert.deepEqual(parsed.workouts[1], { exercise: 'run', kind: 'cardio', distance: 2, distanceUnit: 'mi', minutes: 18 });
  assert.deepEqual(parsed.bodyweight, { weight: 162, unit: 'lb' });
});

test('parse refuses a malformed model answer with a 502 and says what was wrong', async () => {
  const cases = [
    ['I cannot help with that.', /did not answer with JSON/],
    ['{"meals": [ {"meal": "brunch", ', /broken JSON|did not answer/],
    [JSON.stringify({ ...good, meals: [{ meal: 'brunch', items: good.meals[0].items }] }), /meals\[0\]\.meal must be one of/],
    [JSON.stringify({ ...good, meals: [{ meal: 'lunch', items: [{ ...good.meals[0].items[0], grams: 'lots' }] }] }), /items\[0\]\.grams must be a number/],
    [JSON.stringify({ ...good, workouts: [{ exercise: 'squat', kind: 'strength', sets: [] }] }), /lift with no sets/],
    [JSON.stringify({ ...good, workouts: [{ exercise: 'row', kind: 'strength', sets: [{ reps: 8, weight: 100, unit: 'stone' }] }] }), /sets\[0\]\.unit must be one of lb, kg/],
    [JSON.stringify([good]), /must be a JSON object|did not answer/],
  ];
  for (const [answer, reason] of cases) {
    fakeChat(answer);
    const reply = await call('health/parse', { text: 'lunch', today: '2026-09-28' });
    assert.equal(reply.status, 502, answer);
    assert.match(reply.body.error, reason);
  }
});

test('parse is local only, checks the origin, and needs text', async () => {
  fakeChat(JSON.stringify(good));
  assert.equal((await call('health/parse', { text: 'x' }, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await call('health/parse', { text: 'x' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  process.env.APP_ACCESS_TOKEN = 'hosted-token';
  try { assert.equal((await call('health/parse', { text: 'x' }, { authorization: 'Bearer hosted-token' }, false)).status, 404); }
  finally { delete process.env.APP_ACCESS_TOKEN; }
  assert.equal((await call('health/parse', { text: '   ' })).status, 400);
});

// ---- the lookup ladder ----
const egg = { name: 'scrambled eggs', quantity: 2, unit: 'large', grams: 120, kind: 'generic', usdaQuery: 'egg whole cooked scrambled', estimate: { kcal: 180, protein: 12, carbs: 2, fat: 13 } };
function fakeFetch(answer = () => ({ ok: true, status: 200, json: async () => recorded })) { const urls = []; health.deps.fetch = async url => { urls.push(String(url)); return answer(); }; return urls; }

test('the ladder asks his own foods first, and never calls USDA for one', async () => {
  const urls = fakeFetch();
  const known = [{ id: 'f1', name: 'Scrambled egg', per100g: { kcal: 160, protein: 11, carbs: 1, fat: 12 }, unit: 'large', unitGrams: 55 }];
  const { items } = (await call('health/resolve', { items: [egg], known })).body;
  assert.equal(urls.length, 0);
  // "2 large" in his own unit: 2 x 55 g, not the model's 120 g.
  assert.deepEqual(items[0], { name: 'scrambled eggs', quantity: 2, unit: 'large', grams: 110, kcal: 176, protein: 12.1, carbs: 1.1, fat: 13.2, source: 'known' });
});

test('then USDA, from the recorded search, cached on disk under the profile', async () => {
  const urls = fakeFetch();
  const first = (await call('health/resolve', { items: [egg], known: [] })).body;
  assert.equal(urls.length, 1);
  assert.match(urls[0], /api\.nal\.usda\.gov\/fdc\/v1\/foods\/search\?api_key=DEMO_KEY&query=egg\+whole\+cooked\+scrambled&dataType=Foundation%2CSR\+Legacy/);
  assert.equal(first.usda.key, 'demo');
  assert.deepEqual(first.items[0], { name: 'scrambled eggs', quantity: 2, unit: 'large', grams: 120, kcal: 180, protein: 12, carbs: 2.4, fat: 13.2, source: 'usda', fdcId: 900001, usdaName: 'Egg, whole, cooked, scrambled' });
  assert.ok(health.usdaCacheFile().startsWith(home));
  assert.ok(fs.existsSync(health.usdaCacheFile()));
  const again = (await call('health/resolve', { items: [egg], known: [] })).body;
  assert.equal(urls.length, 1, 'the second lookup is answered from the cache');
  assert.equal(again.items[0].fdcId, 900001);
});

test('the picker weighs the model\'s numbers, drops another form of the food, and prefers the plainer name', () => {
  const foods = recorded.foods.map(f => ({ fdcId: f.fdcId, description: f.description, per100g: { kcal: f.foodNutrients[0].value, protein: 0, carbs: 0, fat: 0 } }));
  assert.equal(health.pickFood('egg whole cooked', foods, { kcal: 140, protein: 12, carbs: 1, fat: 10 }, 100).fdcId, 900002);
  assert.equal(health.pickFood('egg whole cooked', foods, null, 100).fdcId, 900001);
  assert.equal(health.pickFood('egg whole cooked powder', foods, { kcal: 150, protein: 10, carbs: 2, fat: 11 }, 100), null, 'powder at 590 kcal per 100 g is not a 150 kcal egg');
  assert.equal(health.pickFood('banana', foods, null, 100), null);
});

test('a brand or a dish, a USDA refusal, and no match each fall to the model\'s guess', async () => {
  let urls = fakeFetch();
  const bar = { name: 'protein bar', grams: 60, kind: 'packaged', estimate: { kcal: 210, protein: 20, carbs: 22, fat: 7 } };
  const { items } = (await call('health/resolve', { items: [bar], known: [] })).body;
  assert.equal(urls.length, 0);
  assert.equal(items[0].source, 'guessed');
  assert.equal(items[0].kcal, 210);

  urls = fakeFetch(() => ({ ok: false, status: 429, json: async () => ({}) }));
  const oats = { name: 'oatmeal', grams: 240, kind: 'generic', usdaQuery: 'oats cooked', estimate: { kcal: 150, protein: 5, carbs: 27, fat: 3 } };
  const rice = { name: 'rice', grams: 150, kind: 'generic', usdaQuery: 'rice white cooked', estimate: { kcal: 195, protein: 4, carbs: 42, fat: 0.4 } };
  const limited = (await call('health/resolve', { items: [oats, rice], known: [] })).body;
  assert.equal(urls.length, 1, 'after one refusal the rest skip USDA');
  assert.deepEqual(limited.items.map(i => i.source), ['guessed', 'guessed']);
  assert.match(limited.usda.note, /DEMO_KEY.*FDC_API_KEY.*api\.data\.gov\/signup/);

  fakeFetch(() => ({ ok: true, status: 200, json: async () => ({ foods: [] }) }));
  const typed = (await call('health/resolve', { items: [{ name: 'mystery stew', grams: 300 }], known: [] })).body;
  assert.equal(typed.items[0].found, false);
  assert.equal(typed.items[0].kcal, 0);
});

test('resolve refuses a bad request', async () => {
  assert.equal((await call('health/resolve', { items: [] })).status, 400);
  assert.equal((await call('health/resolve', { items: [{ name: 'egg', grams: -1 }] })).status, 400);
  assert.equal((await call('health/resolve', { items: [{ grams: 10 }] })).status, 400);
});

test('review sends the summary to the chat model and returns its text', async () => {
  const seen = fakeChat('- Add a second pull day.');
  const reply = await call('health/review', { summary: 'Regime "PPL": Push: Bench press 3x8-12' });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.text, '- Add a second pull day.');
  assert.match(seen[0].messages[0].content, /not giving medical advice[\s\S]*Bench press 3x8-12/);
});
