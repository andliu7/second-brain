// Health: food, training and bodyweight in one page (#health). Props:
//   workspace, commit: App's, as every page; the data is workspace.health (types.ts), empty until first saved
//   notify: App's toast
//   connections: /api/status, to know which chat providers have a key
//   today: the day to read as today; tests pass a fixed one so the fixtures' dates hold
//
// Five tabs, because each answers a different question and one long scroll buried the answers:
//   Today    "Log anything": a brain dump the chat model turns into rows (POST /api/health/parse), each food then
//            run down the lookup ladder (POST /api/health/resolve: his own foods, USDA, the model's guess), shown
//            as a preview he corrects before anything is saved. Then hit or miss per macro, the day's nutrition
//            table, and quick add, which needs no AI at all.
//   Trends   bodyweight with its 7-day average, strength as estimated 1RM, cardio pace; small inline SVG charts,
//            each with its trend in words and its numbers in a table for a screen reader
//   Coach    rule-based advice per exercise (lib/health/coach.ts), and "Review my regime" for AI suggestions
//   Regimes  several saved regimes; Share as text or a .json file for a friend, and Import to read one back
//   Targets  daily kcal, protein, carbs, fat and the goal
// The arithmetic lives in lib/health/*.ts with no React in it, so the tests check the numbers directly and
// this file only draws them.
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ClipboardCopy, Download, HeartPulse, Loader2, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { Connections, FoodSource, Health as HealthData, HealthFood, MacroSet, HealthTargets, HealthWorkout, LiftSet, MealName, Regime, RegimeExercise, WeightUnit, Workspace } from './types';
import { api } from './lib/api';
import { download, today as todayOf, uid } from './lib/storage';
import { copyText } from './lib/clipboard';
import { MACROS, addDays, defaultTargets, healthOf, itemsOn, knownFromItem, rememberFood, totalsOf, versusTargets, weeklyAverage } from './lib/health/nutrition';
import { exercisesOf, movingAverage, paceSeries, strengthSeries, trendWords, weightSeries, type Point } from './lib/health/trends';
import { coachAll, regimeSummary } from './lib/health/coach';
import { applyDraft, draftFrom, formatSets, parseSetsText, setsToText, type Draft, type DraftFood, type Parsed, type Resolved, type ResolvedFood } from './lib/health/log';
import { newRegime, parseRegimeJson, regimeToJson, regimeToMarkdown } from './lib/health/regime';
import './health.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type Save = (change: (health: HealthData) => HealthData, message?: string) => Promise<boolean>;
type Notify = (text: string, error?: boolean) => void;
type Choice = { provider: string; model: string };
type Tab = 'today' | 'trends' | 'coach' | 'regimes' | 'targets';
const TABS: { id: Tab; label: string }[] = [{ id: 'today', label: 'Today' }, { id: 'trends', label: 'Trends' }, { id: 'coach', label: 'Coach' }, { id: 'regimes', label: 'Regimes' }, { id: 'targets', label: 'Targets' }];
const MEALS: MealName[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const CHAT = [{ id: 'claude', name: 'Claude' }, { id: 'openai', name: 'OpenAI' }, { id: 'gemini', name: 'Gemini' }];
const message = (error: unknown) => error instanceof Error ? error.message : 'Request failed.';
const cap = (text: string) => text[0].toUpperCase() + text.slice(1);
const n1 = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);

