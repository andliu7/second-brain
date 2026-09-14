import { useMemo, useState } from 'react'
import type { BenchItem, BenchState, DayKey } from '../types'
import { DAYS } from '../types'
import { uid, isoMondayOf, fromISO } from '../lib/id'
import type { SaveState } from '../lib/useBoard'

type Loc = { type: 'unsorted' } | { type: 'day'; key: DayKey } | { type: 'anytime' }

function findAndRemove(state: BenchState, id: string): { item: BenchItem | null; next: BenchState } {
  const next: BenchState = {
    ...state,
    unsorted: [...state.unsorted],
    days: Object.fromEntries(DAYS.map((d) => [d.key, [...state.days[d.key]]])) as BenchState['days'],
    anytime: [...state.anytime],
  }
  let item: BenchItem | null = null
  const pull = (arr: BenchItem[]) => {
    const i = arr.findIndex((x) => x.id === id)
    if (i > -1) item = arr.splice(i, 1)[0]
  }
  pull(next.unsorted)
  if (!item) for (const d of DAYS) pull(next.days[d.key])
  if (!item) pull(next.anytime)
  return { item, next }
}

function fmtWeek(d: Date) {
  const end = new Date(d)
  end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `Week of ${d.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`
}

function Placer({
  item,
  loc,
  onAssign,
  mini,
}: {
  item: BenchItem
  loc: Loc
  onAssign: (id: string, loc: Loc) => void
  mini?: boolean
}) {
  const chipBase = mini
    ? 'font-mono text-[9px] border rounded px-1.5 py-1'
    : 'font-mono text-[10.5px] tracking-wide border rounded-md px-2 py-1'
  const idle = 'bg-surface2 border-line text-dim hover:border-accent hover:text-ink'
  const active = 'bg-accent border-accent text-accentInk'
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {DAYS.map((d) => {
        const isActive = loc.type === 'day' && loc.key === d.key
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => onAssign(item.id, { type: 'day', key: d.key })}
            className={`${chipBase} ${isActive ? active : idle}`}
          >
            {d.label[0]}
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => onAssign(item.id, { type: 'anytime' })}
        className={`${chipBase} ${loc.type === 'anytime' ? active : idle}`}
      >
        ∞
      </button>
      {loc.type !== 'unsorted' && (
        <button
          type="button"
          onClick={() => onAssign(item.id, { type: 'unsorted' })}
          className={`${chipBase} ${idle} text-faint`}
        >
          inbox
        </button>
      )}
    </div>
  )
}

