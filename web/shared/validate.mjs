// Shared by browser persistence/import and the local backup endpoint. Validation
// deliberately returns the original value so supported extensions are not lost.
const MiB = 1024 * 1024;
const MAX_ASSET_BYTES = 25 * MiB;
const MAX_EMBEDDED_BYTES = 160 * MiB;
const MAX_TEXT_CHARS = 220 * MiB;
// 'overview' was the front page before Today; workspaces and backups from then still carry it in their activity.
const PAGES = ['today', 'projects', 'overview', 'board', 'files', 'skills', 'goals', 'network', 'chat', 'generate', 'settings'];
const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp']);
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+\-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+\-]{0,126}$/i;
// The category ids of src/lib/categories.ts, which this shared module cannot import. Keep the two lists the same.
const CATEGORY_IDS = ['project', 'family', 'academic', 'professional', 'fitness', 'relationships', 'urgent', 'other'];

function invalid(path, reason) {
  throw new Error(`Invalid workspace: ${path} ${reason}`);
}

function object(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'must be an object');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path, 'must be a plain object');
}

function string(value, path, max, nonempty = false) {
  if (typeof value !== 'string') invalid(path, 'must be a string');
  if (value.length > max) invalid(path, `exceeds ${max} characters`);
  if (nonempty && !value.trim()) invalid(path, 'must not be empty');
}

function optionalString(value, path, max) {
  if (value !== undefined) string(value, path, max);
}

function boolean(value, path) {
  if (typeof value !== 'boolean') invalid(path, 'must be a boolean');
}

function oneOf(value, path, choices) {
  if (!choices.includes(value)) invalid(path, `must be one of: ${choices.join(', ')}`);
}

function array(value, path, max) {
  if (!Array.isArray(value)) invalid(path, 'must be an array');
  if (value.length > max) invalid(path, `exceeds ${max} items`);
}

function id(value, path, seen) {
  string(value, path, 256, true);
  if (seen.has(value)) invalid(path, `contains duplicate ID ${JSON.stringify(value)}`);
  seen.add(value);
}

function dateOnly(value, path) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(path, 'must be a valid YYYY-MM-DD date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(path, 'must be a real calendar date');
}

function timestamp(value, path) {
  string(value, path, 64, true);
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) invalid(path, 'must be an ISO timestamp with a timezone');
  dateOnly(parts[1], path);
  if (+parts[2] > 23 || +parts[3] > 59 || +parts[4] > 59 || !Number.isFinite(Date.parse(value))) invalid(path, 'must be a valid timestamp');
  if (parts[5] !== 'Z' && (+parts[5].slice(1, 3) > 23 || +parts[5].slice(4, 6) > 59)) invalid(path, 'contains an invalid timezone');
}

