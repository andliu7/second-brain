// Coaching on the Health page: plain rules first, so advice works with no AI key and can be checked by a test.
// The rules, per exercise:
//   Double progression. Every set reached the top of the rep range in each of the last two sessions: add weight
//     (5 lb, or 2.5 lb under 100 lb; 2.5 kg).
//   Reps falling. Total reps fell two sessions running without the weight going up: hold, or deload 10%.
//   Stall. No new best estimated 1RM in the last three sessions: a form cue, since a stall is often technique.
//   Cardio. Pace improved and it felt easy: add about 10% distance.
// The rep range comes from a saved regime that lists the exercise; without one it is assumed 8 to 12, and says so.
// regimeSummary is the compact text "Review my regime" sends to the chat model, which is optional on top.
import type { Health, HealthWorkout, LiftSet, Regime, WeightUnit } from '../../types';
import { bestE1rm, exercisesOf, paceSeries, sessionsOf, strengthSeries, trendWords, weightSeries, movingAverage, toUnit } from './trends';
import { addDays, weeklyAverage } from './nutrition';

export type Advice = { exercise: string; rule: 'progress' | 'deload' | 'form' | 'keep' | 'distance' | 'hold' | 'more'; text: string };

const key = (name: string) => name.trim().toLowerCase();
export function repRange(reps: string): { low: number; top: number } {
  const [a, b] = reps.split('-').map(Number);
  return { low: a, top: b ?? a };
}
// The rep range for an exercise from the first regime that lists it, or the assumed 8 to 12.
export function rangeFor(exercise: string, regimes: Regime[]): { low: number; top: number; assumed: boolean } {
  for (const regime of regimes) for (const day of regime.days) for (const e of day.exercises) if (key(e.name) === key(exercise)) return { ...repRange(e.reps), assumed: false };
  return { low: 8, top: 12, assumed: true };
}

const topSet = (sets: LiftSet[]) => sets.reduce((best, s) => s.weight > best.weight ? s : best, sets[0]);
const totalReps = (sets: LiftSet[]) => sets.reduce((sum, s) => sum + s.reps, 0);
const roundTo = (value: number, step: number) => Math.round(value / step) * step;
export const increment = (weight: number, unit: WeightUnit) => unit === 'kg' ? 2.5 : weight >= 100 ? 5 : 2.5;

const CUES: [RegExp, string][] = [
  [/bench/, 'shoulder blades pinched, feet planted, touch the same spot on the chest every rep'],
  [/squat/, 'brace before each rep, knees over toes, the same depth every rep'],
  [/dead ?lift|rdl/, 'bar over mid-foot, push the floor away, finish with the hips, not the lower back'],
  [/press|ohp/, 'glutes tight, bar close to the face, head through at the top'],
  [/row|pull/, 'no body swing, pull to the lower ribs, pause a beat at the top'],
];
const cueFor = (exercise: string) => CUES.find(([pattern]) => pattern.test(key(exercise)))?.[1] ?? 'film a set and check the range of motion, lower in 2 to 3 seconds, and rest a full 2 to 3 minutes';

export function strengthAdvice(workouts: HealthWorkout[], exercise: string, regimes: Regime[]): Advice {
  const sessions = sessionsOf(workouts, exercise).filter(s => s.sets?.length);
  const range = rangeFor(exercise, regimes);
  const assumed = range.assumed ? ` (rep range assumed ${range.low} to ${range.top}; set it in a regime)` : '';
  if (!sessions.length) return { exercise, rule: 'more', text: 'No sets logged yet.' };
  const last = sessions.at(-1)!.sets!;
  const top = topSet(last);
  const reachedTop = (sets: LiftSet[]) => sets.every(s => s.reps >= range.top);
  if (sessions.length >= 2 && sessions.slice(-2).every(s => reachedTop(s.sets!))) {
    const add = increment(top.weight, top.unit);
    return { exercise, rule: 'progress', text: `Every set reached ${range.top} reps twice running: add ${add} ${top.unit} next time (${top.weight + add} ${top.unit})${assumed}.` };
  }
  const [a, b, c] = sessions.slice(-3).map(s => s.sets!);
  const fell = (from: LiftSet[], to: LiftSet[]) => totalReps(to) < totalReps(from) && toUnit(topSet(to).weight, topSet(to).unit, top.unit) <= toUnit(topSet(from).weight, topSet(from).unit, top.unit);
  if (c && fell(a, b) && fell(b, c)) {
    return { exercise, rule: 'deload', text: `Reps fell two sessions running at ${top.weight} ${top.unit}: hold the weight next time, or deload 10% to ${roundTo(top.weight * 0.9, top.unit === 'kg' ? 2.5 : 5)} ${top.unit} and build back.` };
  }
  const series = strengthSeries(workouts, exercise, top.unit).map(p => p.value);
  if (series.length >= 4 && Math.max(...series.slice(-3)) <= Math.max(...series.slice(0, -3))) {
    return { exercise, rule: 'form', text: `No new best in three sessions. Form check: ${cueFor(exercise)}.` };
  }
  return { exercise, rule: 'keep', text: `Stay at ${top.weight} ${top.unit} and add a rep where you can until every set reaches ${range.top}${assumed}.` };
}

