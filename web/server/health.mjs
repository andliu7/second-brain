// The Health page's server half: the three things the browser cannot do by itself.
//
//   POST /api/health/parse    { text, today, unit?, provider?, model? }  a brain dump ("2 eggs and toast; bench 3x8
//                             at 135; weighed 162") sent to the chat model with a strict JSON prompt; the answer is
//                             checked by validateParsed before it is returned, so a malformed one is a 502, never a
//                             half-right preview
//   POST /api/health/resolve  { items, known }  the nutrition lookup ladder for each food: his own foods (known, sent
//                             by the browser, since the workspace lives there), then USDA FoodData Central, then the
//                             model's estimate, flagged as guessed
//   POST /api/health/review   { summary, provider?, model? }  a compact regime summary to the chat model for suggestions
//
// Ported from the dashboard repo's src/capture (parse-schema.ts, ladder.ts, usda.ts): same ladder, same "generic foods
// only go to USDA" rule, and a simpler picker (below). Local only: api.mjs sends a hosted request a 404 before it
// gets here, after the same origin and Host check as every other route.
//
// USDA answers are cached in ~/.brain/usda-cache.json, under the user profile and outside the repository, which is
// public. The key is FDC_API_KEY, falling back to api.data.gov's DEMO_KEY, which allows only a handful of calls an
// hour (on 2026-09-14 it gave about 10, then a 429 for 16 hours); a free key comes from https://api.data.gov/signup.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chat, providerKey, defaultModels } from './providers.mjs';
import { storedKey } from './keys.mjs';

// The chat call and fetch are looked up through this object on every request, so a test can swap in a fake
// provider or a recorded USDA response without a network call.
export const deps = { chat, fetch: (...args) => fetch(...args) };
export const usdaCacheFile = () => path.join(os.homedir(), '.brain', 'usda-cache.json');
// A key saved in Settings first (server/keys.mjs), then FDC_API_KEY from the environment.
export const usdaKey = () => storedKey('usda') || process.env.FDC_API_KEY || 'DEMO_KEY';

class HttpError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (message, status) => { throw new HttpError(message, status); };
function send(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }

// Model calls cost money, so parse and review share the chat route's ceiling: 12 a minute.
let calls = { start: 0, count: 0 };
function limit() {
  const time = Date.now();
  if (time - calls.start >= 60000) calls = { start: time, count: 0 };
  if (++calls.count > 12) fail('Please wait a minute before another request.', 429);
}

// The chat provider: the one asked for if it has a key, otherwise the first that does, in the order the
// Settings page lists them. Anthropic can be out of credit while OpenAI works, so the page lets him choose.
const CHAT = ['claude', 'openai', 'gemini'];
function pickProvider(body) {
  const asked = CHAT.includes(body?.provider) && providerKey(body.provider) ? body.provider : null;
  const provider = asked || CHAT.find(p => providerKey(p));
  if (!provider) fail('Add a chat provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY) to use AI here. Quick add works without one.');
  const model = asked && typeof body.model === 'string' && body.model.trim() ? body.model.trim() : defaultModels[provider];
  return { provider, model };
}

// ---- parse ----

const prompt = unit => `Turn the health log below into JSON. Reply with one JSON object and nothing else: no prose, no code fence.
Shape:
{"day": "YYYY-MM-DD", only when the log names another day such as "yesterday", otherwise leave it out,
 "meals": [{"meal": "breakfast" | "lunch" | "dinner" | "snack",
   "items": [{"name": "scrambled eggs", "quantity": 2, "unit": "large", "grams": 100, "kind": "generic" | "packaged" | "dish",
     "usdaQuery": "egg whole cooked scrambled", "estimate": {"kcal": 180, "protein": 12, "carbs": 2, "fat": 14}}]}],
 "workouts": [{"exercise": "bench press", "kind": "strength", "sets": [{"reps": 8, "weight": 135, "unit": "${unit}"}]},
   {"exercise": "run", "kind": "cardio", "distance": 2, "distanceUnit": "mi", "minutes": 18, "effort": "easy" | "moderate" | "hard"}],
 "bodyweight": {"weight": 162, "unit": "${unit}"} or null}
Rules:
- One entry in sets per set: "3x8 at 135" is three sets of 8 reps at 135. A bodyweight exercise has weight 0.
- grams is your best estimate of the portion's weight; estimate is your best estimate of that portion's kcal, and its protein, carbs and fat in grams.
- kind is generic for a plain food (egg, rice, banana, milk), packaged for a brand or product, dish for a mixed dish. usdaQuery only for generic foods, worded as USDA FoodData Central names foods.
- Weight units are lb or kg; when none is said use ${unit}. Distance units are mi or km. effort only when the log says how it felt.
- When the meal is not said, choose it from the food. Use [] for a section the log does not mention.`;

