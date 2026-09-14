import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';

// These tests read this computer's real skills, projects and brain, because that is the
// whole point of the routes: what the site shows has to match what is on disk.
const { handleApi } = await import('../server/api.mjs');
const { projectRoot } = await import('../server/library.mjs');
const skillsDir = path.join(os.homedir(), '.claude', 'skills');
const projectsDir = path.resolve(projectRoot, '..');

async function apiRequest(route, { local = true, token } = {}) {
  const req = Readable.from([]);
  const auth = token ? { authorization: 'Bearer ' + token } : {};
  Object.assign(req, { url: '/api/' + route, method: 'GET', headers: { host: '127.0.0.1:5174', ...auth } });
  const result = {};
  const res = { writeHead(status) { result.status = status; }, end(value) { result.body = JSON.parse(value); } };
  await handleApi(req, res, { local });
  return result;
}

// Python reads text with universal newlines, so a CRLF file arrives with LF endings.
const text = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the live routes do not exist on a hosted deployment, even for an authorized caller', async () => {
  process.env.APP_ACCESS_TOKEN = 'hosted-test-token';
  try {
    for (const route of ['skills', 'projects', 'brain?q=front%20door']) {
      assert.equal((await apiRequest(route, { local: false, token: 'hosted-test-token' })).status, 404, route);
    }
  } finally {
    delete process.env.APP_ACCESS_TOKEN;
  }
});