export function cardioAdvice(workouts: HealthWorkout[], exercise: string): Advice {
  const sessions = sessionsOf(workouts, exercise).filter(s => s.distance && s.minutes);
  if (sessions.length < 2) return { exercise, rule: 'more', text: 'Log another session with distance and time to compare pace.' };
  const [prev, last] = sessions.slice(-2);
  const pace = paceSeries([prev, last], exercise, last.distanceUnit ?? 'mi');
  const faster = pace[1].value < pace[0].value;
  const unit = last.distanceUnit ?? 'mi';
  if (faster && last.effort === 'easy') return { exercise, rule: 'distance', text: `Pace improved and it felt easy: add about 10% distance next time (${Math.round(last.distance! * 1.1 * 10) / 10} ${unit}).` };
  if (faster) return { exercise, rule: 'hold', text: 'Pace improved: keep this distance until it feels easy, then add about 10%.' };
  if (pace[1].value > pace[0].value) return { exercise, rule: 'hold', text: 'Slower than last time: keep the distance and an easy effort; one slow day is noise.' };
  return { exercise, rule: 'keep', text: 'Same pace as last time: keep going.' };
}

// Advice for every exercise logged in the last eight weeks, lifts first.
export function coachAll(health: Health, today: string): Advice[] {
  const recent = health.workouts.filter(w => w.day >= addDays(today, -56));
  return [...exercisesOf(recent, 'strength').map(e => strengthAdvice(health.workouts, e, health.regimes)), ...exercisesOf(recent, 'cardio').map(e => cardioAdvice(health.workouts, e))];
}

// The compact text "Review my regime" sends: goal and targets, the regime, four weeks of sessions per exercise
// with the trend, bodyweight and the week's intake. Exercise names and numbers only, nothing else from the workspace.
export function regimeSummary(health: Health, regime: Regime | undefined, today: string): string {
  const unit = health.targets?.unit ?? 'lb';
  const lines: string[] = [];
  const t = health.targets;
  if (t) lines.push(`Goal: ${t.goal}${t.targetWeight ? ` toward ${t.targetWeight} ${t.unit}` : ''}. Daily targets: ${t.kcal} kcal, ${t.protein} g protein, ${t.carbs} g carbs, ${t.fat} g fat.`);
  if (regime) {
    lines.push(`Regime "${regime.name}"${regime.notes ? ` (${regime.notes})` : ''}:`);
    for (const day of regime.days) lines.push(`- ${day.name}: ${day.exercises.map(e => `${e.name} ${e.sets}x${e.reps}${e.rest ? ` rest ${e.rest}s` : ''}`).join('; ')}`);
  } else lines.push('No saved regime.');
  const from = addDays(today, -28);
  const recent = health.workouts.filter(w => w.day >= from);
  lines.push('Last 4 weeks:');
  for (const exercise of exercisesOf(recent, 'strength')) {
    const sessions = sessionsOf(recent, exercise).filter(s => s.sets?.length);
    const last = sessions.at(-1)!.sets!;
    lines.push(`- ${exercise}: ${sessions.length} sessions, estimated 1RM ${trendWords(strengthSeries(health.workouts, exercise, unit), today).words}, last ${last.map(s => `${s.reps}x${s.weight}${s.unit}`).join(' ')}, best e1RM ${Math.round(bestE1rm(last, unit))} ${unit}`);
  }
  for (const exercise of exercisesOf(recent, 'cardio')) {
    const sessions = sessionsOf(recent, exercise);
    const last = sessions.at(-1)!;
    lines.push(`- ${exercise}: ${sessions.length} sessions, pace ${trendWords(paceSeries(health.workouts, exercise, 'mi'), today, 4, true).words}, last ${last.distance ?? '?'} ${last.distanceUnit ?? 'mi'} in ${last.minutes ?? '?'} min`);
  }
  const weights = movingAverage(weightSeries(health.weights, unit));
  if (weights.length) lines.push(`Bodyweight: ${weights.at(-1)!.value} ${unit} (7-day average), ${trendWords(weights, today).words}.`);
  const week = weeklyAverage(health.meals, today);
  if (week) lines.push(`Average intake over ${week.days} logged days: ${week.average.kcal} kcal, ${week.average.protein} g protein, ${week.average.carbs} g carbs, ${week.average.fat} g fat.`);
  return lines.join('\n');
}
