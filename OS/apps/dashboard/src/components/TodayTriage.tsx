import { useState } from 'react'
import type { BenchState, PipelineApp, PipelineStage, TriageState } from '../types'
import { STAGES } from '../types'
import { DAYS } from '../types'
import { uid, isoMondayOf } from '../lib/id'
import type { SaveState } from '../lib/useBoard'

function fmtAgo(ms: number) {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${Math.max(m, 1)}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d}d` : `${Math.floor(d / 30)}mo`
}

export function TodayTriage({
  bench,
  state,
  onChange,
  saveState,
}: {
  bench: BenchState
  state: TriageState
  onChange: (s: TriageState) => void
  saveState: SaveState
}) {
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [link, setLink] = useState('')

  const todayKey = DAYS[(new Date().getDay() + 6) % 7].key
  const todayLabel = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const showingBench = bench.weekStart === isoMondayOf(new Date())
  const todayItems = showingBench ? bench.days[todayKey] : []
  const topAnytime = showingBench ? bench.anytime.slice(0, 5) : []

  function addApp(e: React.FormEvent) {
    e.preventDefault()
    const co = company.trim()
    if (!co) return
    const next: PipelineApp = {
      id: uid(),
      company: co,
      role: role.trim(),
      link: link.trim(),
      stage: 'Applied',
      added: new Date().toISOString(),
    }
    onChange({ pipeline: [next, ...state.pipeline] })
    setCompany('')
    setRole('')
    setLink('')
  }
  function setStage(id: string, stage: PipelineStage) {
    onChange({ pipeline: state.pipeline.map((a) => (a.id === id ? { ...a, stage } : a)) })
  }
  function removeApp(id: string) {
    onChange({ pipeline: state.pipeline.filter((a) => a.id !== id) })
  }

  const counts = Object.fromEntries(STAGES.map((s) => [s, state.pipeline.filter((a) => a.stage === s).length])) as Record<
    PipelineStage,
    number
  >
  const sorted = [...state.pipeline].sort((a, b) => +new Date(b.added) - +new Date(a.added))

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint">{todayLabel}</p>
        <h1 className="font-serif text-2xl font-semibold text-ink mt-1">Today &amp; Triage</h1>
      </div>

      <div className="bg-watchSoft border border-watch text-ink rounded-xl px-4 py-3 mb-6 text-[13px] leading-relaxed">
        Live Gmail / Calendar / Drive feeds from the old claude.ai version don't carry over to a
        standalone site — those only work inside a Claude artifact. This view instead pulls
        <b> today's Weekly Bench items</b> below. If you want your real Google Calendar showing
        up here too, that's a separate follow-up (its own Google Cloud OAuth app) — say the word
        and we'll wire it in.
      </div>

      <section className="mb-6">
        <h2 className="font-mono text-[11px] tracking-[0.12em] uppercase text-faint mb-2.5">
          Today, from Weekly Bench
        </h2>
        <div className="bg-surface border border-line rounded-xl p-4 shadow-sm">
          {!showingBench && (
            <p className="text-faint text-[13px]">
              Weekly Bench hasn't been rolled to this week yet — open it and roll the week to see
              today's items here.
            </p>
          )}
          {showingBench && todayItems.length === 0 && (
            <p className="text-faint text-[13px]">Nothing placed on today yet.</p>
          )}
          {showingBench &&
            todayItems.map((it) => (
              <div key={it.id} className={`text-[14px] py-1.5 ${it.done ? 'text-faint line-through' : 'text-ink'}`}>
                {it.text}
              </div>
            ))}
        </div>
      </section>

      {showingBench && topAnytime.length > 0 && (
        <section className="mb-6">
          <h2 className="font-mono text-[11px] tracking-[0.12em] uppercase text-faint mb-2.5">
            Worth a look — top of the anytime list
          </h2>
          <div className="bg-surface border border-line rounded-xl p-4 shadow-sm flex flex-col gap-1.5">
            {topAnytime.map((it, i) => (
              <div key={it.id} className="text-[13.5px] text-dim">
                <span className="font-mono text-faint mr-2">{i + 1}</span>
                {it.text}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-surface border border-line rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line flex justify-between items-baseline">
          <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-faint">Internship pipeline</p>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 border-b border-line">
          {STAGES.map((s) => (
            <div key={s} className="px-4 py-3.5 border-l border-line first:border-l-0">
              <p className="font-mono text-2xl font-medium text-dim tabular-nums">{counts[s]}</p>
              <p className="text-faint text-[11.5px]">{s}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-faint font-mono text-[10px] tracking-[0.08em] uppercase">
                <th className="text-left px-3 py-2.5 border-b border-line font-normal">Company</th>
                <th className="text-left px-3 py-2.5 border-b border-line font-normal">Role</th>
                <th className="text-left px-3 py-2.5 border-b border-line font-normal">Stage</th>
                <th className="text-left px-3 py-2.5 border-b border-line font-normal">Applied</th>
                <th className="px-3 py-2.5 border-b border-line"></th>
                <th className="px-3 py-2.5 border-b border-line"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2.5 border-b border-line font-semibold">{a.company}</td>
                  <td className="px-3 py-2.5 border-b border-line text-dim">{a.role || '—'}</td>
                  <td className="px-3 py-2.5 border-b border-line">
                    <select
                      value={a.stage}
                      onChange={(e) => setStage(a.id, e.target.value as PipelineStage)}
                      className="font-mono text-[11px] bg-surface2 text-dim border border-line rounded px-1.5 py-1"
                    >
                      {STAGES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 border-b border-line font-mono text-faint text-[12px]">
                    {fmtAgo(Date.now() - +new Date(a.added))} ago
                  </td>
                  <td className="px-3 py-2.5 border-b border-line">
                    {a.link && (
                      <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-accent text-xs">
                        open
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2.5 border-b border-line">
                    <button onClick={() => removeApp(a.id)} className="text-faint hover:text-danger px-1.5">
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {!sorted.length && (
                <tr>
                  <td colSpan={6} className="text-faint px-3 py-4">
                    No applications logged yet. Add the first one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <form onSubmit={addApp} className="flex flex-wrap gap-2 px-4 py-3.5 bg-surface2 border-t border-line items-center">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company"
            required
            className="flex-1 min-w-[130px] border border-line bg-surface rounded-md px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role"
            className="flex-[1.6] min-w-[170px] border border-line bg-surface rounded-md px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Link (optional)"
            type="url"
            className="flex-[1.4] min-w-[150px] border border-line bg-surface rounded-md px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-accent"
          />
          <button type="submit" className="font-semibold text-[12.5px] bg-accent text-accentInk rounded-md px-3.5 py-1.5">
            Add
          </button>
        </form>
      </section>

      <footer className="text-faint text-[12px] font-mono mt-4">
        today &amp; triage ·{' '}
        {saveState === 'saving' ? 'saving…' : saveState === 'error' ? 'save failed' : 'saved'}
      </footer>
    </div>
  )
}
