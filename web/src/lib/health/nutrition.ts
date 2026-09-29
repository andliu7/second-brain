// The Health page's nutrition arithmetic, with no React in it: what a day's food adds up to, how that stands
// against the daily targets, the week's averages, and a corrected row turned into one of his own foods.
// Ported from the dashboard repo's src/features/food/food-day.ts; the tests check these numbers directly.
import type { Health, HealthFood, HealthMeal, HealthTargets, KnownFood, MacroSet, Workspace } from '../../types';

export const emptyHealth = (): Health => ({ meals: [], workouts: [], weights: [], foods: [], regimes: [] });
// A workspace saved before the Health page has no health; it reads as empty rather than crashing.
export const healthOf = (workspace: Workspace): Health => workspace.health ?? emptyHealth();

// The four numbers a day is read in, one list so the totals, the targets and the table columns keep one order.
export const MACROS = [
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
] as const;
export type MacroKey = (typeof MACROS)[number]['key'];

const round1 = (n: number) => Math.round(n * 10) / 10;
export const zero = (): MacroSet => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 });

export function totalsOf(items: MacroSet[]): MacroSet {
  const total = zero();
  for (const item of items) for (const { key } of MACROS) total[key] += item[key];
  return { kcal: Math.round(total.kcal), protein: round1(total.protein), carbs: round1(total.carbs), fat: round1(total.fat) };
}
export const itemsOn = (meals: HealthMeal[], day: string): HealthFood[] => meals.filter(m => m.day === day).flatMap(m => m.items);
export const dayTotals = (meals: HealthMeal[], day: string): MacroSet => totalsOf(itemsOn(meals, day));

// YYYY-MM-DD arithmetic in local time, the way the rest of the app names days (lib/storage.ts today()).
export function addDays(day: string, n: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Hit or miss per macro, in words. Protein is a floor: at least 90% of the target is a hit, and more is still
// a hit. Calories, carbs and fat are aims: within 10% either way is a hit, otherwise under or over by how much.
export type MacroStatus = { key: MacroKey; label: string; unit: string; total: number; target: number; share: number; status: 'hit' | 'under' | 'over'; words: string };
export function versusTargets(totals: MacroSet, targets: MacroSet): MacroStatus[] {
  return MACROS.map(({ key, label, unit }) => {
    const total = totals[key], target = targets[key];
    const share = target > 0 ? total / target : 0;
    const status = key === 'protein' ? (share >= 0.9 ? 'hit' : 'under') : share < 0.9 ? 'under' : share > 1.1 ? 'over' : 'hit';
    const gap = Math.abs(Math.round(target - total));
    const of = `${fmt(total)} of ${fmt(target)} ${unit}`;
    const words = status === 'hit' ? `${label}: hit, ${of}` : `${label}: ${gap} ${unit} ${status}, ${of}`;
    return { key, label, unit, total, target, share, status, words };
  });
}
const fmt = (n: number) => Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1);

// The average day over the last seven (today included), counting only days with food logged: an unlogged day
// is a gap in the record, not a day of fasting.
export function weeklyAverage(meals: HealthMeal[], today: string): { days: number; average: MacroSet } | null {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -i)).filter(day => itemsOn(meals, day).length);
  if (!days.length) return null;
  const sums = totalsOf(days.map(day => dayTotals(meals, day)));
  return { days: days.length, average: { kcal: Math.round(sums.kcal / days.length), protein: round1(sums.protein / days.length), carbs: round1(sums.carbs / days.length), fat: round1(sums.fat / days.length) } };
}

// A row's numbers per 100 g, which is how a known food is kept. A zero-gram row has none.
export function per100g(item: MacroSet & { grams: number }): MacroSet | null {
  if (!(item.grams > 0)) return null;
  const at = (n: number) => Math.round((n / item.grams) * 10000) / 100;
  return { kcal: at(item.kcal), protein: at(item.protein), carbs: at(item.carbs), fat: at(item.fat) };
}

const WEIGHT_UNITS = /^(g|grams?|kg|kilograms?|oz|ounces?|lbs?|pounds?)$/i;
const normal = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
// One of his own foods from a corrected row: its numbers per 100 g, and when the portion was in his own unit
// ("2 slices"), what one of those weighs, so the ladder weighs "3 slices" next time without asking a model.
export function knownFromItem(item: HealthFood, id: string): KnownFood | null {
  const per = per100g(item);
  if (!per) return null;
  const own = item.unit && !WEIGHT_UNITS.test(item.unit) && item.quantity && item.quantity > 0;
  return { id, name: item.name.trim(), per100g: per, ...(own ? { unit: item.unit!.replace(/s$/i, ''), unitGrams: Math.round(item.grams / item.quantity! * 10) / 10 } : {}) };
}
// Saving a food he already has replaces it, matched by name, so a second correction wins.
export const rememberFood = (foods: KnownFood[], food: KnownFood): KnownFood[] => [...foods.filter(f => normal(f.name) !== normal(food.name)), food];

export const defaultTargets = (): HealthTargets => ({ kcal: 2200, protein: 140, carbs: 250, fat: 70, goal: 'maintain', unit: 'lb' });