// The answer's JSON, from a reply that may still wrap it in a code fence or a sentence despite the prompt.
// The whole reply is tried first, so an answer that is JSON but not an object (a list) is refused by
// validateParsed rather than having an object fished out of it.
export function extractJson(text) {
  try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* prose around it: take the outermost braces */ }
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) fail('The model did not answer with JSON. Try again, or use Quick add.', 502);
  try { return JSON.parse(text.slice(start, end + 1)); } catch { fail('The model answered with broken JSON. Try again, or use Quick add.', 502); }
}

// Every field of the model's answer, checked and copied: anything else it sent is dropped, a null reads as
// absent, and one wrong value refuses the whole answer (502) rather than previewing a half-right day.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null;
function num(value, where, max, { integer = false, optional = false } = {}) {
  if (optional && !present(value)) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) fail(`${where} must be a number from 0 to ${max}.`, 502);
  return value;
}
function str(value, where, max, { optional = false } = {}) {
  if (optional && !present(value)) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${where} must be text of at most ${max} characters.`, 502);
  return value.trim();
}
function choice(value, where, choices, { optional = false } = {}) {
  if (optional && !present(value)) return undefined;
  if (!choices.includes(value)) fail(`${where} must be one of ${choices.join(', ')}.`, 502);
  return value;
}
function list(value, where, max) {
  if (!present(value)) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${where} must be a list of at most ${max}.`, 502);
  return value;
}
const macrosOf = (value, where) => {
  if (!plain(value)) fail(`${where} must be an object.`, 502);
  return { kcal: num(value.kcal, `${where}.kcal`, 20000), protein: num(value.protein, `${where}.protein`, 2000), carbs: num(value.carbs, `${where}.carbs`, 2000), fat: num(value.fat, `${where}.fat`, 2000) };
};
const drop = object => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
export function validateParsed(value) {
  if (!plain(value)) fail('The model answer must be a JSON object.', 502);
  const day = value.day === undefined || value.day === null ? undefined : (typeof value.day === 'string' && DAY.test(value.day) ? value.day : fail('day must be YYYY-MM-DD.', 502));
  const meals = list(value.meals, 'meals', 10).map((meal, m) => {
    if (!plain(meal)) fail(`meals[${m}] must be an object.`, 502);
    const items = list(meal.items, `meals[${m}].items`, 40);
    if (!items.length) fail(`meals[${m}] has no items.`, 502);
    return { meal: choice(meal.meal, `meals[${m}].meal`, ['breakfast', 'lunch', 'dinner', 'snack']), items: items.map((item, i) => {
      const where = `meals[${m}].items[${i}]`;
      if (!plain(item)) fail(`${where} must be an object.`, 502);
      return drop({ name: str(item.name, `${where}.name`, 256), quantity: num(item.quantity, `${where}.quantity`, 10000, { optional: true }), unit: str(item.unit, `${where}.unit`, 32, { optional: true }),
        grams: num(item.grams, `${where}.grams`, 10000), kind: choice(item.kind, `${where}.kind`, ['generic', 'packaged', 'dish']),
        usdaQuery: str(item.usdaQuery, `${where}.usdaQuery`, 200, { optional: true }), estimate: macrosOf(item.estimate, `${where}.estimate`) });
    }) };
  });
  const workouts = list(value.workouts, 'workouts', 40).map((workout, w) => {
    const where = `workouts[${w}]`;
    if (!plain(workout)) fail(`${where} must be an object.`, 502);
    const kind = choice(workout.kind, `${where}.kind`, ['strength', 'cardio']);
    const sets = list(workout.sets, `${where}.sets`, 50).map((set, s) => {
      if (!plain(set)) fail(`${where}.sets[${s}] must be an object.`, 502);
      return { reps: num(set.reps, `${where}.sets[${s}].reps`, 1000, { integer: true }), weight: num(set.weight ?? 0, `${where}.sets[${s}].weight`, 2000), unit: choice(set.unit, `${where}.sets[${s}].unit`, ['lb', 'kg']) };
    });
    if (kind === 'strength' && !sets.length) fail(`${where} is a lift with no sets.`, 502);
    const out = drop({ exercise: str(workout.exercise, `${where}.exercise`, 128), kind, sets: kind === 'strength' ? sets : undefined,
      distance: num(workout.distance, `${where}.distance`, 1000, { optional: true }), distanceUnit: choice(workout.distanceUnit, `${where}.distanceUnit`, ['mi', 'km'], { optional: true }),
      minutes: num(workout.minutes, `${where}.minutes`, 2000, { optional: true }), effort: choice(workout.effort, `${where}.effort`, ['easy', 'moderate', 'hard'], { optional: true }) });
    if (kind === 'cardio' && out.distance === undefined && out.minutes === undefined) fail(`${where} is cardio with no distance or time.`, 502);
    if (out.distance !== undefined && !out.distanceUnit) out.distanceUnit = 'mi';
    return out;
  });
  let bodyweight = null;
  if (present(value.bodyweight)) {
    if (!plain(value.bodyweight)) fail('bodyweight must be an object or null.', 502);
    bodyweight = { weight: num(value.bodyweight.weight, 'bodyweight.weight', 1500), unit: choice(value.bodyweight.unit, 'bodyweight.unit', ['lb', 'kg']) };
    if (bodyweight.weight < 1) fail('bodyweight.weight must be at least 1.', 502);
  }
  return drop({ day, meals, workouts, bodyweight });
}

