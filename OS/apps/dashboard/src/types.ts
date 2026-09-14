export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export const DAYS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
]

export type BenchItem = { id: string; text: string; done: boolean }

export type BenchState = {
  weekStart: string
  unsorted: BenchItem[]
  days: Record<DayKey, BenchItem[]>
  anytime: BenchItem[]
}

export function emptyBenchState(): BenchState {
  return {
    weekStart: '',
    unsorted: [],
    days: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
    anytime: [],
  }
}

export type Milestone = { id: string; text: string; done: boolean }
export type GoalStatus = 'active' | 'watch' | 'done'
export type Goal = {
  id: string
  text: string
  why: string
  target: string
  status: GoalStatus
  milestones: Milestone[]
}
export type Area = { id: string; name: string; goals: Goal[] }
export type LongViewState = { areas: Area[] }

export function emptyLongViewState(): LongViewState {
  return { areas: [] }
}

export type PipelineStage = 'Applied' | 'OA' | 'Interview' | 'Offer' | 'Rejected'
export const STAGES: PipelineStage[] = ['Applied', 'OA', 'Interview', 'Offer', 'Rejected']
export type PipelineApp = {
  id: string
  company: string
  role: string
  link: string
  stage: PipelineStage
  added: string
}
export type TriageState = { pipeline: PipelineApp[] }

export function emptyTriageState(): TriageState {
  return { pipeline: [] }
}
