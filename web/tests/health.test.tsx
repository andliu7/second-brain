// The Health page: its arithmetic (lib/health/*.ts) checked number by number, then the page itself drawn from a
// made-up fixture, with the brain dump's two server calls answered by a stubbed fetch. Every name and number
// here is invented; today is fixed at 2026-09-28 so the dates hold.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Health } from '../src/Health';
import { initialWorkspace } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import { addDays, dayTotals, knownFromItem, versusTargets, weeklyAverage } from '../src/lib/health/nutrition';
import { bestE1rm, epley, movingAverage, strengthSeries, trendWords, type Point } from '../src/lib/health/trends';
import { cardioAdvice, coachAll, regimeSummary, strengthAdvice } from '../src/lib/health/coach';
import { applyDraft, parseSetsText } from '../src/lib/health/log';
import { parseRegimeJson, regimeToJson, regimeToMarkdown } from '../src/lib/health/regime';
import type { Connections, Health as HealthData, HealthFood, HealthWorkout, LiftSet, Regime, Workspace } from '../src/types';

const TODAY = '2026-09-28';
let n = 0; const id = () => 'id-' + ++n;
const food = (name: string, grams: number, kcal: number, protein: number, carbs: number, fat: number, extra: Partial<HealthFood> = {}): HealthFood => ({ id: id(), name, grams, kcal, protein, carbs, fat, source: 'manual', ...extra });
const sets = (reps: number[], weight: number, unit: LiftSet['unit'] = 'lb'): LiftSet[] => reps.map(r => ({ reps: r, weight, unit }));
const lift = (day: string, exercise: string, s: LiftSet[]): HealthWorkout => ({ id: id(), day, exercise, kind: 'strength', sets: s });
const ppl: Regime = { id: 'r1', name: 'Push pull legs', notes: 'Three days a week.', days: [
  { id: 'd1', name: 'Push', exercises: [{ id: 'e1', name: 'Bench press', sets: 3, reps: '8-12', rest: 120 }, { id: 'e2', name: 'Overhead press', sets: 3, reps: '6-8', rest: 90 }] },
  { id: 'd2', name: 'Legs', exercises: [{ id: 'e3', name: 'Squat', sets: 5, reps: '5' }] },
] };

function fixture(): HealthData {
  return {
    meals: [
      { id: 'm1', day: TODAY, meal: 'breakfast', items: [food('Eggs', 120, 180, 12, 2.4, 13.2, { source: 'usda', fdcId: 900001, quantity: 2, unit: 'large' }), food('Toast', 60, 160, 5, 30, 2, { source: 'known', quantity: 2, unit: 'slice' })] },
      { id: 'm2', day: TODAY, meal: 'lunch', items: [food('Chicken rice bowl', 450, 700, 55, 80, 15, { source: 'guessed' })] },
      { id: 'm3', day: addDays(TODAY, -1), meal: 'dinner', items: [food('Pasta', 300, 600, 20, 100, 12)] },
    ],
    workouts: [
      lift(addDays(TODAY, -35), 'Bench press', sets([10, 10, 9], 125)),
      lift(addDays(TODAY, -28), 'Bench press', sets([10, 10, 10], 125)),
      lift(addDays(TODAY, -14), 'Bench press', sets([9, 9, 8], 135)),
      lift(addDays(TODAY, -7), 'Bench press', sets([12, 12, 12], 135)),
      lift(TODAY, 'Bench press', sets([12, 12, 12], 135)),
      { id: id(), day: addDays(TODAY, -3), exercise: 'Run', kind: 'cardio', distance: 2, distanceUnit: 'mi', minutes: 19 },
      { id: id(), day: TODAY, exercise: 'Run', kind: 'cardio', distance: 2, distanceUnit: 'mi', minutes: 18, effort: 'easy' },
    ],
    weights: [35, 28, 21, 14, 7, 3, 0].map((ago, i) => ({ id: id(), day: addDays(TODAY, -ago), weight: 170 - i, unit: 'lb' as const })),
    foods: [{ id: 'f1', name: 'Toast', per100g: { kcal: 266.7, protein: 8.3, carbs: 50, fat: 3.3 }, unit: 'slice', unitGrams: 30 }],
    regimes: [ppl],
    targets: { kcal: 2200, protein: 150, carbs: 220, fat: 70, goal: 'cut', targetWeight: 160, unit: 'lb' },
  };
}