export function Health({ workspace, commit, notify, connections, today = todayOf() }: { workspace: Workspace; commit: Commit; notify: Notify; connections: Connections | null; today?: string }) {
  const health = healthOf(workspace);
  const [tab, setTab] = useState<Tab>('today');
  const [day, setDay] = useState(today);
  // The model for parse and review: his pick, or the first provider with a key. Anthropic can be out of credit
  // while another key works, so the pick is one menu away rather than buried in Settings.
  const available = CHAT.filter(p => connections?.providers[p.id]);
  const [picked, setPicked] = useState<Choice | null>(null);
  const choice: Choice | null = picked ?? (available[0] ? { provider: available[0].id, model: connections?.models[available[0].id] || '' } : null);
  const save: Save = (change, text) => commit(w => ({ ...w, health: change(healthOf(w)) }), text);
  return <div className="health-page">
    <div className="page-heading"><div><h1>Health</h1></div>
      <div className="heading-actions health-model">{connections === null ? <span className="muted">Checking AI keys…</span> : available.length === 0 ? <span className="muted">No AI key: quick add still works.</span> : <>
        <label>AI <select value={choice?.provider} onChange={event => setPicked({ provider: event.target.value, model: connections.models[event.target.value] || '' })}>{available.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <input aria-label="Model id" value={choice?.model || ''} onChange={event => setPicked({ provider: choice!.provider, model: event.target.value })}/>
      </>}</div>
    </div>
    <div className="tabs health-tabs" role="tablist" aria-label="Health sections">{TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'selected' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
    {tab === 'today' && <>
      <LogBox health={health} save={save} choice={choice} today={today}/>
      <TodayStrip health={health} today={today}/>
      <DayTable health={health} save={save} day={day} setDay={setDay} notify={notify}/>
      <QuickAdd health={health} save={save} day={day} notify={notify}/>
    </>}
    {tab === 'trends' && <Trends health={health} today={today}/>}
    {tab === 'coach' && <Coach health={health} today={today} choice={choice}/>}
    {tab === 'regimes' && <Regimes health={health} save={save} notify={notify}/>}
    {tab === 'targets' && <Targets health={health} save={save}/>}
  </div>;
}

function Section({ title, children, actions, className = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <section className={`panel health-section ${className}`} aria-label={title}><div className="section-heading"><h2>{title}</h2>{actions}</div><div className="health-body">{children}</div></section>;
}
// A number field that reads an empty box as 0, so a cleared field never saves NaN.
function Num({ label, value, onChange, step = 'any', className = '' }: { label: string; value: number | undefined; onChange: (value: number) => void; step?: string; className?: string }) {
  return <input className={`health-num ${className}`} type="number" min={0} step={step} inputMode="decimal" aria-label={label} value={value ?? ''} onChange={event => onChange(event.target.value === '' ? 0 : Math.max(0, Number(event.target.value)))}/>;
}
function SourceLabel({ source, fdcId }: { source: FoodSource; fdcId?: number }) {
  if (source === 'usda' && fdcId) return <a className="health-source is-usda" href={`https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`} target="_blank" rel="noreferrer">USDA {fdcId}</a>;
  return <span className={`health-source is-${source}`}>{source === 'known' ? 'Your food' : source === 'usda' ? 'USDA' : source === 'guessed' ? 'Guessed' : 'Typed'}</span>;
}

// ---- Today ----

function LogBox({ health, save, choice, today }: { health: HealthData; save: Save; choice: Choice | null; today: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const unit = health.targets?.unit ?? 'lb';
  async function read(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || !choice || busy) return;
    setBusy(true); setError('');
    try {
      const reply = await api<{ parsed: Parsed }>('health/parse', { text, today, unit, provider: choice.provider, model: choice.model });
      const items = reply.parsed.meals.flatMap(m => m.items);
      // The ladder failing (the server restarted, say) still leaves the model's guesses to correct.
      let resolved: Resolved | null = null;
      if (items.length) try { resolved = await api<Resolved>('health/resolve', { items, known: health.foods }); } catch { resolved = null; }
      setDraft(draftFrom(reply.parsed, resolved, today, uid));
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  async function keep() {
    if (draft && await save(h => applyDraft(h, draft, uid), 'Logged')) { setDraft(null); setText(''); }
  }
  return <Section title="Log anything" className="health-log">
    <form onSubmit={read}>
      <textarea aria-label="Log anything" rows={4} value={text} onChange={event => setText(event.target.value)} placeholder="2 eggs and toast, big coffee; bench 3x8 at 135, ran 2 miles in 18 min; weighed 162"/>
      <div className="health-row">
        <button className="button primary" type="submit" disabled={!text.trim() || !choice || busy}>{busy ? <Loader2 size={15} className="spin"/> : <Sparkles size={15}/>}Read it</button>
        <span className="muted">{choice ? 'The AI turns it into rows you can correct before saving.' : 'Add an AI key to read free text, or use Quick add below.'}</span>
      </div>
      {error && <p className="error-text health-error" role="alert">{error}</p>}
    </form>
    {draft && <DraftPreview draft={draft} setDraft={setDraft} keep={keep} discard={() => setDraft(null)}/>}
  </Section>;
}

// The parse, laid out for correcting before it is saved. Changing grams rescales that row's numbers; typing a
// number over one makes it his own ("Typed"). Remember keeps the row as one of his foods for the ladder.
function DraftPreview({ draft, setDraft, keep, discard }: { draft: Draft; setDraft: (draft: Draft) => void; keep: () => void; discard: () => void }) {
  const setFood = (key: string, change: (food: DraftFood) => DraftFood) => setDraft({ ...draft, foods: draft.foods.map(f => f.key === key ? change(f) : f) });
  const regram = (f: DraftFood, grams: number): DraftFood => {
    const k = f.base.grams > 0 ? grams / f.base.grams : 0;
    return { ...f, grams, kcal: Math.round(f.base.kcal * k), protein: Math.round(f.base.protein * k * 10) / 10, carbs: Math.round(f.base.carbs * k * 10) / 10, fat: Math.round(f.base.fat * k * 10) / 10 };
  };
  // A typed number becomes the new base, so a later change of grams scales what he typed.
  const retype = (f: DraftFood, key: keyof MacroSet, value: number): DraftFood => {
    const next = { ...f, [key]: value, source: 'manual' as const };
    return f.grams > 0 ? { ...next, base: { grams: f.grams, kcal: next.kcal, protein: next.protein, carbs: next.carbs, fat: next.fat } } : next;
  };
  const setWorkout = (key: string, patch: Partial<HealthWorkout>) => setDraft({ ...draft, workouts: draft.workouts.map(w => w.key === key ? { ...w, ...patch } : w) });
  const empty = !draft.foods.length && !draft.workouts.length && !draft.bodyweight;
  return <div className="health-draft" aria-label="Preview">
    <div className="health-row"><h3>Check before saving</h3><label>Day <input type="date" value={draft.day} onChange={event => event.target.value && setDraft({ ...draft, day: event.target.value })}/></label></div>
    {draft.note && <p className="health-note">{draft.note}</p>}
    {empty && <p className="muted">Nothing to log was found in that text.</p>}
    {draft.foods.length > 0 && <div className="health-scroll"><table className="health-table">
      <thead><tr><th>Meal</th><th>Food</th><th>g</th><th>kcal</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Source</th><th>Remember</th><th><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>{draft.foods.map(f => <tr key={f.key}>
        <td><select aria-label={`Meal for ${f.name}`} value={f.meal} onChange={event => setFood(f.key, x => ({ ...x, meal: event.target.value as MealName }))}>{MEALS.map(m => <option key={m} value={m}>{cap(m)}</option>)}</select></td>
        <td><input aria-label="Food name" value={f.name} onChange={event => setFood(f.key, x => ({ ...x, name: event.target.value }))}/>{f.usdaName && <small className="muted">{f.usdaName}</small>}</td>
        <td><Num label={`Grams of ${f.name}`} value={f.grams} onChange={v => setFood(f.key, x => regram(x, v))}/></td>
        {MACROS.map(m => <td key={m.key}><Num label={`${m.label} in ${f.name}`} value={f[m.key]} onChange={v => setFood(f.key, x => retype(x, m.key, v))}/></td>)}
        <td><SourceLabel source={f.source} fdcId={f.fdcId}/></td>
        <td><input type="checkbox" aria-label={`Remember ${f.name} as my food`} checked={f.remember} onChange={event => setFood(f.key, x => ({ ...x, remember: event.target.checked }))}/></td>
        <td><button type="button" className="icon-button" aria-label={`Remove ${f.name}`} onClick={() => setDraft({ ...draft, foods: draft.foods.filter(x => x.key !== f.key) })}><X size={14}/></button></td>
      </tr>)}</tbody>
    </table></div>}
    {draft.workouts.length > 0 && <ul className="health-list">{draft.workouts.map(w => <li key={w.key} className="health-row">
      <input aria-label="Exercise" value={w.exercise} onChange={event => setWorkout(w.key, { exercise: event.target.value })}/>
      {w.kind === 'strength' ? <SetsField sets={w.sets || []} onChange={sets => setWorkout(w.key, { sets })}/> : <CardioFields workout={w} onChange={patch => setWorkout(w.key, patch)}/>}
      <button type="button" className="icon-button" aria-label={`Remove ${w.exercise}`} onClick={() => setDraft({ ...draft, workouts: draft.workouts.filter(x => x.key !== w.key) })}><X size={14}/></button>
    </li>)}</ul>}
    {draft.bodyweight && <div className="health-row"><span>Bodyweight</span><Num label="Bodyweight" value={draft.bodyweight.weight} onChange={weight => setDraft({ ...draft, bodyweight: { ...draft.bodyweight!, weight } })}/><span>{draft.bodyweight.unit}</span><button type="button" className="icon-button" aria-label="Remove bodyweight" onClick={() => setDraft({ ...draft, bodyweight: null })}><X size={14}/></button></div>}
    <div className="health-row"><button type="button" className="button primary" disabled={empty} onClick={keep}>Save to {draft.day}</button><button type="button" className="button" onClick={discard}>Discard</button></div>
  </div>;
}

// Sets as the shorthand "8@135, 8@135" (or "3x8@135"), checked when the field is left. The text is local while
// typing so a half-typed set is not thrown away on every key.
function SetsField({ sets, onChange }: { sets: LiftSet[]; onChange: (sets: LiftSet[]) => void }) {
  const unit = sets[0]?.unit ?? 'lb';
  const [text, setText] = useState(setsToText(sets));
  const [bad, setBad] = useState(false);
  const commitText = (value: string, to: WeightUnit) => { const parsed = parseSetsText(value, to); setBad(!parsed); if (parsed) onChange(parsed); };
  return <span className="health-sets">
    <input aria-label="Sets, reps@weight" aria-invalid={bad || undefined} value={text} onChange={event => setText(event.target.value)} onBlur={() => commitText(text, unit)}/>
    <select aria-label="Weight unit" value={unit} onChange={event => commitText(text, event.target.value as WeightUnit)}><option value="lb">lb</option><option value="kg">kg</option></select>
    {bad && <small className="health-error" role="alert">Write sets as 8@135, 8@135</small>}
  </span>;
}
function CardioFields({ workout, onChange }: { workout: Partial<HealthWorkout>; onChange: (patch: Partial<HealthWorkout>) => void }) {
  return <span className="health-sets">
    <Num label="Distance" value={workout.distance} onChange={distance => onChange({ distance })}/>
    <select aria-label="Distance unit" value={workout.distanceUnit ?? 'mi'} onChange={event => onChange({ distanceUnit: event.target.value as 'mi' | 'km' })}><option value="mi">mi</option><option value="km">km</option></select>
    <Num label="Minutes" value={workout.minutes} onChange={minutes => onChange({ minutes })}/><span>min</span>
    <select aria-label="Effort" value={workout.effort ?? ''} onChange={event => onChange({ effort: (event.target.value || undefined) as HealthWorkout['effort'] })}><option value="">Effort</option><option value="easy">Easy</option><option value="moderate">Moderate</option><option value="hard">Hard</option></select>
  </span>;
}

function TodayStrip({ health, today }: { health: HealthData; today: string }) {
  const totals = totalsOf(itemsOn(health.meals, today));
  const week = weeklyAverage(health.meals, today);
  const targets = health.targets;
  return <Section title="Today against targets" className="health-strip">
    {targets ? <ul className="health-macros">{versusTargets(totals, targets).map(s => <li key={s.key} className={`health-macro is-${s.status}`}>
      <div className="health-macro-top"><strong>{s.label}</strong><span className="health-status">{s.status === 'hit' ? 'Hit' : cap(s.status)}</span></div>
      {/* The bar is the words drawn, so it is hidden from a screen reader, which reads the sentence below. */}
      <div className="health-bar" aria-hidden="true"><span style={{ width: `${Math.min(1, s.share) * 100}%` }}/></div>
      <p>{s.words}</p>
    </li>)}</ul> : <p className="muted">Set daily targets on the Targets tab to see hit or miss for each macro.</p>}
    <p className="health-week">{week ? `Last 7 days, averaged over ${week.days} logged ${week.days === 1 ? 'day' : 'days'}: ${week.average.kcal} kcal, ${n1(week.average.protein)} g protein, ${n1(week.average.carbs)} g carbs, ${n1(week.average.fat)} g fat.` : 'No food logged in the last 7 days.'}</p>
  </Section>;
}

function DayTable({ health, save, day, setDay, notify }: { health: HealthData; save: Save; day: string; setDay: (day: string) => void; notify: Notify }) {
  const meals = MEALS.map(meal => ({ meal, items: health.meals.filter(m => m.day === day && m.meal === meal).flatMap(m => m.items) })).filter(m => m.items.length);
  const totals = totalsOf(meals.flatMap(m => m.items));
  const workouts = health.workouts.filter(w => w.day === day);
  const weight = health.weights.filter(w => w.day === day).at(-1);
  const remove = (id: string) => void save(h => ({ ...h, meals: h.meals.map(m => ({ ...m, items: m.items.filter(i => i.id !== id) })).filter(m => m.items.length) }));
  const remember = (item: HealthFood) => { const food = knownFromItem(item, uid()); if (!food) return notify('A food needs grams to be remembered.', true); void save(h => ({ ...h, foods: rememberFood(h.foods, food) }), `${item.name} saved as your food`); };
  return <Section title="Nutrition facts" actions={<div className="health-day">
    <button type="button" className="icon-button" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}><ChevronLeft size={16}/></button>
    <input type="date" aria-label="Day" value={day} onChange={event => event.target.value && setDay(event.target.value)}/>
    <button type="button" className="icon-button" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}><ChevronRight size={16}/></button>
  </div>}>
    {meals.length ? <div className="health-scroll"><table className="health-table">
      <thead><tr><th>Item</th><th>Grams</th>{MACROS.map(m => <th key={m.key}>{m.label}{m.unit === 'g' ? ' (g)' : ''}</th>)}<th>Source</th><th><span className="sr-only">Actions</span></th></tr></thead>
      {meals.map(({ meal, items }) => <tbody key={meal}><tr className="health-meal"><th colSpan={9} scope="colgroup">{cap(meal)}</th></tr>{items.map(item => <tr key={item.id}>
        <td>{item.name}{item.quantity !== undefined && <small className="muted"> {n1(item.quantity)} {item.unit || ''}</small>}</td>
        <td>{Math.round(item.grams)}</td>{MACROS.map(m => <td key={m.key}>{m.key === 'kcal' ? Math.round(item.kcal) : n1(item[m.key])}</td>)}
        <td><SourceLabel source={item.source} fdcId={item.fdcId}/></td>
        <td className="health-actions">{item.source !== 'known' && <button type="button" className="text-button" onClick={() => remember(item)}>Remember</button>}<button type="button" className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => remove(item.id)}><Trash2 size={14}/></button></td>
      </tr>)}</tbody>)}
      <tfoot><tr><th scope="row">Total</th><td/>{MACROS.map(m => <td key={m.key}>{m.key === 'kcal' ? totals.kcal : n1(totals[m.key])}</td>)}<td colSpan={2}/></tr></tfoot>
    </table></div> : <p className="muted">No food logged on {day}.</p>}
    {(workouts.length > 0 || weight) && <ul className="health-list health-done">
      {workouts.map(w => <li key={w.id}><strong>{w.exercise}</strong> <span>{w.kind === 'strength' ? formatSets(w.sets || []) : [w.distance && `${w.distance} ${w.distanceUnit ?? 'mi'}`, w.minutes && `${w.minutes} min`, w.effort].filter(Boolean).join(', ')}</span>
        <button type="button" className="icon-button" aria-label={`Delete ${w.exercise}`} onClick={() => void save(h => ({ ...h, workouts: h.workouts.filter(x => x.id !== w.id) }))}><Trash2 size={14}/></button></li>)}
      {weight && <li><strong>Bodyweight</strong> <span>{weight.weight} {weight.unit}</span></li>}
    </ul>}
  </Section>;
}

// Everything the brain dump does, by hand. Look up runs the same ladder without a model: his foods, then USDA.
function QuickAdd({ health, save, day, notify }: { health: HealthData; save: Save; day: string; notify: Notify }) {
  const unit = health.targets?.unit ?? 'lb';
  const blank = { meal: 'snack' as MealName, name: '', grams: 100, kcal: 0, protein: 0, carbs: 0, fat: 0, source: 'manual' as FoodSource, fdcId: undefined as number | undefined };
  const [food, setFood] = useState(blank);
  const [looking, setLooking] = useState(false);
  const [lift, setLift] = useState({ exercise: '', kind: 'strength' as HealthWorkout['kind'], sets: '3x8@135', distance: 0, distanceUnit: 'mi' as 'mi' | 'km', minutes: 0 });
  const [weight, setWeight] = useState(0);
  async function lookUp() {
    if (!food.name.trim()) return;
    setLooking(true);
    try {
      const reply = await api<Resolved>('health/resolve', { items: [{ name: food.name, grams: food.grams }], known: health.foods });
      const row: ResolvedFood = reply.items[0];
      if (row.found === false) notify(reply.usda.note || `No match for ${food.name}: type the numbers.`, true);
      else setFood({ ...food, kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat, source: row.source, fdcId: row.fdcId });
    } catch (error) { notify(message(error), true); }
    finally { setLooking(false); }
  }
  function addFood(event: FormEvent) {
    event.preventDefault();
    if (!food.name.trim()) return;
    const item: HealthFood = { id: uid(), name: food.name.trim(), grams: food.grams, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, source: food.source, ...(food.fdcId ? { fdcId: food.fdcId } : {}) };
    void save(h => { const meal = h.meals.find(m => m.day === day && m.meal === food.meal); return { ...h, meals: meal ? h.meals.map(m => m === meal ? { ...m, items: [...m.items, item] } : m) : [...h.meals, { id: uid(), day, meal: food.meal, items: [item] }] }; }, `${item.name} added`).then(ok => ok && setFood({ ...blank, meal: food.meal }));
  }
  function addLift(event: FormEvent) {
    event.preventDefault();
    if (!lift.exercise.trim()) return;
    const sets = lift.kind === 'strength' ? parseSetsText(lift.sets, unit) : null;
    if (lift.kind === 'strength' && !sets) return notify('Write sets as 3x8@135, or 8@135, 7@135.', true);
    if (lift.kind === 'cardio' && !lift.distance && !lift.minutes) return notify('Give a distance or a time.', true);
    const workout: HealthWorkout = lift.kind === 'strength' ? { id: uid(), day, exercise: lift.exercise.trim(), kind: 'strength', sets: sets! } : { id: uid(), day, exercise: lift.exercise.trim(), kind: 'cardio', ...(lift.distance ? { distance: lift.distance, distanceUnit: lift.distanceUnit } : {}), ...(lift.minutes ? { minutes: lift.minutes } : {}) };
    void save(h => ({ ...h, workouts: [...h.workouts, workout] }), `${workout.exercise} added`);
  }
  function addWeight(event: FormEvent) {
    event.preventDefault();
    if (weight < 1) return;
    void save(h => ({ ...h, weights: [...h.weights, { id: uid(), day, weight, unit }] }), 'Bodyweight added').then(ok => ok && setWeight(0));
  }
  return <Section title={`Quick add to ${day}`} className="health-quick">
    <form className="health-form" onSubmit={addFood} aria-label="Add a food">
      <h3>Food</h3>
      <div className="health-row"><select aria-label="Meal" value={food.meal} onChange={event => setFood({ ...food, meal: event.target.value as MealName })}>{MEALS.map(m => <option key={m} value={m}>{cap(m)}</option>)}</select>
        <input aria-label="Food" placeholder="Food" value={food.name} onChange={event => setFood({ ...food, name: event.target.value, source: 'manual', fdcId: undefined })}/>
        <label>g <Num label="Grams" value={food.grams} onChange={grams => setFood({ ...food, grams })}/></label>
        <button type="button" className="button small" onClick={() => void lookUp()} disabled={looking || !food.name.trim()}>{looking ? <Loader2 size={14} className="spin"/> : <Search size={14}/>}Look up</button></div>
      <div className="health-row">{MACROS.map(m => <label key={m.key}>{m.label} <Num label={m.label} value={food[m.key]} onChange={v => setFood({ ...food, [m.key]: v, source: 'manual' })}/></label>)}<SourceLabel source={food.source} fdcId={food.fdcId}/></div>
      <button className="button small" type="submit" disabled={!food.name.trim()}><Plus size={14}/>Add food</button>
    </form>
    <form className="health-form" onSubmit={addLift} aria-label="Add an exercise">
      <h3>Exercise</h3>
      <div className="health-row"><input aria-label="Exercise name" placeholder="Bench press" value={lift.exercise} onChange={event => setLift({ ...lift, exercise: event.target.value })}/>
        <select aria-label="Kind" value={lift.kind} onChange={event => setLift({ ...lift, kind: event.target.value as HealthWorkout['kind'] })}><option value="strength">Lift</option><option value="cardio">Cardio</option></select></div>
      {lift.kind === 'strength'
        ? <label className="health-row">Sets ({unit}) <input aria-label="Sets" value={lift.sets} onChange={event => setLift({ ...lift, sets: event.target.value })}/></label>
        : <div className="health-row"><Num label="Distance" value={lift.distance} onChange={distance => setLift({ ...lift, distance })}/><select aria-label="Distance unit" value={lift.distanceUnit} onChange={event => setLift({ ...lift, distanceUnit: event.target.value as 'mi' | 'km' })}><option value="mi">mi</option><option value="km">km</option></select><Num label="Minutes" value={lift.minutes} onChange={minutes => setLift({ ...lift, minutes })}/><span>min</span></div>}
      <button className="button small" type="submit" disabled={!lift.exercise.trim()}><Plus size={14}/>Add exercise</button>
    </form>
    <form className="health-form" onSubmit={addWeight} aria-label="Add bodyweight">
      <h3>Bodyweight</h3>
      <div className="health-row"><Num label={`Bodyweight in ${unit}`} value={weight || undefined} onChange={setWeight}/><span>{unit}</span><button className="button small" type="submit" disabled={weight < 1}><Plus size={14}/>Add</button></div>
    </form>
  </Section>;
}

// ---- Trends ----

// A small line chart in inline SVG: the raw points, and optionally a smoothed line over them. The sentence
// under it says the trend, and the table in Data holds every number, so nothing is only in the picture.
function LineChart({ title, points, smooth, summary, format }: { title: string; points: Point[]; smooth?: Point[]; summary: string; format: (value: number) => string }) {
  const W = 320, H = 120, P = 10;
  if (points.length === 0) return <figure className="health-chart"><figcaption>{title}</figcaption><p className="muted">Nothing logged yet.</p></figure>;
  const all = [...points, ...(smooth || [])];
  const min = Math.min(...all.map(p => p.value)), max = Math.max(...all.map(p => p.value));
  const t = (day: string) => Date.parse(day);
  const t0 = t(points[0].day), t1 = t(points.at(-1)!.day);
  const x = (day: string) => t1 === t0 ? W / 2 : P + ((t(day) - t0) / (t1 - t0)) * (W - 2 * P);
  const y = (value: number) => max === min ? H / 2 : H - P - ((value - min) / (max - min)) * (H - 2 * P);
  const line = (series: Point[]) => series.map(p => `${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return <figure className="health-chart">
    <figcaption>{title}</figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${summary}`} preserveAspectRatio="none">
      <polyline className={smooth ? 'health-line-raw' : 'health-line'} points={line(points)}/>
      {smooth && <polyline className="health-line" points={line(smooth)}/>}
      {points.map(p => <circle key={p.day} className="health-dot" cx={x(p.day)} cy={y(p.value)} r={2.5}/>)}
    </svg>
    <div className="health-axis"><span>{points[0].day}</span><span>{format(min)} to {format(max)}</span><span>{points.at(-1)!.day}</span></div>
    <p className="health-chart-words">{summary}</p>
    <details><summary>Data</summary><table className="health-table"><thead><tr><th>Day</th><th>Value</th>{smooth && <th>7-day average</th>}</tr></thead>
      <tbody>{points.map((p, i) => <tr key={p.day}><td>{p.day}</td><td>{format(p.value)}</td>{smooth && <td>{format(smooth[i].value)}</td>}</tr>)}</tbody></table></details>
  </figure>;
}
const pace = (minutes: number) => `${Math.floor(minutes)}:${String(Math.round((minutes % 1) * 60)).padStart(2, '0')}`;

function Trends({ health, today }: { health: HealthData; today: string }) {
  const unit = health.targets?.unit ?? 'lb';
  const per = unit === 'kg' ? 'km' : 'mi';
  const lifts = exercisesOf(health.workouts, 'strength'), runs = exercisesOf(health.workouts, 'cardio');
  const [lift, setLift] = useState(lifts[0] ?? '');
  const [run, setRun] = useState(runs[0] ?? '');
  const weights = weightSeries(health.weights, unit), average = movingAverage(weights);
  const target = health.targets?.targetWeight;
  const weightWords = average.length ? `7-day average ${average.at(-1)!.value} ${unit}, ${trendWords(average, today).words}${target ? `; ${n1(Math.abs(Math.round((average.at(-1)!.value - target) * 10) / 10))} ${unit} from the ${target} ${unit} goal` : ''}.` : '';
  const strength = lift ? strengthSeries(health.workouts, lift, unit) : [];
  const paces = run ? paceSeries(health.workouts, run, per) : [];
  return <div className="health-trends">
    <Section title="Bodyweight"><LineChart title="Bodyweight" points={weights} smooth={average} summary={weightWords} format={v => `${n1(v)} ${unit}`}/></Section>
    <Section title="Strength" actions={lifts.length > 0 && <select aria-label="Lift" value={lift} onChange={event => setLift(event.target.value)}>{lifts.map(l => <option key={l}>{l}</option>)}</select>}>
      {lifts.length ? <LineChart title={`${lift}, estimated 1RM`} points={strength} summary={strength.length ? `Estimated 1RM ${n1(strength.at(-1)!.value)} ${unit} (Epley, best set each session), ${trendWords(strength, today).words}.` : ''} format={v => `${Math.round(v)} ${unit}`}/> : <p className="muted">No lifts logged yet.</p>}
    </Section>
    <Section title="Cardio pace" actions={runs.length > 0 && <select aria-label="Cardio" value={run} onChange={event => setRun(event.target.value)}>{runs.map(r => <option key={r}>{r}</option>)}</select>}>
      {runs.length ? <LineChart title={`${run}, minutes per ${per}`} points={paces} summary={paces.length ? `Pace ${pace(paces.at(-1)!.value)} per ${per}, ${trendWords(paces, today, 4, true).words}.` : 'Log a distance and a time to see pace.'} format={v => pace(v)}/> : <p className="muted">No cardio logged yet.</p>}
    </Section>
  </div>;
}

// ---- Coach ----

function Coach({ health, today, choice }: { health: HealthData; today: string; choice: Choice | null }) {
  const advice = coachAll(health, today);
  const [regimeId, setRegimeId] = useState(health.regimes[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState<{ text: string; provider: string; model: string } | null>(null);
  const summary = regimeSummary(health, health.regimes.find(r => r.id === regimeId), today);
  async function review() {
    if (!choice) return;
    setBusy(true); setError('');
    try { setReply(await api('health/review', { summary, provider: choice.provider, model: choice.model })); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }
  return <>
    <Section title="What to do next">
      {advice.length ? <ul className="health-advice">{advice.map(a => <li key={a.exercise} className={`is-${a.rule}`}><strong>{a.exercise}</strong><p>{a.text}</p></li>)}</ul> : <p className="muted">Log a few sessions in the last eight weeks and advice appears here.</p>}
      <p className="muted health-small">Rules: all sets at the top of the rep range twice running, add weight; reps falling two sessions running, hold or deload 10%; no new best in three sessions, check form; cardio faster and easy, add 10% distance.</p>
    </Section>
    <Section title="Review my regime" actions={health.regimes.length > 1 && <select aria-label="Regime to review" value={regimeId} onChange={event => setRegimeId(event.target.value)}>{health.regimes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}>
      <div className="health-row"><button type="button" className="button primary" onClick={() => void review()} disabled={!choice || busy}>{busy ? <Loader2 size={15} className="spin"/> : <Sparkles size={15}/>}Review my regime</button>{!choice && <span className="muted">Needs an AI key.</span>}</div>
      <details><summary>What is sent</summary><pre className="health-pre">{summary}</pre></details>
      {error && <p className="error-text health-error" role="alert">{error}</p>}
      {reply && <div className="health-ai" role="note" aria-label="AI suggestions"><h3><Sparkles size={14}/>AI suggestions, not medical advice</h3><p className="health-pre">{reply.text}</p><small className="muted">From {reply.provider}, {reply.model}</small></div>}
    </Section>
  </>;
}

// ---- Regimes ----

function Regimes({ health, save, notify }: { health: HealthData; save: Save; notify: Notify }) {
  const [selected, setSelected] = useState(health.regimes[0]?.id ?? '');
  const file = useRef<HTMLInputElement>(null);
  const regime = health.regimes.find(r => r.id === selected);
  const add = (r: Regime, text: string) => void save(h => ({ ...h, regimes: [...h.regimes, r] }), text).then(ok => ok && setSelected(r.id));
  async function importFile(files: FileList | null) {
    const chosen = files?.[0];
    if (file.current) file.current.value = '';
    if (!chosen) return;
    try { add(parseRegimeJson(await chosen.text(), uid), 'Regime imported'); } catch (error) { notify(message(error), true); }
  }
  return <div className="health-regimes">
    <Section title="Regimes" actions={<div className="health-row">
      <button type="button" className="button small" onClick={() => add(newRegime(uid), 'Regime added')}><Plus size={14}/>New</button>
      <button type="button" className="button small" onClick={() => file.current?.click()}><Upload size={14}/>Import</button>
      <input ref={file} type="file" accept=".json,application/json" className="sr-only" aria-label="Import a regime file" onChange={event => void importFile(event.target.files)}/>
    </div>}>
      {health.regimes.length ? <ul className="health-list">{health.regimes.map(r => <li key={r.id}><button type="button" className={`text-button ${r.id === selected ? 'is-current' : ''}`} aria-pressed={r.id === selected} onClick={() => setSelected(r.id)}>{r.name}</button><span className="muted">{r.days.length} {r.days.length === 1 ? 'day' : 'days'}</span></li>)}</ul> : <p className="muted">No regimes yet. New starts one; Import reads a file a friend sent.</p>}
    </Section>
    {/* key: a different regime mounts a fresh editor, so its unsaved draft never carries over to another. */}
    {regime && <RegimeEditor key={regime.id} regime={regime} save={save} notify={notify} removed={() => setSelected('')}/>}
  </div>;
}

function RegimeEditor({ regime, save, notify, removed }: { regime: Regime; save: Save; notify: Notify; removed: () => void }) {
  const [draft, setDraft] = useState(regime);
  const setDay = (id: string, change: (day: Regime['days'][number]) => Regime['days'][number]) => setDraft({ ...draft, days: draft.days.map(d => d.id === id ? change(d) : d) });
  const setExercise = (dayId: string, id: string, patch: Partial<RegimeExercise>) => setDay(dayId, d => ({ ...d, exercises: d.exercises.map(e => e.id === id ? { ...e, ...patch } : e) }));
  const markdown = regimeToMarkdown(draft);
  const slug = draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'regime';
  const copy = async (text: string, what: string) => { const ok = await copyText(text); notify(ok ? `${what} copied` : 'Could not reach the clipboard', !ok); };
  return <Section title="Edit regime" actions={<div className="health-row">
    <button type="button" className="button small primary" onClick={() => void save(h => ({ ...h, regimes: h.regimes.map(r => r.id === draft.id ? draft : r) }), 'Regime saved')}>Save</button>
    <button type="button" className="button small danger" onClick={() => void save(h => ({ ...h, regimes: h.regimes.filter(r => r.id !== draft.id) }), 'Regime deleted').then(ok => ok && removed())}><Trash2 size={14}/>Delete</button>
  </div>}>
    <div className="health-row"><input aria-label="Regime name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></div>
    <textarea aria-label="Notes" rows={2} placeholder="Notes: how often, how to warm up" value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })}/>
    {draft.days.map(day => <fieldset key={day.id} className="health-day-block">
      <legend><input aria-label="Day name" value={day.name} onChange={event => setDay(day.id, d => ({ ...d, name: event.target.value }))}/></legend>
      <table className="health-table"><thead><tr><th>Exercise</th><th>Sets</th><th>Reps</th><th>Rest (s)</th><th><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>{day.exercises.map(e => <tr key={e.id}>
          <td><input aria-label="Exercise" value={e.name} onChange={event => setExercise(day.id, e.id, { name: event.target.value })}/></td>
          <td><Num label={`Sets of ${e.name}`} step="1" value={e.sets} onChange={sets => setExercise(day.id, e.id, { sets: Math.max(1, Math.min(20, Math.round(sets))) })}/></td>
          <td><input className="health-num" aria-label={`Reps of ${e.name}`} value={e.reps} onChange={event => setExercise(day.id, e.id, { reps: event.target.value.replace(/[^\d-]/g, '') })}/></td>
          <td><Num label={`Rest after ${e.name}`} step="15" value={e.rest} onChange={rest => setExercise(day.id, e.id, { rest: Math.round(rest) })}/></td>
          <td><button type="button" className="icon-button" aria-label={`Remove ${e.name}`} onClick={() => setDay(day.id, d => ({ ...d, exercises: d.exercises.filter(x => x.id !== e.id) }))}><X size={14}/></button></td>
        </tr>)}</tbody></table>
      <div className="health-row"><button type="button" className="text-button" onClick={() => setDay(day.id, d => ({ ...d, exercises: [...d.exercises, { id: uid(), name: 'Exercise', sets: 3, reps: '8-12', rest: 90 }] }))}><Plus size={14}/>Exercise</button>
        <button type="button" className="text-button" onClick={() => setDraft({ ...draft, days: draft.days.filter(d => d.id !== day.id) })}>Remove day</button></div>
    </fieldset>)}
    <button type="button" className="button small" disabled={draft.days.length >= 14} onClick={() => setDraft({ ...draft, days: [...draft.days, { id: uid(), name: `Day ${draft.days.length + 1}`, exercises: [] }] })}><Plus size={14}/>Day</button>
    <h3 className="health-share-title">Share</h3>
    <div className="health-row">
      <button type="button" className="button small" onClick={() => void copy(markdown, 'Regime text')}><ClipboardCopy size={14}/>Copy as text</button>
      <button type="button" className="button small" onClick={() => void copy(regimeToJson(draft), 'Regime JSON')}><ClipboardCopy size={14}/>Copy JSON</button>
      <button type="button" className="button small" onClick={() => download(`${slug}.json`, new Blob([regimeToJson(draft)], { type: 'application/json' }))}><Download size={14}/>Download .json</button>
    </div>
    <pre className="health-pre" aria-label="Regime as text">{markdown}</pre>
  </Section>;
}

// ---- Targets ----

function Targets({ health, save }: { health: HealthData; save: Save }) {
  const [form, setForm] = useState<HealthTargets>(health.targets ?? defaultTargets());
  return <Section title="Daily targets and goal">
    <form className="health-form" onSubmit={event => { event.preventDefault(); void save(h => ({ ...h, targets: form }), 'Targets saved'); }}>
      <div className="health-row">{MACROS.map(m => <label key={m.key}>{m.label} ({m.unit}) <Num label={m.label} step="1" value={form[m.key]} onChange={v => setForm({ ...form, [m.key]: v })}/></label>)}</div>
      <div className="health-row">
        <label>Goal <select value={form.goal} onChange={event => setForm({ ...form, goal: event.target.value as HealthTargets['goal'] })}><option value="cut">Cut</option><option value="maintain">Maintain</option><option value="bulk">Bulk</option></select></label>
        <label>Target weight <Num label="Target weight" value={form.targetWeight} onChange={v => setForm(v ? { ...form, targetWeight: v } : (({ targetWeight: _t, ...rest }) => rest)(form))}/></label>
        <label>Units <select value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value as WeightUnit })}><option value="lb">lb, miles</option><option value="kg">kg, km</option></select></label>
      </div>
      <p className="muted health-small">Protein counts as hit at 90% of its target or more; calories, carbs and fat within 10% either way.</p>
      <button className="button primary" type="submit"><HeartPulse size={15}/>Save targets</button>
    </form>
  </Section>;
}