export function WeeklyBench({
  state,
  onChange,
  saveState,
}: {
  state: BenchState
  onChange: (s: BenchState) => void
  saveState: SaveState
}) {
  const [captureText, setCaptureText] = useState('')
  const todayMonday = isoMondayOf(new Date())
  const monday = state.weekStart ? fromISO(state.weekStart) : fromISO(todayMonday)
  const isStale = state.weekStart !== '' && state.weekStart !== todayMonday
  const todayKey = DAYS[(new Date().getDay() + 6) % 7].key

  const scheduledCount = useMemo(
    () => DAYS.reduce((n, d) => n + state.days[d.key].length, 0),
    [state]
  )

  function assign(id: string, loc: Loc) {
    const { item, next } = findAndRemove(state, id)
    if (!item) return
    if (loc.type === 'unsorted') next.unsorted.unshift(item)
    else if (loc.type === 'anytime') next.anytime.unshift(item)
    else next.days[loc.key].push(item)
    onChange(next)
  }

  function toggleDone(id: string) {
    const next: BenchState = {
      ...state,
      unsorted: state.unsorted.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
      days: Object.fromEntries(
        DAYS.map((d) => [d.key, state.days[d.key].map((i) => (i.id === id ? { ...i, done: !i.done } : i))])
      ) as BenchState['days'],
      anytime: state.anytime.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
    }
    onChange(next)
  }

  function deleteItem(id: string) {
    const { next } = findAndRemove(state, id)
    onChange(next)
  }

  function move(id: string, dir: 'up' | 'down') {
    const next = { ...state, anytime: [...state.anytime], days: { ...state.days } }
    const candidates: BenchItem[][] = [next.anytime, ...DAYS.map((d) => (next.days[d.key] = [...state.days[d.key]]))]
    for (const arr of candidates) {
      const i = arr.findIndex((x) => x.id === id)
      if (i > -1) {
        const j = dir === 'up' ? i - 1 : i + 1
        if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]]
        break
      }
    }
    onChange(next)
  }

  function addCapture() {
    const text = captureText.trim()
    if (!text) return
    onChange({ ...state, unsorted: [{ id: uid(), text, done: false }, ...state.unsorted] })
    setCaptureText('')
  }

  function rollWeek() {
    const next: BenchState = {
      weekStart: todayMonday,
      unsorted: [...state.unsorted],
      days: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      anytime: state.anytime.filter((i) => !i.done),
    }
    for (const d of DAYS) {
      for (const it of state.days[d.key]) if (!it.done) next.unsorted.push(it)
    }
    onChange(next)
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint">
            Capture · Triage · Place
          </p>
          <h1 className="font-serif text-2xl font-semibold text-ink mt-1">Weekly Bench</h1>
        </div>
        <div className="text-right">
          <div className="font-mono text-[13px] text-dim">{fmtWeek(monday)}</div>
          <div className="flex gap-2.5 text-[12.5px] font-medium text-dim mt-0.5">
            <span>
              <b className="text-ink tabular-nums">{state.unsorted.length}</b> inbox
            </span>
            <span>
              <b className="text-ink tabular-nums">{scheduledCount}</b> scheduled
            </span>
            <span>
              <b className="text-ink tabular-nums">{state.anytime.length}</b> anytime
            </span>
          </div>
        </div>
      </div>

      {isStale && (
        <div className="flex items-center justify-between gap-3 bg-accentSoft border border-accent text-ink rounded-lg px-3.5 py-2.5 mb-4 text-[13.5px]">
          <span>This board is from an earlier week. Unfinished day items go back to the inbox.</span>
          <button
            onClick={rollWeek}
            className="font-mono text-[10.5px] bg-accent text-accentInk rounded-md px-2 py-1 flex-none"
          >
            Roll to this week
          </button>
        </div>
      )}

      <div className="flex gap-2.5 bg-surface border border-line rounded-xl p-2 pl-4 shadow-sm mb-6">
        <input
          value={captureText}
          onChange={(e) => setCaptureText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCapture()}
          type="text"
          placeholder="Drop something in — sort it after"
          maxLength={240}
          className="flex-1 bg-transparent outline-none text-[16px] min-w-0"
        />
        <button
          onClick={addCapture}
          className="font-semibold text-[13px] bg-accent text-accentInk rounded-lg px-4 min-h-[38px]"
        >
          Add
        </button>
      </div>

      <section className="mb-6">
        <h2 className="font-mono text-[11px] tracking-[0.12em] uppercase text-faint mb-2.5">
          Inbox <span className="text-dim font-medium">({state.unsorted.length})</span>
        </h2>
        <div className="flex flex-col gap-2">
          {state.unsorted.map((item) => (
            <div key={item.id} className="bg-surface border border-line rounded-lg p-3 shadow-sm">
              <div className="flex items-start gap-2.5">
                <button
                  onClick={() => toggleDone(item.id)}
                  className={`flex-none w-[19px] h-[19px] rounded-md border grid place-items-center text-[12px] mt-px ${
                    item.done ? 'bg-done border-done text-accentInk' : 'border-line'
                  }`}
                >
                  {item.done ? '✓' : ''}
                </button>
                <div className={`text-[14.5px] leading-snug flex-1 ${item.done ? 'text-faint line-through' : ''}`}>
                  {item.text}
                </div>
                <button onClick={() => deleteItem(item.id)} className="text-faint hover:text-danger text-[15px] px-1">
                  ✕
                </button>
              </div>
              <Placer item={item} loc={{ type: 'unsorted' }} onAssign={assign} />
            </div>
          ))}
          {!state.unsorted.length && (
            <p className="text-faint text-[13px] px-0.5">Nothing waiting. Drop something in the bar above.</p>
          )}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="font-mono text-[11px] tracking-[0.12em] uppercase text-faint mb-2.5">This week</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
          {DAYS.map((d, di) => {
            const dDate = new Date(monday)
            dDate.setDate(dDate.getDate() + di)
            const items = state.days[d.key]
            return (
              <div
                key={d.key}
                className={`bg-surface border rounded-xl p-2.5 min-h-[120px] flex flex-col gap-2 shadow-sm ${
                  d.key === todayKey ? 'border-accent ring-1 ring-accent' : 'border-line'
                }`}
              >
                <div className="flex justify-between items-baseline font-mono text-[11px] text-dim">
                  <span className={d.key === todayKey ? 'text-accent' : ''}>{d.label}</span>
                  <span className="text-faint">
                    {dDate.getMonth() + 1}/{dDate.getDate()}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  {items.length === 0 && <div className="text-faint text-[11.5px] py-1.5">—</div>}
                  {items.map((it, idx) => (
                    <div key={it.id} className="bg-surface2 border border-line rounded-lg p-2 text-[12.5px]">
                      <div className="flex gap-1.5 items-start">
                        <button
                          onClick={() => toggleDone(it.id)}
                          className={`flex-none w-[15px] h-[15px] rounded border grid place-items-center text-[10px] mt-px ${
                            it.done ? 'bg-done border-done text-accentInk' : 'border-line'
                          }`}
                        >
                          {it.done ? '✓' : ''}
                        </button>
                        <div className={`flex-1 ${it.done ? 'text-faint line-through' : ''}`}>{it.text}</div>
                        <div className="flex gap-0.5">
                          <button
                            disabled={idx === 0}
                            onClick={() => move(it.id, 'up')}
                            className="text-faint hover:text-ink disabled:opacity-25 text-[11px] px-0.5"
                          >
                            ▲
                          </button>
                          <button
                            disabled={idx === items.length - 1}
                            onClick={() => move(it.id, 'down')}
                            className="text-faint hover:text-ink disabled:opacity-25 text-[11px] px-0.5"
                          >
                            ▼
                          </button>
                        </div>
                        <button onClick={() => deleteItem(it.id)} className="text-faint hover:text-danger text-[13px]">
                          ✕
                        </button>
                      </div>
                      <Placer item={it} loc={{ type: 'day', key: d.key }} onAssign={assign} mini />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="font-mono text-[11px] tracking-[0.12em] uppercase text-faint mb-2.5">
          Anytime, by urgency <span className="text-dim font-medium">({state.anytime.length})</span>
        </h2>
        <div className="flex flex-col gap-2">
          {state.anytime.map((it, idx) => (
            <div key={it.id} className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] text-faint w-[18px] text-right flex-none">{idx + 1}</span>
              <div className="bg-surface2 border border-line rounded-lg p-2 text-[12.5px] flex-1">
                <div className="flex gap-1.5 items-start">
                  <button
                    onClick={() => toggleDone(it.id)}
                    className={`flex-none w-[15px] h-[15px] rounded border grid place-items-center text-[10px] mt-px ${
                      it.done ? 'bg-done border-done text-accentInk' : 'border-line'
                    }`}
                  >
                    {it.done ? '✓' : ''}
                  </button>
                  <div className={`flex-1 ${it.done ? 'text-faint line-through' : ''}`}>{it.text}</div>
                  <button onClick={() => deleteItem(it.id)} className="text-faint hover:text-danger text-[13px]">
                    ✕
                  </button>
                </div>
                <Placer item={it} loc={{ type: 'anytime' }} onAssign={assign} mini />
              </div>
            </div>
          ))}
          {!state.anytime.length && (
            <p className="text-faint text-[13px] px-0.5">
              Nothing here. Anytime items float free of a specific day, ranked by urgency.
            </p>
          )}
        </div>
      </section>

      <footer className="text-faint text-[12px] font-mono mt-4">
        weekly bench ·{' '}
        {saveState === 'saving' ? 'saving…' : saveState === 'error' ? 'save failed' : 'saved'}
      </footer>
    </div>
  )
}
