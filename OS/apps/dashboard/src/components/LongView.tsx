import { useState } from 'react'
import type { Area, Goal, GoalStatus, LongViewState } from '../types'
import { uid } from '../lib/id'
import type { SaveState } from '../lib/useBoard'

function statusNext(s: GoalStatus): GoalStatus {
  return s === 'active' ? 'watch' : s === 'watch' ? 'done' : 'active'
}
function statusLabel(s: GoalStatus) {
  return s === 'active' ? 'Active' : s === 'watch' ? 'Watching' : 'Done'
}
function statusClasses(s: GoalStatus) {
  if (s === 'active') return 'bg-accentSoft text-accent border-accent'
  if (s === 'watch') return 'bg-watchSoft text-watch border-watch'
  return 'bg-surface2 text-done border-done'
}

export function LongView({
  state,
  onChange,
  saveState,
}: {
  state: LongViewState
  onChange: (s: LongViewState) => void
  saveState: SaveState
}) {
  const [areaInput, setAreaInput] = useState('')
  const [openMilestones, setOpenMilestones] = useState<Record<string, boolean>>({})
  const [goalInputs, setGoalInputs] = useState<Record<string, string>>({})
  const [milestoneInputs, setMilestoneInputs] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  function updateArea(id: string, fn: (a: Area) => Area) {
    onChange({ areas: state.areas.map((a) => (a.id === id ? fn(a) : a)) })
  }
  function updateGoal(areaId: string, goalId: string, fn: (g: Goal) => Goal) {
    updateArea(areaId, (a) => ({ ...a, goals: a.goals.map((g) => (g.id === goalId ? fn(g) : g)) }))
  }

  function addArea() {
    const name = areaInput.trim()
    if (!name) return
    onChange({ areas: [...state.areas, { id: uid(), name, goals: [] }] })
    setAreaInput('')
  }
  function deleteArea(id: string) {
    onChange({ areas: state.areas.filter((a) => a.id !== id) })
  }
  function addGoal(areaId: string) {
    const text = (goalInputs[areaId] || '').trim()
    if (!text) return
    updateArea(areaId, (a) => ({
      ...a,
      goals: [...a.goals, { id: uid(), text, why: '', target: '', status: 'active', milestones: [] }],
    }))
    setGoalInputs((s) => ({ ...s, [areaId]: '' }))
  }
  function deleteGoal(areaId: string, goalId: string) {
    updateArea(areaId, (a) => ({ ...a, goals: a.goals.filter((g) => g.id !== goalId) }))
  }
  function addMilestone(areaId: string, goalId: string) {
    const text = (milestoneInputs[goalId] || '').trim()
    if (!text) return
    updateGoal(areaId, goalId, (g) => ({
      ...g,
      milestones: [...g.milestones, { id: uid(), text, done: false }],
    }))
    setMilestoneInputs((s) => ({ ...s, [goalId]: '' }))
    setOpenMilestones((s) => ({ ...s, [goalId]: true }))
  }
  function copyGoal(g: Goal) {
    const open = g.milestones.filter((m) => !m.done)
    const summary = open.length ? open[0].text : g.milestones.length ? 'all milestones done' : ''
    const text = summary ? `${g.text} — next: ${summary}` : g.text
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(g.id)
      setTimeout(() => setCopiedId((c) => (c === g.id ? null : c)), 1200)
    })
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5">
        <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-faint">
          Areas · Goals · Milestones
        </p>
        <h1 className="font-serif text-2xl font-semibold text-ink mt-1 mb-1.5">The Long View</h1>
        <p className="text-dim text-[13.5px] max-w-[58ch]">
          The horizon this week's board works toward. Add a goal under an area, break it into
          milestones if it needs steps, and copy the next one into Weekly Bench when it's ready.
        </p>
      </div>

      <div className="flex gap-2.5 mb-6">
        <input
          value={areaInput}
          onChange={(e) => setAreaInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addArea()}
          type="text"
          placeholder="Add a life area (e.g. Tutoring, Portfolio)"
          maxLength={60}
          className="flex-1 border border-line bg-surface rounded-lg px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent min-w-0"
        />
        <button
          onClick={addArea}
          className="font-semibold text-[13px] bg-surface2 text-dim border border-line rounded-lg px-4 hover:text-ink hover:border-accent"
        >
          Add area
        </button>
      </div>

      {state.areas.map((area) => (
        <div key={area.id} className="bg-surface border border-line rounded-2xl p-4 mb-4 shadow-sm">
          <div className="flex justify-between items-baseline gap-2.5 mb-1">
            <div className="font-serif font-semibold text-lg">{area.name}</div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[11.5px] text-faint">
                {area.goals.length} goal{area.goals.length === 1 ? '' : 's'}
              </span>
              <button onClick={() => deleteArea(area.id)} className="text-faint hover:text-danger text-[13px]">
                remove area
              </button>
            </div>
          </div>

          <div className="flex gap-2 my-3">
            <input
              value={goalInputs[area.id] || ''}
              onChange={(e) => setGoalInputs((s) => ({ ...s, [area.id]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && addGoal(area.id)}
              type="text"
              placeholder={`Add a goal under ${area.name}`}
              maxLength={200}
              className="flex-1 border border-line bg-surface2 rounded-lg px-2.5 py-2 text-[13.5px] outline-none focus:ring-2 focus:ring-accent min-w-0"
            />
            <button
              onClick={() => addGoal(area.id)}
              className="font-semibold text-xs bg-accent text-accentInk rounded-md px-3.5 min-h-[34px]"
            >
              Add
            </button>
          </div>

          <div className="flex flex-col gap-2 mt-2.5">
            {area.goals.map((g) => {
              const isOpen = !!openMilestones[g.id]
              return (
                <div key={g.id} className="border border-line rounded-lg bg-surface2">
                  <div className="flex items-start gap-2.5 p-2.5">
                    <button
                      onClick={() => updateGoal(area.id, g.id, (goal) => ({ ...goal, status: statusNext(goal.status) }))}
                      className={`flex-none font-mono text-[9.5px] tracking-wide uppercase rounded-md px-2 py-1 border mt-px ${statusClasses(
                        g.status
                      )}`}
                    >
                      {statusLabel(g.status)}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className={`text-[14.5px] leading-snug ${g.status === 'done' ? 'text-faint line-through' : ''}`}>
                        {g.text}
                      </div>
                      <div className="flex gap-2 items-center mt-1.5 flex-wrap">
                        <input
                          value={g.target}
                          onChange={(e) => updateGoal(area.id, g.id, (goal) => ({ ...goal, target: e.target.value }))}
                          placeholder="target date / phrase"
                          className="font-mono text-[11px] text-dim bg-transparent border border-dashed border-line rounded px-1.5 py-1 outline-none focus:border-solid focus:border-accent w-[150px]"
                        />
                      </div>
                    </div>
                    <div className="flex gap-1 flex-none">
                      <button
                        onClick={() => setOpenMilestones((s) => ({ ...s, [g.id]: !isOpen }))}
                        className="text-faint hover:text-ink hover:bg-surface text-[13px] px-1.5 py-0.5 rounded"
                        title="Milestones"
                      >
                        {isOpen ? '▾' : '▸'} {g.milestones.length}
                      </button>
                      <button
                        onClick={() => copyGoal(g)}
                        className="text-faint hover:text-ink hover:bg-surface text-[13px] px-1.5 py-0.5 rounded"
                        title="Copy for Weekly Bench"
                      >
                        {copiedId === g.id ? 'copied' : '⧉'}
                      </button>
                      <button
                        onClick={() => deleteGoal(area.id, g.id)}
                        className="text-faint hover:text-danger text-[13px] px-1.5 py-0.5 rounded"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-line px-2.5 py-2.5">
                      {g.milestones.map((m) => (
                        <div key={m.id} className="flex items-center gap-2 py-0.5">
                          <button
                            onClick={() =>
                              updateGoal(area.id, g.id, (goal) => ({
                                ...goal,
                                milestones: goal.milestones.map((x) =>
                                  x.id === m.id ? { ...x, done: !x.done } : x
                                ),
                              }))
                            }
                            className={`flex-none w-[14px] h-[14px] rounded border grid place-items-center text-[9px] ${
                              m.done ? 'bg-done border-done text-accentInk' : 'border-line'
                            }`}
                          >
                            {m.done ? '✓' : ''}
                          </button>
                          <div className={`flex-1 text-[12.5px] ${m.done ? 'text-faint line-through' : 'text-dim'}`}>
                            {m.text}
                          </div>
                          <button
                            onClick={() =>
                              updateGoal(area.id, g.id, (goal) => ({
                                ...goal,
                                milestones: goal.milestones.filter((x) => x.id !== m.id),
                              }))
                            }
                            className="text-faint hover:text-danger text-[11px]"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {!g.milestones.length && (
                        <div className="text-faint text-[12.5px]">No milestones — this goal is one step.</div>
                      )}
                      <div className="flex gap-1.5 mt-1.5">
                        <input
                          value={milestoneInputs[g.id] || ''}
                          onChange={(e) => setMilestoneInputs((s) => ({ ...s, [g.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && addMilestone(area.id, g.id)}
                          placeholder="Add a milestone"
                          maxLength={160}
                          className="flex-1 border border-line bg-surface rounded-md px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-accent min-w-0"
                        />
                        <button
                          onClick={() => addMilestone(area.id, g.id)}
                          className="font-semibold text-[11px] bg-surface text-dim border border-line rounded-md px-2.5"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {!area.goals.length && <div className="text-faint text-[12.5px] px-0.5">Nothing here yet.</div>}
          </div>
        </div>
      ))}
      {!state.areas.length && <div className="text-faint text-[13.5px] py-5">No areas yet — add one above.</div>}

      <footer className="text-faint text-[12px] font-mono mt-4">
        the long view ·{' '}
        {saveState === 'saving' ? 'saving…' : saveState === 'error' ? 'save failed' : 'saved'}
      </footer>
    </div>
  )
}
