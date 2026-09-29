// A workout regime to keep and to send to a friend. Share writes it two ways: text (markdown) to paste into a
// message, and a .json file the friend's copy of this page reads back with Import. The JSON carries a format
// name and version so a stray file is refused with a reason, and no ids, so importing twice makes two copies
// rather than two regimes fighting over one id. Import checks it with the same bounds as the saved workspace
// (shared/validate.mjs), so a hand-edited file cannot put anything in that a backup restore would refuse.
import type { Regime } from '../../types';
import { validateWorkspace } from '../../../shared/validate.mjs';

export const REGIME_FORMAT = 'second-brain-regime';
type Shared = { format: string; version: number; regime: { name: string; notes: string; days: { name: string; exercises: { name: string; sets: number; reps: string; rest?: number }[] }[] } };

export function regimeToMarkdown(regime: Regime): string {
  const lines = [`# ${regime.name}`, ''];
  if (regime.notes.trim()) lines.push(regime.notes.trim(), '');
  for (const day of regime.days) {
    lines.push(`## ${day.name}`, '');
    for (const e of day.exercises) lines.push(`- ${e.name}: ${e.sets} x ${e.reps}${e.rest ? `, rest ${e.rest < 60 || e.rest % 60 ? `${e.rest} s` : `${e.rest / 60} min`}` : ''}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function regimeToJson(regime: Regime): string {
  const shared: Shared = { format: REGIME_FORMAT, version: 1, regime: { name: regime.name, notes: regime.notes, days: regime.days.map(d => ({ name: d.name, exercises: d.exercises.map(e => ({ name: e.name, sets: e.sets, reps: e.reps, ...(e.rest !== undefined ? { rest: e.rest } : {}) })) })) } };
  return JSON.stringify(shared, null, 2) + '\n';
}

// The regime in a shared file, with fresh ids from makeId. Throws an Error that says what is wrong.
export function parseRegimeJson(text: string, makeId: () => string): Regime {
  let value: Partial<Shared>;
  try { value = JSON.parse(text); } catch { throw new Error('That file is not JSON.'); }
  if (!value || value.format !== REGIME_FORMAT || value.version !== 1 || !value.regime || typeof value.regime !== 'object') throw new Error('That file is not a shared regime from this app.');
  const r = value.regime;
  if (!Array.isArray(r.days) || !r.days.every(d => d && Array.isArray(d.exercises))) throw new Error('That regime has no days.');
  const regime: Regime = { id: makeId(), name: String(r.name ?? ''), notes: String(r.notes ?? ''), days: r.days.map(d => ({ id: makeId(), name: String(d.name ?? ''), exercises: d.exercises.map(e => ({ id: makeId(), name: e?.name, sets: e?.sets, reps: e?.reps, ...(e?.rest !== undefined ? { rest: e.rest } : {}) })) })) };
  try { validateWorkspace({ version: 1, docs: [], goals: [], conversations: [], generations: [], activity: [], health: { meals: [], workouts: [], weights: [], foods: [], regimes: [regime] } }); }
  catch (error) { throw new Error(String((error as Error).message).replace('Invalid workspace: health.regimes[0]', 'Invalid regime:')); }
  return regime;
}

export const newRegime = (makeId: () => string): Regime => ({ id: makeId(), name: 'New regime', notes: '', days: [{ id: makeId(), name: 'Day 1', exercises: [{ id: makeId(), name: 'Bench press', sets: 3, reps: '8-12', rest: 120 }] }] });