async function parse(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 4000) fail('Write between 1 and 4,000 characters.');
  const today = typeof body.today === 'string' && DAY.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const unit = body.unit === 'kg' ? 'kg' : 'lb';
  const { provider, model } = pickProvider(body);
  limit();
  const reply = await deps.chat({ provider, model, messages: [{ role: 'user', content: prompt(unit) + '\n\nToday is ' + today + '.\n\nLog:\n' + text }] });
  return { parsed: validateParsed(extractJson(String(reply?.text || ''))), provider, model };
}

// ---- the lookup ladder ----

// FoodData Central refused or could not be reached: the one failure the ladder rides out, falling to the
// model's estimate and saying why. Anything else (a changed response) throws, so it is seen.
class UsdaUnavailable extends Error {}
const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const ENERGY = [1008, 2048, 2047], PROTEIN = 1003, CARB = 1005, FAT = 1004; // nutrient ids; energy in kcal, SR Legacy first
const CACHE_DAYS = 90, CACHE_MAX = 2000;

// "Bananas, raw" -> ["banana", "raw"]: plurals folded so "eggs" meets "egg".
function words(text) {
  return String(text).toLowerCase().replace(/'s\b/g, '').split(/[^a-z0-9]+/).filter(Boolean)
    .map(w => w.endsWith('oes') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
}
const sameName = (a, b) => words(a).join(' ') === words(b).join(' ');

function per100g(nutrients) {
  const value = id => nutrients?.find(n => n.nutrientId === id)?.value;
  const kcal = ENERGY.map(value).find(v => typeof v === 'number');
  const [protein, carbs, fat] = [PROTEIN, CARB, FAT].map(value);
  if ([kcal, protein, carbs, fat].some(v => typeof v !== 'number')) return null;
  return { kcal, protein, carbs: Math.max(0, carbs), fat }; // carbohydrate by difference can come out a hair below 0
}

async function loadCache() { try { const data = JSON.parse(await fs.readFile(usdaCacheFile(), 'utf8')); return plain(data) ? data : {}; } catch { return {}; } }
async function saveCache(cache) {
  const keys = Object.keys(cache);
  for (const key of keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, Math.max(0, keys.length - CACHE_MAX))) delete cache[key];
  const file = usdaCacheFile(), temp = file + '.' + process.pid + '.tmp';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(cache));
  await fs.rename(temp, file);
}

