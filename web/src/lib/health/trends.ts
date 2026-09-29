// Trends on the Health page, with no React in it: bodyweight with a 7-day moving average, strength as the
// estimated one-rep max (Epley) of the best set each session, cardio pace, and each trend said in words.
import type { BodyWeight, HealthWorkout, LiftSet, WeightUnit } from '../../types';
import { addDays } from './nutrition';

export const LB_PER_KG = 2.20462;
export const KM_PER_MI = 1.60934;
export const toUnit = (value: number, from: WeightUnit, to: WeightUnit) => from === to ? value : from === 'kg' ? value * LB_PER_KG : value / LB_PER_KG;

// Epley's estimate of the most one rep could lift, from a set of `reps` at `weight`: weight x (1 + reps / 30).
// A single is its own one-rep max, so one rep returns the weight itself rather than 1/30 more.
export function epley(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}
export const bestE1rm = (sets: LiftSet[], unit: WeightUnit) => Math.max(0, ...sets.map(s => epley(toUnit(s.weight, s.unit, unit), s.reps)));

export type Point = { day: string; value: number };
const key = (name: string) => name.trim().toLowerCase();
const byDay = (a: { day: string }, b: { day: string }) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0;

// The exercises he has logged of one kind, most recent first, named as he last wrote them.
export function exercisesOf(workouts: HealthWorkout[], kind: HealthWorkout['kind']): string[] {
  const seen = new Map<string, string>();
  for (const w of [...workouts].sort(byDay).reverse()) if (w.kind === kind && !seen.has(key(w.exercise))) seen.set(key(w.exercise), w.exercise.trim());
  return [...seen.values()];
}
// One exercise's sessions: a day with several rows of it (two entries of bench) counts once, sets merged.
export function sessionsOf(workouts: HealthWorkout[], exercise: string): HealthWorkout[] {
  const days = new Map<string, HealthWorkout>();
  for (const w of workouts.filter(w => key(w.exercise) === key(exercise)).sort(byDay)) {
    const had = days.get(w.day);
    days.set(w.day, had ? { ...had, sets: [...(had.sets || []), ...(w.sets || [])], distance: w.distance ?? had.distance, minutes: w.minutes ?? had.minutes, effort: w.effort ?? had.effort } : w);
  }
  return [...days.values()];
}

export function strengthSeries(workouts: HealthWorkout[], exercise: string, unit: WeightUnit): Point[] {
  return sessionsOf(workouts, exercise).filter(s => s.sets?.length).map(s => ({ day: s.day, value: Math.round(bestE1rm(s.sets!, unit) * 10) / 10 })).filter(p => p.value > 0);
}
// Minutes per mile (or per km). A session needs both a distance and a time to have a pace.
export function paceSeries(workouts: HealthWorkout[], exercise: string, per: 'mi' | 'km'): Point[] {
  return sessionsOf(workouts, exercise).filter(s => s.distance && s.minutes).map(s => {
    const distance = s.distanceUnit === per ? s.distance! : s.distanceUnit === 'km' ? s.distance! / KM_PER_MI : s.distance! * KM_PER_MI;
    return { day: s.day, value: Math.round((s.minutes! / distance) * 100) / 100 };
  });
}
// The last weigh-in of each day, in one unit.
export function weightSeries(weights: BodyWeight[], unit: WeightUnit): Point[] {
  const days = new Map<string, number>();
  for (const w of [...weights].sort(byDay)) days.set(w.day, Math.round(toUnit(w.weight, w.unit, unit) * 10) / 10);
  return [...days].map(([day, value]) => ({ day, value }));
}
// Each point's average with every point in the six days before it: a weigh-in's day-to-day water swing
// hides the trend, and the average shows it.
export function movingAverage(points: Point[], days = 7): Point[] {
  return points.map(p => {
    const from = addDays(p.day, -(days - 1));
    const window = points.filter(q => q.day >= from && q.day <= p.day);
    return { day: p.day, value: Math.round(window.reduce((s, q) => s + q.value, 0) / window.length * 10) / 10 };
  });
}

// A trend in words: the latest value against the value `weeks` weeks ago (the last one on or before that day,
// or the first after it when the record is younger). Under 1.5% either way is flat, about the noise in a
// logged set or a weigh-in. For pace lower is better, so it reads faster and slower instead of down and up.
export type Trend = { direction: 'up' | 'down' | 'flat' | 'none'; percent: number; words: string };
export function trendWords(points: Point[], today: string, weeks = 4, lowerIsBetter = false): Trend {
  const start = addDays(today, -7 * weeks);
  const last = points.at(-1);
  const base = [...points].reverse().find(p => p.day <= start) ?? points.find(p => p.day > start);
  if (!last || !base || base === last || base.value <= 0) return { direction: 'none', percent: 0, words: 'not enough sessions yet' };
  const percent = Math.round(((last.value - base.value) / base.value) * 1000) / 10;
  const days = Math.round((Date.parse(last.day) - Date.parse(base.day)) / 86400000);
  const span = base.day <= start ? `${weeks} weeks` : days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} ${days === 1 ? 'day' : 'days'}`;
  if (Math.abs(percent) < 1.5) return { direction: 'flat', percent, words: `flat over ${span}` };
  const direction = percent > 0 ? 'up' : 'down';
  const word = lowerIsBetter ? (percent < 0 ? 'faster' : 'slower') : direction;
  return { direction, percent, words: `${word} ${Math.abs(percent)}% over ${span}` };
}
