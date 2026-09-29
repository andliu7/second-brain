// A project's pipeline: the rules both sides share. The browser (src/lib/pipeline.ts, the Pipeline view)
// and the server mirror (server/pipelines.mjs, which Claude Code reaches through scripts/pipeline.mjs)
// import this one file, so a status, a bound or the merge rule cannot mean one thing in the app and
// another on disk. shared/validate.mjs uses stageProblem and pipelineProblem for the same reason.
//
// A stage is a project card's checklist item (src/types.ts ChecklistItem) with optional pipeline fields.
// `done` stays the field every older view reads (the board card's "3 of 7", StageTimeline's tick), so
// every status change here writes both. When the two disagree, `done` wins: the card dialog's checklist
// can tick an item without knowing about statuses, and that tick must still show.

export const STATUSES = ['pending', 'queued', 'active', 'paused', 'completed', 'warning', 'failed', 'skipped', 'cancelled'];
// The statuses that count as finished for `done` and for "n of m stages".
export const DONE_STATUSES = ['completed', 'warning', 'skipped'];
// Bounds, one place. Logs are capped by count and by line so a chatty agent cannot grow the workspace
// without end: appending past LOG_LINES drops the oldest lines.
export const LIMITS = { logLines: 200, logLine: 2000, text: 8192, output: 16384, title: 4096, subtitle: 1024, attempt: 1000, stages: 1000 };
export const LAYOUTS = ['vertical', 'horizontal'];

export const isDone = status => DONE_STATUSES.includes(status);
export function statusOf(item) {
  if (STATUSES.includes(item.status) && isDone(item.status) === Boolean(item.done)) return item.status;
  return item.done ? 'completed' : 'pending';
}

const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// A stage moved to a new status, with its clock fields kept honest: startedAt the first time it runs,
// endedAt when it stops, doneOn (the day StageTimeline shows) when it counts as done. updatedAt is the
// stamp the merge compares, so every change goes through here or through touch().
export function withStatus(item, status, now = new Date()) {
  const stamp = now.toISOString(), was = statusOf(item);
  const next = { ...item, status, done: isDone(status), updatedAt: stamp };
  if (isDone(status)) { if (!item.done) next.doneOn = localDay(now); } else delete next.doneOn;
  if (status === 'active' && (!item.startedAt || was === 'pending' || was === 'queued')) next.startedAt = stamp;
  if (status === 'active' || status === 'paused' || status === 'pending' || status === 'queued') delete next.endedAt;
  else if (was !== status) next.endedAt = stamp;
  if (status === 'pending' || status === 'queued') delete next.startedAt;
  return next;
}
export const touch = (item, fields, now = new Date()) => ({ ...item, ...fields, updatedAt: now.toISOString() });
// Append log lines, keeping the newest LIMITS.logLines, each cut to LIMITS.logLine characters.
export function appendLogs(item, lines, now = new Date()) {
  const clean = lines.map(line => String(line).slice(0, LIMITS.logLine)).filter(line => line.trim());
  return touch(item, { logs: [...(item.logs || []), ...clean].slice(-LIMITS.logLines) }, now);
}

// Merge two copies of one pipeline's stages, stage by stage, last write wins on updatedAt.
//   mine: the copy doing the merge, whose order and deletions stand
//   theirs: the other copy
//   seen: when mine last read theirs. A stage only theirs has is new to mine if it changed after that
//     (Claude added it); otherwise mine saw it and deleted it, and it stays deleted.
// The browser merges with mine = the workspace and theirs = the mirror; the server with mine = the push
// and theirs = what is on disk, so the same rule runs in both directions.
export function mergeStages(mine, theirs, seen = '') {
  const other = new Map(theirs.map(stage => [stage.id, stage]));
  const have = new Set(mine.map(stage => stage.id));
  const merged = mine.map(stage => { const them = other.get(stage.id); return them && (them.updatedAt || '') > (stage.updatedAt || '') ? them : stage; });
  for (const stage of theirs) if (!have.has(stage.id) && (stage.updatedAt || '') > (seen || '')) merged.push(stage);
  return merged;
}

// Validation. Each returns null, or { field, reason } for the first problem, so validate.mjs can put its
// own path in front and the server can answer 400 with the same words.
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const badString = (value, max) => typeof value !== 'string' ? 'must be a string' : value.length > max ? `exceeds ${max} characters` : null;
export function stageProblem(item) {
  const check = (field, reason) => reason ? { field, reason } : null;
  const found = [
    item.status !== undefined && check('status', STATUSES.includes(item.status) ? null : `must be one of: ${STATUSES.join(', ')}`),
    item.progress !== undefined && check('progress', typeof item.progress === 'number' && Number.isFinite(item.progress) && item.progress >= 0 && item.progress <= 100 ? null : 'must be a number from 0 to 100'),
    ...['startedAt', 'endedAt', 'updatedAt'].map(key => item[key] !== undefined && check(key, typeof item[key] === 'string' && STAMP.test(item[key]) && Number.isFinite(Date.parse(item[key])) ? null : 'must be an ISO timestamp with a timezone')),
    item.attempt !== undefined && check('attempt', Number.isSafeInteger(item.attempt) && item.attempt >= 1 && item.attempt <= LIMITS.attempt ? null : `must be a whole number from 1 to ${LIMITS.attempt}`),
    ...['error', 'warning'].map(key => item[key] !== undefined && check(key, badString(item[key], LIMITS.text))),
    item.output !== undefined && check('output', badString(item.output, LIMITS.output)),
    item.skippable !== undefined && check('skippable', typeof item.skippable === 'boolean' ? null : 'must be a boolean'),
    item.logs !== undefined && check('logs', !Array.isArray(item.logs) ? 'must be an array' : item.logs.length > LIMITS.logLines ? `exceeds ${LIMITS.logLines} lines` : item.logs.some(line => badString(line, LIMITS.logLine)) ? `must hold strings of at most ${LIMITS.logLine} characters` : null),
  ].find(Boolean);
  return found || null;
}
export function pipelineProblem(pipeline) {
  if (pipeline === null || typeof pipeline !== 'object' || Array.isArray(pipeline)) return { field: '', reason: 'must be an object' };
  if (typeof pipeline.enabled !== 'boolean') return { field: 'enabled', reason: 'must be a boolean' };
  if (!LAYOUTS.includes(pipeline.layout)) return { field: 'layout', reason: `must be one of: ${LAYOUTS.join(', ')}` };
  if (pipeline.subtitle !== undefined) { const reason = badString(pipeline.subtitle, LIMITS.subtitle); if (reason) return { field: 'subtitle', reason }; }
  return null;
}