// One search, Foundation and SR Legacy only (lab-measured generic foods; Branded would match a product by name).
// Only the fields the picker reads are kept, in the cache and in memory.
export async function searchUsda(query) {
  const key = words(query).join(' ');
  const cache = await loadCache();
  if (cache[key] && Date.now() - cache[key].at < CACHE_DAYS * 86400000) return cache[key].foods;
  const url = new URL(SEARCH_URL);
  url.search = new URLSearchParams({ api_key: usdaKey(), query, dataType: 'Foundation,SR Legacy', pageSize: '10' }).toString();
  const response = await deps.fetch(url, { signal: AbortSignal.timeout(15000) }).catch(error => { throw new UsdaUnavailable('FoodData Central could not be reached (' + String(error?.message || error) + ').'); });
  if (response.status === 429) throw new UsdaUnavailable(usdaKey() === 'DEMO_KEY' ? 'USDA\'s shared DEMO_KEY is out of lookups for now; set FDC_API_KEY (free at api.data.gov/signup).' : 'USDA rate limit reached; try again later.');
  if (!response.ok) throw new UsdaUnavailable('FoodData Central answered HTTP ' + response.status + '.');
  const data = await response.json();
  if (!plain(data) || !Array.isArray(data.foods)) throw new Error('FoodData Central sent an unexpected search response.');
  const foods = data.foods.flatMap(food => { const numbers = per100g(food.foodNutrients); return numbers && typeof food.fdcId === 'number' ? [{ fdcId: food.fdcId, description: String(food.description), per100g: numbers }] : []; });
  cache[key] = { at: Date.now(), foods };
  await saveCache(cache);
  return foods;
}

// Chooses one entry, never just the first hit. Simpler than the dashboard's picker: an entry must contain every
// word of the query; with the model's estimate, an entry more than twice or under half its calories per gram is
// another form of the food (dried, powdered) and is dropped, and the nearest in calories wins; each word the
// entry adds beyond the query costs a little, so "Egg, whole, cooked" beats "Egg, whole, cooked, fried, in oil".
export function pickFood(query, foods, estimate, grams) {
  const wanted = words(query);
  const own = estimate && grams > 0 ? (100 * estimate.kcal) / grams : null;
  const ranked = foods.flatMap(food => {
    const described = words(food.description);
    if (!wanted.every(w => described.includes(w))) return [];
    if (own !== null && own > 0 && (food.per100g.kcal < own / 2 || food.per100g.kcal > own * 2)) return [];
    const extra = new Set(described.filter(w => !wanted.includes(w))).size;
    return [{ food, cost: (own ? Math.abs(food.per100g.kcal - own) / own : 0) + 0.05 * extra }];
  });
  return ranked.sort((a, b) => a.cost - b.cost)[0]?.food ?? null;
}

const WEIGHT_GRAMS = { g: 1, gram: 1, kg: 1000, kilogram: 1000, oz: 28.3495, ounce: 28.3495, lb: 453.592, pound: 453.592 };
const gramsPer = (table, unit) => { const u = String(unit).trim().toLowerCase(); return table[u] ?? table[u.replace(/s$/, '')] ?? table[u.replace(/es$/, '')]; };
const round1 = n => Math.round(n * 10) / 10;
const scale = (per, grams) => ({ kcal: Math.round(per.kcal * grams / 100), protein: round1(per.protein * grams / 100), carbs: round1(per.carbs * grams / 100), fat: round1(per.fat * grams / 100) });

// Grams said out loud (g, oz, lb) are exact; his own unit ("2 slices") is weighed by his own food's unitGrams;
// anything else is the weight the model or he estimated.
function portion(item, food) {
  const weight = item.unit ? gramsPer(WEIGHT_GRAMS, item.unit) : undefined;
  if (weight !== undefined && item.quantity !== undefined) return item.quantity * weight;
  if (food?.unitGrams && (!item.unit || (food.unit && gramsPer({ [food.unit.toLowerCase()]: 1 }, item.unit)))) return (item.quantity ?? 1) * food.unitGrams;
  return item.grams;
}