function base64Digit(code) {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 71;
  if (code >= 48 && code <= 57) return code + 4;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

function dataUrl(value, path, rasterOnly, budget) {
  string(value, path, Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 512);
  const comma = value.indexOf(',');
  if (comma < 0 || comma > 511) invalid(path, 'must be a base64 data URL');
  const header = value.slice(0, comma);
  const match = /^data:([^;,]+)((?:;[^;,]+)*);base64$/i.exec(header);
  if (!match || !MIME.test(match[1])) invalid(path, 'must be a base64 data URL with a valid MIME type');
  // Permit ordinary MIME parameters on downloadable file data, never on images.
  if (match[2] && (rasterOnly || !/^(?:;[a-z0-9!#$&^_.+\-]+=[a-z0-9!#$&^_.+\-]+)+$/i.test(match[2]))) invalid(path, 'contains unsupported MIME parameters');
  const mime = match[1].toLowerCase();
  if (rasterOnly && !RASTER_MIMES.has(mime)) invalid(path, 'must contain a raster image (PNG, JPEG, WebP, GIF, AVIF, or BMP)');
  const start = comma + 1;
  const length = value.length - start;
  if (length % 4 !== 0) invalid(path, 'contains invalid base64 length');
  let padding = 0;
  if (length && value.endsWith('=')) padding = value.endsWith('==') ? 2 : 1;
  const end = value.length - padding;
  // Scan instead of matching one enormous regex: large valid attachments should
  // neither overflow a regular-expression stack nor allocate a decoded copy.
  for (let i = start; i < end; i++) if (base64Digit(value.charCodeAt(i)) < 0) invalid(path, 'contains invalid base64 characters');
  if (padding && (length < 4 || end === start)) invalid(path, 'contains invalid base64 padding');
  if (padding === 2 && (base64Digit(value.charCodeAt(end - 1)) & 15)) invalid(path, 'contains noncanonical base64 padding');
  if (padding === 1 && (base64Digit(value.charCodeAt(end - 1)) & 3)) invalid(path, 'contains noncanonical base64 padding');
  const bytes = length / 4 * 3 - padding;
  if (bytes > MAX_ASSET_BYTES) invalid(path, 'exceeds the 25 MiB attachment limit');
  if (rasterOnly && bytes === 0) invalid(path, 'must not contain an empty image');
  budget.bytes += bytes;
  if (budget.bytes > MAX_EMBEDDED_BYTES) invalid(path, 'exceeds the 160 MiB total attachment limit');
  return { bytes, mime };
}

function records(values, path, max, validate) {
  array(values, path, max);
  const seen = new Set();
  for (let i = 0; i < values.length; i++) {
    const entryPath = `${path}[${i}]`;
    object(values[i], entryPath);
    id(values[i].id, `${entryPath}.id`, seen);
    validate(values[i], entryPath);
  }
}

// Extensions may be preserved, but must remain bounded, serializable data.
function boundedData(value, path, depth, budget, ancestors) {
  if (++budget.nodes > 300000) invalid(path, 'exceeds the workspace complexity limit');
  if (depth > 32) invalid(path, 'exceeds 32 levels of nesting');
  if (typeof value === 'string') {
    budget.chars += value.length;
    if (budget.chars > MAX_TEXT_CHARS) invalid(path, 'exceeds the total workspace text limit');
    if (value.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 512) invalid(path, 'contains an oversized string');
    return;
  }
  if (value === null || typeof value === 'boolean' || value === undefined) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(path, 'must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') invalid(path, 'must contain only serializable data');
  if (ancestors.has(value)) invalid(path, 'contains a circular reference');
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (value.length > 100000) invalid(path, 'contains an oversized array');
    for (let i = 0; i < value.length; i++) boundedData(value[i], `${path}[${i}]`, depth + 1, budget, ancestors);
  } else {
    object(value, path);
    const keys = Object.keys(value);
    if (keys.length > 1000) invalid(path, 'contains too many object fields');
    for (const key of keys) {
      if (key.length > 512) invalid(path, 'contains an oversized field name');
      boundedData(value[key], `${path}.${key}`, depth + 1, budget, ancestors);
    }
  }
  ancestors.delete(value);
}

/** Validate a version-1 workspace without modifying or pruning any fields. */
export function validateWorkspace(value) {
  object(value, 'workspace');
  if (value.version !== 1) invalid('version', 'must equal 1');
  const budget = { bytes: 0 };
  records(value.docs, 'docs', 10000, (doc, path) => {
    string(doc.name, `${path}.name`, 1024, true);
    string(doc.content, `${path}.content`, MiB);
    oneOf(doc.kind, `${path}.kind`, ['note', 'file', 'skill']);
    array(doc.tags, `${path}.tags`, 100);
    for (let i = 0; i < doc.tags.length; i++) string(doc.tags[i], `${path}.tags[${i}]`, 256, true);
    boolean(doc.pinned, `${path}.pinned`);
    timestamp(doc.created, `${path}.created`);
    timestamp(doc.updated, `${path}.updated`);
    optionalString(doc.mime, `${path}.mime`, 512);
    optionalString(doc.source, `${path}.source`, 8192);
    if (doc.size !== undefined && (!Number.isSafeInteger(doc.size) || doc.size < 0 || doc.size > MAX_ASSET_BYTES)) invalid(`${path}.size`, 'must be an integer from 0 to 25 MiB');
    if (doc.data !== undefined) {
      const asset = dataUrl(doc.data, `${path}.data`, false, budget);
      if (doc.size !== undefined && doc.size !== asset.bytes) invalid(`${path}.size`, 'must match the attachment byte count');
      if (doc.mime && doc.mime.split(';')[0].toLowerCase() !== asset.mime) invalid(`${path}.mime`, 'must match the attachment MIME type');
    }
  });
  records(value.goals, 'goals', 10000, (goal, path) => {
    string(goal.title, `${path}.title`, 1024, true);
    string(goal.description, `${path}.description`, MiB);
    string(goal.category, `${path}.category`, 256);
    string(goal.due, `${path}.due`, 10);
    if (goal.due) dateOnly(goal.due, `${path}.due`);
    boolean(goal.archived, `${path}.archived`);
    timestamp(goal.created, `${path}.created`);
    records(goal.milestones, `${path}.milestones`, 1000, (milestone, milestonePath) => {
      string(milestone.title, `${milestonePath}.title`, 4096, true);
      boolean(milestone.done, `${milestonePath}.done`);
    });
  });
  records(value.conversations, 'conversations', 10000, (conversation, path) => {
    string(conversation.title, `${path}.title`, 1024, true);
    timestamp(conversation.updated, `${path}.updated`);
    records(conversation.messages, `${path}.messages`, 10000, (message, messagePath) => {
      oneOf(message.role, `${messagePath}.role`, ['user', 'assistant']);
      string(message.content, `${messagePath}.content`, MiB);
      timestamp(message.created, `${messagePath}.created`);
      optionalString(message.provider, `${messagePath}.provider`, 256);
      optionalString(message.model, `${messagePath}.model`, 512);
    });
  });
  records(value.generations, 'generations', 10000, (generation, path) => {
    string(generation.prompt, `${path}.prompt`, 65536, true);
    string(generation.provider, `${path}.provider`, 256, true);
    string(generation.model, `${path}.model`, 512, true);
    string(generation.aspect, `${path}.aspect`, 64, true);
    timestamp(generation.created, `${path}.created`);
    oneOf(generation.status, `${path}.status`, ['queued', 'complete', 'failed']);
    optionalString(generation.job, `${path}.job`, 2048);
    optionalString(generation.error, `${path}.error`, 65536);
    array(generation.images, `${path}.images`, 128);
    for (let i = 0; i < generation.images.length; i++) dataUrl(generation.images[i], `${path}.images[${i}]`, true, budget);
    if (generation.status === 'complete' && !generation.images.length) invalid(`${path}.images`, 'must include an image for a completed generation');
  });
  records(value.activity, 'activity', 10000, (entry, path) => {
    string(entry.text, `${path}.text`, 4096, true);
    oneOf(entry.page, `${path}.page`, PAGES);
    timestamp(entry.created, `${path}.created`);
  });
  if (value.relations !== undefined) {
    const nodeIds = new Set([...value.docs.map(d => 'doc:' + d.id), ...value.goals.map(g => 'goal:' + g.id)]);
    const triples = new Set();
    records(value.relations, 'relations', 100000, (edge, path) => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) invalid(path, 'must connect two existing, distinct items');
      oneOf(edge.relation, path + '.relation', ['references', 'supports', 'depends_on', 'uses_skill', 'related_to']);
      if (edge.relation === 'uses_skill' && !value.docs.some(d => d.kind === 'skill' && 'doc:' + d.id === edge.target)) invalid(path, 'uses_skill must point to a skill');
      const triple = edge.source + '|' + edge.target + '|' + edge.relation;
      if (triples.has(triple)) invalid(path, 'contains a duplicate relationship');
      triples.add(triple);
      timestamp(edge.created, path + '.created');
    });
  }
  // The kanban board came later than the workspace, so a saved workspace without one is still valid.
  if (value.board !== undefined) {
    object(value.board, 'board');
    oneOf(value.board.view, 'board.view', ['board', 'sticky']);
    records(value.board.columns, 'board.columns', 100, (column, path) => string(column.name, `${path}.name`, 256, true));
    const columnIds = new Set(value.board.columns.map(c => c.id));
    const docIds = new Set(value.docs.map(d => d.id));
    records(value.board.cards, 'board.cards', 10000, (card, path) => {
      string(card.title, `${path}.title`, 1024, true);
      string(card.notes, `${path}.notes`, MiB);
      if (!columnIds.has(card.column)) invalid(`${path}.column`, 'must name an existing column');
      if (card.category !== undefined) oneOf(card.category, `${path}.category`, CATEGORY_IDS);
      if (card.minutes !== undefined && (!Number.isSafeInteger(card.minutes) || card.minutes < 0)) invalid(`${path}.minutes`, 'must be a whole number of minutes');
      optionalString(card.sourceTodoId, `${path}.sourceTodoId`, 1024);
      records(card.checklist, `${path}.checklist`, 1000, (item, itemPath) => {
        string(item.title, `${itemPath}.title`, 4096, true);
        boolean(item.done, `${itemPath}.done`);
      });
      array(card.attachments, `${path}.attachments`, 100);
      for (let i = 0; i < card.attachments.length; i++) if (!docIds.has(card.attachments[i])) invalid(`${path}.attachments[${i}]`, 'must name an existing doc');
      if (card.due !== undefined) { string(card.due, `${path}.due`, 10); dateOnly(card.due, `${path}.due`); }
      optionalString(card.eventId, `${path}.eventId`, 1024);
      if (card.sticky !== undefined) {
        object(card.sticky, `${path}.sticky`);
        for (const key of ['x', 'y', 'rotate']) if (!Number.isFinite(card.sticky[key])) invalid(`${path}.sticky.${key}`, 'must be a finite number');
      }
    });
  }
  // The daily todo card and the to-buy list came later still, so both are optional too.
  if (value.todos !== undefined) {
    object(value.todos, 'todos');
    string(value.todos.day, 'todos.day', 10, true); dateOnly(value.todos.day, 'todos.day');
    const todo = (item, path) => {
      string(item.text, `${path}.text`, 1024, true);
      boolean(item.done, `${path}.done`);
      oneOf(item.category, `${path}.category`, CATEGORY_IDS);
      if (item.minutes !== undefined && (!Number.isSafeInteger(item.minutes) || item.minutes < 0 || item.minutes > 1440)) invalid(`${path}.minutes`, 'must be an integer from 0 to 1440');
      optionalString(item.goal, `${path}.goal`, 1024);
      if (item.time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) invalid(`${path}.time`, 'must be HH:MM');
      optionalString(item.defaultKey, `${path}.defaultKey`, 64);
    };
    records(value.todos.items, 'todos.items', 1000, todo);
    object(value.todos.history, 'todos.history');
    const days = Object.keys(value.todos.history);
    if (days.length > 366) invalid('todos.history', 'exceeds 366 days');
    for (const day of days) { dateOnly(day, `todos.history.${day}`); records(value.todos.history[day], `todos.history.${day}`, 1000, todo); }
    array(value.todos.removedDefaults, 'todos.removedDefaults', 100);
    for (let i = 0; i < value.todos.removedDefaults.length; i++) string(value.todos.removedDefaults[i], `todos.removedDefaults[${i}]`, 64, true);
  }
  if (value.buyList !== undefined) {
    records(value.buyList, 'buyList', 10000, (item, path) => {
      string(item.name, `${path}.name`, 1024, true);
      oneOf(item.category, `${path}.category`, CATEGORY_IDS);
      string(item.image, `${path}.image`, 8192);
      string(item.notes, `${path}.notes`, 65536);
      array(item.links, `${path}.links`, 100);
      for (let i = 0; i < item.links.length; i++) string(item.links[i], `${path}.links[${i}]`, 8192, true);
      records(item.options, `${path}.options`, 100, (option, optionPath) => {
        string(option.store, `${optionPath}.store`, 256);
        if (option.price !== null && (typeof option.price !== 'number' || !Number.isFinite(option.price) || option.price < 0)) invalid(`${optionPath}.price`, 'must be null or a non-negative number');
        string(option.currency, `${optionPath}.currency`, 8);
        if (option.rating !== null && (typeof option.rating !== 'number' || !Number.isFinite(option.rating) || option.rating < 0 || option.rating > 5)) invalid(`${optionPath}.rating`, 'must be null or a number from 0 to 5');
        string(option.notes, `${optionPath}.notes`, 4096);
        string(option.link, `${optionPath}.link`, 8192);
      });
    });
  }
  // Favourites are optional too; each list holds distinct, non-empty ids.
  if (value.favorites !== undefined) {
    object(value.favorites, 'favorites');
    for (const kind of ['skills', 'projects']) {
      array(value.favorites[kind], `favorites.${kind}`, 10000);
      const seen = new Set();
      for (let i = 0; i < value.favorites[kind].length; i++) id(value.favorites[kind][i], `favorites.${kind}[${i}]`, seen);
    }
  }
  boundedData(value, 'workspace', 0, { nodes: 0, chars: 0 }, new Set());
  return value;
}