describe('nutrition arithmetic', () => {
  it('adds up a day and says hit or miss per macro against the targets', () => {
    const health = fixture();
    const totals = dayTotals(health.meals, TODAY);
    expect(totals).toEqual({ kcal: 1040, protein: 72, carbs: 112.4, fat: 30.2 });
    const words = versusTargets(totals, health.targets!).map(s => s.words);
    expect(words).toEqual(['Calories: 1160 kcal under, 1,040 of 2,200 kcal', 'Protein: 78 g under, 72 of 150 g', 'Carbs: 108 g under, 112.4 of 220 g', 'Fat: 40 g under, 30.2 of 70 g']);
    const over = versusTargets({ kcal: 2600, protein: 140, carbs: 230, fat: 70 }, health.targets!);
    expect(over.map(s => s.status)).toEqual(['over', 'hit', 'hit', 'hit']);
    expect(over[0].words).toBe('Calories: 400 kcal over, 2,600 of 2,200 kcal');
    expect(over[1].words).toBe('Protein: hit, 140 of 150 g');
    // Protein is a floor: well past the target is still a hit.
    expect(versusTargets({ kcal: 2200, protein: 220, carbs: 220, fat: 70 }, health.targets!)[1].status).toBe('hit');
  });

  it('averages the week over logged days only, and turns a corrected row into his own food', () => {
    const week = weeklyAverage(fixture().meals, TODAY)!;
    expect(week).toEqual({ days: 2, average: { kcal: 820, protein: 46, carbs: 106.2, fat: 21.1 } });
    expect(weeklyAverage(fixture().meals, addDays(TODAY, 30))).toBeNull();
    expect(knownFromItem(food('Bagel', 100, 250, 10, 48, 1.5, { quantity: 1, unit: 'bagels' }), 'k1')).toEqual({ id: 'k1', name: 'Bagel', per100g: { kcal: 250, protein: 10, carbs: 48, fat: 1.5 }, unit: 'bagel', unitGrams: 100 });
    expect(knownFromItem(food('Rice', 200, 260, 5, 56, 0.6, { quantity: 200, unit: 'g' }), 'k2')).toEqual({ id: 'k2', name: 'Rice', per100g: { kcal: 130, protein: 2.5, carbs: 28, fat: 0.3 } });
    expect(knownFromItem(food('Nothing', 0, 0, 0, 0, 0), 'k3')).toBeNull();
  });

  it('files a corrected draft: foods join that day\'s meal, Remember saves the food, sets and weight are kept', () => {
    const health = fixture();
    const next = applyDraft(health, { day: TODAY, note: '', bodyweight: { weight: 163, unit: 'lb' },
      foods: [{ key: 'a', meal: 'lunch', remember: true, name: 'Apple', grams: 180, kcal: 94, protein: 0.5, carbs: 25, fat: 0.3, source: 'usda', fdcId: 900010, usdaName: 'Apples, raw', base: { grams: 180, kcal: 94, protein: 0.5, carbs: 25, fat: 0.3 } }],
      workouts: [{ key: 'b', exercise: 'Squat', kind: 'strength', sets: sets([5, 5, 5], 185) }] }, id);
    expect(next.meals.filter(m => m.day === TODAY && m.meal === 'lunch')).toHaveLength(1);
    expect(next.meals.find(m => m.id === 'm2')!.items.at(-1)).toMatchObject({ name: 'Apple', source: 'usda', fdcId: 900010 });
    expect(next.foods.find(f => f.name === 'Apple')!.per100g.kcal).toBeCloseTo(52.22, 2);
    expect(next.workouts.at(-1)).toMatchObject({ day: TODAY, exercise: 'Squat' });
    expect(next.weights.at(-1)).toMatchObject({ day: TODAY, weight: 163 });
    expect(() => validateWorkspace({ ...initialWorkspace(), health: next })).not.toThrow();
  });

  it('reads the sets shorthand', () => {
    expect(parseSetsText('3x8@135', 'lb')).toEqual(sets([8, 8, 8], 135));
    expect(parseSetsText('8@60, 7 @ 60; 6@57.5', 'kg')).toEqual([...sets([8, 7], 60, 'kg'), ...sets([6], 57.5, 'kg')]);
    expect(parseSetsText('bench 135', 'lb')).toBeNull();
    expect(parseSetsText('', 'lb')).toBeNull();
  });
});

