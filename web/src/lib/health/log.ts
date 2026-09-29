// From a brain dump to saved rows. The server parses the text (POST /api/health/parse) and runs the lookup
// ladder (POST /api/health/resolve); this file holds the shapes those answer in, the draft the preview lets
// him correct, and applyDraft, which files the corrected draft into the workspace. Also the sets shorthand
// the preview and quick add both use: "8@135, 8@135, 7@135", or "3x8@135" for three alike.
import type { FoodSource, Health, HealthFood, HealthWorkout, LiftSet, MacroSet, MealName, WeightUnit } from '../../types';
import { knownFromItem, rememberFood } from './nutrition';

export type ParsedFood = { name: string; quantity?: number; unit?: string; grams: number; kind?: 'generic' | 'packaged' | 'dish'; usdaQuery?: string; estimate?: MacroSet };
export type ParsedWorkout = Omit<HealthWorkout, 'id' | 'day'>;
export type Parsed = { day?: string; meals: { meal: MealName; items: ParsedFood[] }[]; workouts: ParsedWorkout[]; bodyweight: { weight: number; unit: WeightUnit } | null };
// found is false only when a manual lookup matched nothing and there was no estimate to fall back on.
export type ResolvedFood = MacroSet & { name: string; grams: number; quantity?: number; unit?: string; source: FoodSource; fdcId?: number; usdaName?: string; found?: boolean };
export type Resolved = { items: ResolvedFood[]; usda: { key: 'own' | 'demo'; note: string } };

// base is the row as the ladder gave it: changing grams rescales from it, so clearing the field on the way to a
// new number does not zero the macros for good.
export type DraftFood = ResolvedFood & { key: string; meal: MealName; remember: boolean; base: MacroSet & { grams: number } };
export type DraftWorkout = ParsedWorkout & { key: string };
export type Draft = { day: string; foods: DraftFood[]; workouts: DraftWorkout[]; bodyweight: { weight: number; unit: WeightUnit } | null; note: string };

// The parse and the ladder's rows, zipped back together in order. When the ladder could not run (the server
// is down, say), each food keeps the model's estimate and says it was guessed.
export function draftFrom(parsed: Parsed, resolved: Resolved | null, today: string, makeId: () => string): Draft {
  const flat = parsed.meals.flatMap(m => m.items.map(item => ({ meal: m.meal, item })));
  const foods = flat.map(({ meal, item }, i): DraftFood => {
    const row: ResolvedFood = resolved?.items[i] ?? { name: item.name, quantity: item.quantity, unit: item.unit, grams: item.grams, ...(item.estimate ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 }), source: 'guessed' };
    return { ...row, key: makeId(), meal, remember: false, base: { grams: row.grams, kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat } };
  });
  const note = resolved ? resolved.usda.note : 'Nutrition lookup was unavailable, so every food is the model\'s guess.';
  return { day: parsed.day ?? today, foods, workouts: parsed.workouts.map(w => ({ ...w, key: makeId() })), bodyweight: parsed.bodyweight, note };
}

const food = (f: DraftFood, id: string): HealthFood => ({ id, name: f.name.trim(), grams: f.grams, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, source: f.source,
  ...(f.quantity !== undefined ? { quantity: f.quantity } : {}), ...(f.unit ? { unit: f.unit } : {}), ...(f.fdcId !== undefined && f.source === 'usda' ? { fdcId: f.fdcId } : {}) });

// Foods join that day's meal of the same name when there is one, so two captures of lunch are one lunch.
// Rows ticked Remember become his own foods, which the ladder asks first next time.
export function applyDraft(health: Health, draft: Draft, makeId: () => string): Health {
  let meals = health.meals;
  let foods = health.foods;
  for (const f of draft.foods) {
    const item = food(f, makeId());
    const existing = meals.find(m => m.day === draft.day && m.meal === f.meal);
    meals = existing ? meals.map(m => m === existing ? { ...m, items: [...m.items, item] } : m) : [...meals, { id: makeId(), day: draft.day, meal: f.meal, items: [item] }];
    if (f.remember) { const known = knownFromItem(item, makeId()); if (known) foods = rememberFood(foods, known); }
  }
  const workouts = [...health.workouts, ...draft.workouts.map(({ key: _key, ...w }) => ({ ...w, id: makeId(), day: draft.day }))];
  const weights = draft.bodyweight ? [...health.weights, { id: makeId(), day: draft.day, ...draft.bodyweight }] : health.weights;
  return { ...health, meals, foods, workouts, weights };
}

export const setsToText = (sets: LiftSet[]) => sets.map(s => `${s.reps}@${s.weight}`).join(', ');
// "8@135, 3x8@135" -> sets, or null when any piece is not a count of reps at a weight.
export function parseSetsText(text: string, unit: WeightUnit): LiftSet[] | null {
  const pieces = text.split(/[,;]+/).map(p => p.trim()).filter(Boolean);
  const sets: LiftSet[] = [];
  for (const piece of pieces) {
    const match = /^(?:(\d+)\s*x\s*)?(\d+)\s*@\s*(\d+(?:\.\d+)?)$/i.exec(piece);
    if (!match) return null;
    const count = Number(match[1] ?? 1), reps = Number(match[2]), weight = Number(match[3]);
    if (count < 1 || count > 20 || reps > 1000 || weight > 2000) return null;
    for (let i = 0; i < count; i++) sets.push({ reps, weight, unit });
  }
  return sets.length && sets.length <= 50 ? sets : null;
}
// How a lift reads in a list: "3 x 8 @ 135 lb" when every set is alike, else each set.
export function formatSets(sets: LiftSet[]): string {
  if (!sets.length) return '';
  const unit = sets[0].unit;
  return sets.every(s => s.reps === sets[0].reps && s.weight === sets[0].weight) ? `${sets.length} x ${sets[0].reps} @ ${sets[0].weight} ${unit}` : `${sets.map(s => `${s.reps} @ ${s.weight}`).join(', ')} ${unit}`;
}
