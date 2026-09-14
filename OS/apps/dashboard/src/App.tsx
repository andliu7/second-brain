import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { useBoard } from './lib/useBoard'
import { SignIn } from './components/SignIn'
import { WeeklyBench } from './components/WeeklyBench'
import { LongView } from './components/LongView'
import { TodayTriage } from './components/TodayTriage'
import { emptyBenchState, emptyLongViewState, emptyTriageState } from './types'
import { isoMondayOf } from './lib/id'

type Tab = 'today' | 'bench' | 'longview'

function Boards({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>('today')
  const userId = session.user.id

  const bench = useBoard(userId, 'weekly_bench', () => ({
    ...emptyBenchState(),
    weekStart: isoMondayOf(new Date()),
  }))
  const longView = useBoard(userId, 'long_view', emptyLongViewState)
  const triage = useBoard(userId, 'today_triage', emptyTriageState)

  const loading = !bench.data || !longView.data || !triage.data

  const tabs: { key: Tab; label: string }[] = [
    { key: 'today', label: 'Today & Triage' },
    { key: 'bench', label: 'Weekly Bench' },
    { key: 'longview', label: 'The Long View' },
  ]

  return (
    <div className="min-h-screen">
      <div className="border-b border-line bg-surface sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-5">
          <nav className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-3.5 text-sm font-medium border-b-2 -mb-px transition ${
                  tab === t.key ? 'border-accent text-ink' : 'border-transparent text-dim hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-[12.5px] text-faint">
            <span>{session.user.email}</span>
            <button onClick={() => supabase.auth.signOut()} className="hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="px-5 py-8">
        {loading && <p className="text-faint text-sm max-w-5xl mx-auto">Loading…</p>}
        {!loading && tab === 'today' && (
          <TodayTriage bench={bench.data!} state={triage.data!} onChange={triage.setData} saveState={triage.saveState} />
        )}
        {!loading && tab === 'bench' && (
          <WeeklyBench state={bench.data!} onChange={bench.setData} saveState={bench.saveState} />
        )}
        {!loading && tab === 'longview' && (
          <LongView state={longView.data!} onChange={longView.setData} saveState={longView.saveState} />
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) return null
  if (!session) return <SignIn />
  return <Boards session={session} />
}