test('skills lists every folder in ~/.claude/skills that has a SKILL.md, with its docs and files', async () => {
  const onDisk = fs.readdirSync(skillsDir).filter(name => fs.existsSync(path.join(skillsDir, name, 'SKILL.md'))).sort();
  const { status, body } = await apiRequest('skills');
  assert.equal(status, 200);
  assert.deepEqual(body.skills.map(skill => skill.slug).sort(), onDisk);
  assert.ok(onDisk.includes('brain'));
  for (const skill of body.skills) {
    const dir = path.join(skillsDir, skill.slug);
    assert.ok(skill.name, `${skill.slug} has no name`);
    assert.ok(skill.description, `${skill.slug} has no description`);
    assert.equal(skill.skill, text(path.join(dir, 'SKILL.md')), `${skill.slug} SKILL.md text`);
    const readme = path.join(dir, 'README.md');
    assert.equal(skill.readme, fs.existsSync(readme) ? text(readme) : null, `${skill.slug} README.md text`);
    const files = fs.readdirSync(dir, { recursive: true }).filter(rel => fs.statSync(path.join(dir, rel)).isFile()).map(rel => rel.replaceAll('\\', '/')).sort();
    assert.deepEqual(skill.files, files, `${skill.slug} file list`);
  }
  const bySlug = Object.fromEntries(body.skills.map(skill => [skill.slug, skill]));
  assert.match(bySlug.generate.description, /^Generate images and videos/);
  assert.match(bySlug.brain.description, /^Answer a question about Andrew's own files/);
  // Only the skills in server/runner.mjs TASKS can be run from the site.
  assert.equal(bySlug['clean-up'].task, 'clean-up');
  assert.equal(bySlug['doctor-plus'].task, 'doctor-plus');
  assert.equal(bySlug.generate.task, null);
});

test('every installed skill can be sent to Chat the way Use in Chat attaches it', async () => {
  // ui-ux-pro-max's SKILL.md is over 45,000 characters, so a 40,000 cap per context item refused it.
  const { validateChat } = await import('../server/providers.mjs');
  const { body } = await apiRequest('skills');
  for (const skill of body.skills) {
    assert.doesNotThrow(() => validateChat({ provider: 'gemini', model: 'gemini-3.5-flash', messages: [{ role: 'user', content: 'What does this skill cover?' }], context: [{ name: skill.name, content: skill.skill, kind: 'skill' }] }), skill.slug);
  }
});

test('projects reports repos, every school course with each project\'s git state, Blueberry STATUS entries and routines', async () => {
  const { status, body } = await apiRequest('projects');
  assert.equal(status, 200);

  const self = body.repos.find(repo => repo.path === 'second-brain');
  assert.ok(self, 'second-brain is listed');
  assert.equal(self.known, true);
  assert.ok(Number.isInteger(self.dirty));
  for (const repo of body.repos) assert.ok(fs.existsSync(path.join(projectsDir, repo.path)), repo.path);

  const school = path.join(projectsDir, 'school');
  const courses = fs.readdirSync(school, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();
  assert.deepEqual(body.courses.map(course => course.name), courses);
  const cmsc423 = body.courses.find(course => course.name === 'CMSC423');
  const projects = fs.readdirSync(path.join(school, 'CMSC423'), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();
  assert.deepEqual(cmsc423.projects.map(project => project.name), projects);
  for (const project of cmsc423.projects) {
    const isRepo = fs.existsSync(path.join(school, 'CMSC423', project.name, '.git'));
    assert.equal(project.untracked_project, !isRepo, project.name);
    assert.equal(typeof project.branch, 'string');
    assert.equal(typeof project.known, 'boolean');
  }

  const statusFile = text(path.join(projectsDir, 'grignard', 'grignard-app-source', 'documentation', 'STATUS.md'));
  assert.ok(body.blueberry.entries.length >= 1);
  const newest = body.blueberry.entries[0];
  const firstDated = statusFile.match(/^##\s+(.+?),\s*(\d{4}-\d{2}-\d{2})\s*$/m);
  assert.equal(newest.what, firstDated[1]);
  assert.equal(newest.date, firstDated[2]);
  // The entry's text is there to read, not only its heading.
  assert.ok(newest.body.length > 40);
  assert.ok(statusFile.includes(newest.body));

  const routines = fs.readdirSync(path.join(projectRoot, 'OS', 'routines')).filter(name => name.endsWith('.md') && name !== 'README.md').sort();
  assert.deepEqual(body.routines.map(routine => routine.file), routines);
});

test('brain search returns q.py evidence for a query, and a plain no-match for nonsense', async () => {
  const hit = await apiRequest('brain?q=' + encodeURIComponent('one front door'));
  assert.equal(hit.status, 200);
  assert.equal(hit.body.status, 'ok');
  assert.match(hit.body.winner.path, /OS\/memory\/decisions\.md$/);
  // The section that mentions the front door, read from disk, since the memory is rewritten as
  // decisions change: the evidence must be that section, heading and all.
  const decisions = text(path.join(projectRoot, 'OS', 'memory', 'decisions.md'));
  const heading = decisions.split('\n').find(line => line.startsWith('## ') && /front door/i.test(line));
  assert.ok(heading, 'decisions.md has a section heading that mentions the front door');
  assert.ok(hit.body.evidence.includes(heading), `evidence starts at "${heading}"`);

  const miss = await apiRequest('brain?q=' + encodeURIComponent('zzqqxx jenkinsfoo quuxbarbaz'));
  assert.equal(miss.status, 200);
  assert.equal(miss.body.status, 'no_match');
  assert.match(miss.body.message, /does not have this/);

  const empty = await apiRequest('brain?q=');
  assert.equal(empty.status, 400);
});

test('build_home.py --json prints valid JSON and writes no files', () => {
  const osDir = path.join(projectRoot, 'OS');
  const mtime = name => { try { return fs.statSync(path.join(osDir, name)).mtimeMs; } catch { return null; } };
  const before = { names: fs.readdirSync(osDir).sort(), home: mtime('HOME.html'), skills: mtime('SKILLS.html') };
  const stdout = execFileSync('python', [path.join(osDir, 'build_home.py'), '--json'], { encoding: 'utf8' });
  const data = JSON.parse(stdout);
  for (const key of ['repos', 'courses', 'blueberry', 'routines', 'skills']) assert.ok(key in data, key);
  assert.deepEqual({ names: fs.readdirSync(osDir).sort(), home: mtime('HOME.html'), skills: mtime('SKILLS.html') }, before);
});
