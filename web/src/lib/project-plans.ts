// Project plans in the browser: the calls to server/project-plans.mjs, the key a project folder maps to,
// the one-line summary a Projects row shows, and the summary andliu.ai reads. The plans themselves live
// in ~/.brain/project-plans on this computer, never in the workspace, so everything here goes through the API.
import type { StageStatus } from '../types';
import { api } from './api';

export type PlanStage = { id: string; title: string; status: StageStatus; detail?: string; progress?: number; output?: string; doneOn?: string; startedAt?: string; endedAt?: string };
export type ProjectPlan = { key: string; name: string; updated: string; walkthrough: string; pipeline: { subtitle: string; layout: 'vertical' | 'horizontal'; stages: PlanStage[] } };
export type PlanSummary = { key: string; name: string; updated: string; total: number; done: number; counts: Record<StageStatus, number>; active: string[]; next: string };
export type StageFields = { status?: StageStatus; detail?: string; progress?: number | null; output?: string };

// A project's folder under Projects/ to its plan's key: grignard/grignard-app-source is grignard__grignard-app-source.
export const planKey = (folder: string) => folder.replace(/[\\/]/g, '__');
export const planFile = (key: string) => `~/.brain/project-plans/${key}.json`;
const route = (key: string) => 'project-plans/' + encodeURIComponent(key);

// A reply without a list (an older server, a stand-in) reads as no plans rather than failing its caller.
export const fetchPlanSummaries = async () => { const reply = await api<{ plans?: PlanSummary[] }>('project-plans'); return Array.isArray(reply.plans) ? reply.plans : []; };
export const fetchPlan = async (key: string) => (await api<{ plan?: ProjectPlan | null }>(route(key))).plan ?? null;
export const saveStage = async (key: string, id: string, fields: StageFields) => (await api<{ plan: ProjectPlan }>(`${route(key)}/stages/${encodeURIComponent(id)}`, fields, 'PUT')).plan;
export const addPlanStage = async (key: string, title: string) => (await api<{ plan: ProjectPlan }>(`${route(key)}/stages`, { title })).plan;

// "5 of 9 stages · 1 active": the running count only when something is running.
export const summaryText = (plan: PlanSummary) => `${plan.done} of ${plan.total} stages${plan.counts.active ? ` · ${plan.counts.active} active` : ''}`;

// For the andliu.ai chat, beside pipelinesContext (lib/pipeline.ts): one line per plan with what is running
// and what is next, cut at `budget` characters. Empty when there are no plans or the API cannot be reached
// (a hosted deploy), so the caller can leave it out and a chat never fails because of it.
export async function projectPlansContext(budget = 3000): Promise<string> {
  let plans: PlanSummary[];
  try { plans = await fetchPlanSummaries(); } catch { return ''; }
  if (!plans.length) return '';
  const lines = ['Project plans (walkthrough and delivery pipeline per project, from ~/.brain/project-plans):'];
  for (const plan of plans) {
    const parts = [`${plan.done} of ${plan.total} stages done`, plan.active.length ? `active: ${plan.active.join(', ')}` : '', plan.next ? `next: ${plan.next}` : ''].filter(Boolean);
    lines.push(`- ${plan.name}: ${parts.join('; ')}`);
  }
  const text = lines.join('\n');
  return text.length > budget ? text.slice(0, budget - 1) + '…' : text;
}