describe('trends', () => {
  it('estimates a one-rep max by Epley from the best set', () => {
    expect(epley(100, 10)).toBeCloseTo(133.33, 2);
    expect(epley(135, 1)).toBe(135);
    expect(epley(0, 5)).toBe(0);
    expect(epley(100, 0)).toBe(0);
    expect(bestE1rm([...sets([5], 100, 'kg'), ...sets([10], 135)], 'lb')).toBeCloseTo(100 * 2.20462 * (1 + 5 / 30), 1);
    expect(strengthSeries(fixture().workouts, 'bench press', 'lb').map(p => p.value)).toEqual([166.7, 166.7, 175.5, 189, 189]);
  });

  it('says a trend in words: up, down, flat, faster, or not enough yet', () => {
    const series = (values: number[]): Point[] => values.map((value, i) => ({ day: addDays(TODAY, -7 * (values.length - 1 - i)), value }));
    expect(trendWords(series([200, 205, 210, 220]), TODAY).words).toBe('up 10% over 3 weeks');
    expect(trendWords(series([200, 200, 205, 210, 220]), TODAY)).toMatchObject({ direction: 'up', words: 'up 10% over 4 weeks' });
    expect(trendWords(series([180, 181, 179, 180.5]), TODAY).words).toBe('flat over 3 weeks');
    expect(trendWords(series([170, 168, 166, 165, 163]), TODAY).words).toBe('down 4.1% over 4 weeks');
    expect(trendWords(series([9.5, 9.25, 9]), TODAY, 4, true).words).toBe('faster 5.3% over 2 weeks');
    expect(trendWords(series([200]), TODAY).words).toBe('not enough sessions yet');
    expect(trendWords([], TODAY).direction).toBe('none');
  });

  it('smooths bodyweight over the 7 days ending each weigh-in', () => {
    const points = [{ day: '2026-09-20', value: 164 }, { day: '2026-09-24', value: 162 }, { day: '2026-09-26', value: 163 }, { day: '2026-09-28', value: 161 }];
    expect(movingAverage(points).map(p => p.value)).toEqual([164, 163, 163, 162]);
  });
});

describe('coaching rules', () => {
  it('double progression: every set at the top of the range twice running adds weight', () => {
    const advice = strengthAdvice(fixture().workouts, 'Bench press', [ppl]);
    expect(advice).toMatchObject({ rule: 'progress', text: 'Every set reached 12 reps twice running: add 5 lb next time (140 lb).' });
    const kg = strengthAdvice([lift('2026-09-20', 'Squat', sets([5, 5, 5, 5, 5], 100, 'kg')), lift('2026-09-24', 'Squat', sets([5, 5, 5, 5, 5], 100, 'kg'))], 'Squat', [ppl]);
    expect(kg.text).toContain('add 2.5 kg next time (102.5 kg)');
    // Without a regime the range is assumed, and it says so.
    const assumed = strengthAdvice([lift('2026-09-20', 'Curl', sets([12, 12], 30)), lift('2026-09-24', 'Curl', sets([12, 12], 30))], 'Curl', []);
    expect(assumed.text).toBe('Every set reached 12 reps twice running: add 2.5 lb next time (32.5 lb) (rep range assumed 8 to 12; set it in a regime).');
  });

  it('reps falling two sessions running at the same weight: hold or deload 10%', () => {
    const w = [lift('2026-09-14', 'Bench press', sets([10, 10, 10], 135)), lift('2026-09-21', 'Bench press', sets([9, 9, 8], 135)), lift('2026-09-28', 'Bench press', sets([8, 7, 7], 135))];
    expect(strengthAdvice(w, 'Bench press', [ppl])).toMatchObject({ rule: 'deload', text: 'Reps fell two sessions running at 135 lb: hold the weight next time, or deload 10% to 120 lb and build back.' });
    // Fewer reps because the weight went up is not a fall.
    const heavier = [w[0], lift('2026-09-21', 'Bench press', sets([9, 9, 8], 140)), lift('2026-09-28', 'Bench press', sets([8, 7, 7], 145))];
    expect(strengthAdvice(heavier, 'Bench press', [ppl]).rule).not.toBe('deload');
  });

  it('no new best in three sessions: a form cue for that lift', () => {
    const w = [[8, 8, 8], [10, 10, 10], [9, 9, 9], [10, 10, 9], [9, 9, 9]].map((r, i) => lift(addDays(TODAY, -7 * (4 - i)), 'Bench press', sets(r, 135)));
    const advice = strengthAdvice(w, 'Bench press', [ppl]);
    expect(advice.rule).toBe('form');
    expect(advice.text).toMatch(/^No new best in three sessions\. Form check: shoulder blades pinched/);
    expect(strengthAdvice(w.slice(0, 2), 'Bench press', [ppl]).rule).toBe('keep');
  });

  it('cardio: faster and easy adds distance; faster but hard holds; slower holds', () => {
    const health = fixture();
    expect(cardioAdvice(health.workouts, 'Run')).toMatchObject({ rule: 'distance', text: 'Pace improved and it felt easy: add about 10% distance next time (2.2 mi).' });
    const hard = health.workouts.map(w => w.effort ? { ...w, effort: 'hard' as const } : w);
    expect(cardioAdvice(hard, 'Run').rule).toBe('hold');
    expect(cardioAdvice(health.workouts.slice(-1), 'Run').rule).toBe('more');
    expect(coachAll(health, TODAY).map(a => a.exercise)).toEqual(['Bench press', 'Run']);
  });

  it('summarises the regime for the AI review with numbers only', () => {
    const text = regimeSummary(fixture(), ppl, TODAY);
    expect(text).toContain('Goal: cut toward 160 lb. Daily targets: 2200 kcal, 150 g protein, 220 g carbs, 70 g fat.');
    expect(text).toContain('- Push: Bench press 3x8-12 rest 120s; Overhead press 3x6-8 rest 90s');
    expect(text).toMatch(/- Bench press: 4 sessions, estimated 1RM up 13\.4% over 4 weeks/);
    expect(text).toContain('Bodyweight: 164.5 lb (7-day average), down 2.7% over 4 weeks.');
  });
});