function checkItems(body) {
  const items = Array.isArray(body?.items) && body.items.length >= 1 && body.items.length <= 60 ? body.items : fail('Send 1 to 60 food items.');
  const known = Array.isArray(body.known) && body.known.length <= 5000 ? body.known : [];
  for (const [i, item] of items.entries()) {
    if (!plain(item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 256) fail(`items[${i}].name must be text.`);
    if (typeof item.grams !== 'number' || !Number.isFinite(item.grams) || item.grams < 0 || item.grams > 10000) fail(`items[${i}].grams must be a number from 0 to 10000.`);
    if (item.estimate !== undefined) macrosOf(item.estimate, `items[${i}].estimate`);
  }
  return { items, known: known.filter(f => plain(f) && typeof f.name === 'string' && plain(f.per100g) && ['kcal', 'protein', 'carbs', 'fat'].every(k => typeof f.per100g[k] === 'number')) };
}

// Each item goes down the ladder until a rung knows it. Returns rows ready for the day's table, plus a note
// when USDA was skipped (rate limit, network), so the page can say why rows are guessed.
export async function resolveItems(items, known) {
  const usda = { key: usdaKey() === 'DEMO_KEY' ? 'demo' : 'own', note: '' };
  const rows = [];
  for (const item of items) {
    const said = drop({ name: item.name.trim(), quantity: item.quantity, unit: item.unit });
    const mine = known.find(f => sameName(f.name, item.name));
    if (mine) { const grams = portion(item, mine); rows.push({ ...said, grams: Math.round(grams), ...scale(mine.per100g, grams), source: 'known' }); continue; }
    // Only a generic food is asked of USDA: a brand or a mixed dish would only match some other food by name,
    // and a confident wrong number is worse than an honest guess. After one refusal the rest skip USDA too.
    if (item.kind !== 'packaged' && item.kind !== 'dish' && !usda.note) {
      try {
        const query = item.usdaQuery || item.name;
        const food = pickFood(query, await searchUsda(query), item.estimate, item.grams);
        if (food) { const grams = portion(item, null); rows.push({ ...said, grams: Math.round(grams), ...scale(food.per100g, grams), source: 'usda', fdcId: food.fdcId, usdaName: food.description }); continue; }
      } catch (error) { if (!(error instanceof UsdaUnavailable)) throw error; usda.note = error.message; }
    }
    if (item.estimate) rows.push({ ...said, grams: Math.round(item.grams), kcal: Math.round(item.estimate.kcal), protein: round1(item.estimate.protein), carbs: round1(item.estimate.carbs), fat: round1(item.estimate.fat), source: 'guessed' });
    else rows.push({ ...said, grams: Math.round(item.grams), kcal: 0, protein: 0, carbs: 0, fat: 0, source: 'manual', found: false });
  }
  return { items: rows, usda };
}

// ---- regime review ----

async function review(body) {
  const summary = typeof body?.summary === 'string' ? body.summary.trim() : '';
  if (!summary || summary.length > 20000) fail('The summary must be 1 to 20,000 characters.');
  const { provider, model } = pickProvider(body);
  limit();
  const reply = await deps.chat({ provider, model, messages: [{ role: 'user', content: 'Below is a summary of my training regime, my recent sessions and my nutrition targets. Suggest at most six concrete changes to the regime (exercise choice, volume, rep ranges, rest, progression, recovery), each one line with its reason. Plain text bullets, no preamble. You are not giving medical advice; say so if anything needs a professional.\n\n' + summary }] });
  return { text: String(reply?.text || ''), provider, model };
}

export async function handleHealth(route, body, res) {
  try {
    if (route === 'health/parse') return send(res, 200, await parse(body));
    if (route === 'health/resolve') { const { items, known } = checkItems(body); return send(res, 200, await resolveItems(items, known)); }
    if (route === 'health/review') return send(res, 200, await review(body));
    return send(res, 404, { error: 'API route not found.' });
  } catch (error) {
    return send(res, error instanceof HttpError ? error.status : 400, { error: String(error?.message || 'Request failed.') });
  }
}
