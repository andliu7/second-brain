// The Projects page's Links section (src/Projects.tsx) reads ~/.brain/links.json through GET /api/links.
// The file lives in the user profile, not the repo, because it names this machine's private addresses and
// the repo is public. It is hand edited, so everything in it is treated as untrusted: counts and lengths are
// bounded, only http and https URLs survive (a javascript: or file: link would run or open something the
// moment it is clicked), and a bad link is skipped and named in `error` rather than failing the whole file.
// A missing file is simply no links; a file that cannot be parsed is no links plus a readable error, never a 500.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const linksFile = () => path.join(os.homedir(), '.brain', 'links.json');
const MAX_BYTES = 100000, MAX_GROUPS = 20, MAX_LINKS = 60, MAX_TEXT = 120, MAX_URL = 500;
const SHOWN = '~/.brain/links.json';

// A trimmed string no longer than max, or undefined when it is not one.
const text = (value, max = MAX_TEXT) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;

// One link, or the reason it was skipped.
function checkLink(link) {
  if (!link || typeof link !== 'object') return 'not an object';
  const label = text(link.label);
  if (!label) return 'a label is missing or too long';
  const url = text(link.url, MAX_URL);
  if (!url) return `"${label}" has no url, or one too long`;
  let parsed;
  try { parsed = new URL(url); } catch { return `"${label}" is not a full URL`; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `"${label}" is not an http or https link`;
  const out = { label, url };
  const note = text(link.note); if (note) out.note = note;
  // project is a folder path the Projects page lists, such as grignard/grignard-app-source; nothing else is kept.
  const project = text(link.project); if (project && /^[\w.\-/]+$/.test(project)) out.project = project;
  return out;
}

export async function readLinks() {
  let raw;
  try { raw = await fs.readFile(linksFile(), 'utf8'); } catch (error) { return error.code === 'ENOENT' ? { groups: [] } : { groups: [], error: `${SHOWN} could not be read.` }; }
  if (raw.length > MAX_BYTES) return { groups: [], error: `${SHOWN} is larger than 100 KB, so it was not read.` };
  let data;
  // PowerShell's Out-File writes a byte order mark, which JSON.parse rejects.
  try { data = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw); } catch { return { groups: [], error: `${SHOWN} is not valid JSON.` }; }
  if (!data || !Array.isArray(data.groups)) return { groups: [], error: `${SHOWN} needs a "groups" list.` };
  const skipped = [], groups = [];
  let count = 0;
  for (const group of data.groups.slice(0, MAX_GROUPS)) {
    const name = text(group?.name);
    if (!name || !Array.isArray(group.links)) { skipped.push('a group without a name or a links list'); continue; }
    const links = [];
    for (const link of group.links) {
      if (count >= MAX_LINKS) { skipped.push(`links past the first ${MAX_LINKS}`); break; }
      const checked = checkLink(link);
      if (typeof checked === 'string') skipped.push(checked); else { links.push(checked); count++; }
    }
    if (links.length) groups.push({ name, links });
  }
  if (data.groups.length > MAX_GROUPS) skipped.push(`groups past the first ${MAX_GROUPS}`);
  return skipped.length ? { groups, error: `Skipped in ${SHOWN}: ${[...new Set(skipped)].join('; ')}.` } : { groups };
}