describe('regime sharing', () => {
  it('exports as text and as JSON, and the JSON imports back to the same regime with fresh ids', () => {
    expect(regimeToMarkdown(ppl)).toBe('# Push pull legs\n\nThree days a week.\n\n## Push\n\n- Bench press: 3 x 8-12, rest 2 min\n- Overhead press: 3 x 6-8, rest 90 s\n\n## Legs\n\n- Squat: 5 x 5\n');
    const json = regimeToJson(ppl);
    expect(json).not.toContain('"id"');
    const back = parseRegimeJson(json, id);
    const strip = (r: Regime) => ({ name: r.name, notes: r.notes, days: r.days.map(d => ({ name: d.name, exercises: d.exercises.map(({ id: _id, ...e }) => e) })) });
    expect(strip(back)).toEqual(strip(ppl));
    expect(back.id).not.toBe(ppl.id);
    expect(regimeToJson(back)).toBe(json);
  });

  it('refuses a file that is not a shared regime, or one outside the workspace bounds', () => {
    expect(() => parseRegimeJson('not json', id)).toThrow('That file is not JSON.');
    expect(() => parseRegimeJson('{"format":"other","version":1,"regime":{}}', id)).toThrow('not a shared regime');
    const bad = JSON.parse(regimeToJson(ppl)); bad.regime.days[0].exercises[0].reps = 'lots';
    expect(() => parseRegimeJson(JSON.stringify(bad), id)).toThrow(/Invalid regime:\.days\[0\]\.exercises\[0\]\.reps must be a count or a range/);
    const many = JSON.parse(regimeToJson(ppl)); many.regime.days[0].exercises[0].sets = 50;
    expect(() => parseRegimeJson(JSON.stringify(many), id)).toThrow(/sets must be a whole number from 1 to 20/);
  });
});

// ---- the page ----
const connections: Connections = { local: true, providers: { claude: false, openai: true, gemini: false }, authRequired: false, models: { openai: 'gpt-5.4' } };
function Harness({ initial, onCommit }: { initial: Workspace; onCommit?: (w: Workspace) => void }) {
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { setWorkspace(w => { const next = update(w); validateWorkspace(next); onCommit?.(next); return next; }); return true; };
  return <Health workspace={workspace} commit={commit} notify={() => {}} connections={connections} today={TODAY}/>;
}
const reply = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });

describe('the Health page', () => {
  it('a workspace from before Health opens empty, with quick add and no crash', () => {
    const { health: _none, ...older } = { ...initialWorkspace(), health: undefined };
    render(<Harness initial={older as Workspace}/>);
    expect(screen.getByRole('heading', { level: 1, name: 'Health' })).toBeInTheDocument();
    expect(screen.getByText(/Set daily targets on the Targets tab/)).toBeInTheDocument();
    expect(screen.getByText(`No food logged on ${TODAY}.`)).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add a food' })).toBeInTheDocument();
  });

  it('draws today, the nutrition table, trends, coaching and a regime from the fixture', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...initialWorkspace(), health: fixture() }}/>);
    expect(screen.getByText('Protein: 78 g under, 72 of 150 g')).toBeInTheDocument();
    const table = screen.getByRole('region', { name: 'Nutrition facts' });
    expect(within(table).getByRole('link', { name: 'USDA 900001' })).toHaveAttribute('href', 'https://fdc.nal.usda.gov/food-details/900001/nutrients');
    expect(within(table).getByText('Your food')).toBeInTheDocument();
    expect(within(table).getByText('Guessed')).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Total/ })).toHaveTextContent('1040');
    await user.click(screen.getByRole('tab', { name: 'Trends' }));
    expect(screen.getByText(/Estimated 1RM 189 lb \(Epley, best set each session\), up 13\.4% over 4 weeks\./)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bodyweight: 7-day average 164.5 lb, down 2.7% over 4 weeks; 4.5 lb from the 160 lb goal.' })).toBeInTheDocument();
    expect(screen.getByText(/Pace 9:00 per mi, faster 5\.3% over 3 days\./)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Coach' }));
    expect(screen.getByText('Every set reached 12 reps twice running: add 5 lb next time (140 lb).')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Regimes' }));
    expect(screen.getByLabelText('Regime as text')).toHaveTextContent('- Bench press: 3 x 8-12, rest 2 min');
  });

  it('turns a brain dump into a preview he corrects, then saves it', async () => {
    const user = userEvent.setup();
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); calls.push({ url, body });
      if (url.endsWith('health/parse')) return reply({ provider: 'openai', model: 'gpt-5.4', parsed: { meals: [{ meal: 'breakfast', items: [{ name: 'eggs', quantity: 2, unit: 'large', grams: 100, kind: 'generic', estimate: { kcal: 150, protein: 12, carbs: 1, fat: 10 } }] }], workouts: [{ exercise: 'bench press', kind: 'strength', sets: sets([8, 8, 8], 135) }], bodyweight: { weight: 162, unit: 'lb' } } });
      return reply({ usda: { key: 'demo', note: '' }, items: [{ name: 'eggs', quantity: 2, unit: 'large', grams: 100, kcal: 150, protein: 10, carbs: 2, fat: 11, source: 'usda', fdcId: 900001, usdaName: 'Egg, whole, cooked, scrambled' }] });
    }));
    const saved: Workspace[] = [];
    render(<Harness initial={initialWorkspace()} onCommit={w => saved.push(w)}/>);
    await user.type(screen.getByRole('textbox', { name: 'Log anything' }), '2 eggs; bench 3x8 at 135; weighed 162');
    await user.click(screen.getByRole('button', { name: 'Read it' }));
    await screen.findByText('Check before saving');
    expect(calls[0].body).toMatchObject({ provider: 'openai', model: 'gpt-5.4', today: TODAY, unit: 'lb' });
    expect(calls[1].body.items[0].name).toBe('eggs');
    // Doubling the grams doubles the numbers and keeps USDA as the source.
    const grams = screen.getByRole('spinbutton', { name: 'Grams of eggs' });
    await user.clear(grams); await user.type(grams, '200');
    expect(screen.getByRole('spinbutton', { name: 'Calories in eggs' })).toHaveValue(300);
    await user.click(screen.getByRole('checkbox', { name: 'Remember eggs as my food' }));
    await user.click(screen.getByRole('button', { name: `Save to ${TODAY}` }));
    await waitFor(() => expect(saved.length).toBe(1));
    const health = saved[0].health!;
    expect(health.meals[0]).toMatchObject({ day: TODAY, meal: 'breakfast' });
    expect(health.meals[0].items[0]).toMatchObject({ name: 'eggs', grams: 200, kcal: 300, protein: 20, source: 'usda', fdcId: 900001 });
    expect(health.foods[0]).toMatchObject({ name: 'eggs', per100g: { kcal: 150, protein: 10, carbs: 2, fat: 11 }, unit: 'large', unitGrams: 100 });
    expect(health.workouts[0].sets).toHaveLength(3);
    expect(health.weights[0]).toMatchObject({ weight: 162, unit: 'lb' });
  });

  it('shows the parse error when the model answer is refused', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, headers: { get: () => 'application/json' }, json: async () => ({ error: 'The model answered with broken JSON. Try again, or use Quick add.' }) })));
    render(<Harness initial={initialWorkspace()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Log anything' }), 'lunch');
    await user.click(screen.getByRole('button', { name: 'Read it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('broken JSON');
  });
});
