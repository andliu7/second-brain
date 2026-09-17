// The map is local and the public repo learns nothing from it. This fails the moment a graph
// cache, a thumbnail, a node dump, the roots config or a brain index becomes tracked, or a path
// server/graph.mjs writes to stops being gitignored.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { projectRoot } from '../server/library.mjs';
import { writtenPaths } from '../server/graph.mjs';

const git = args => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
const tracked = git(['ls-files']).split('\n').filter(Boolean);

test('no map data, thumbnail, node dump, roots config or brain index is tracked', () => {
  const forbidden = [/(^|\/)\.cache\//, /(^|\/)graph-roots\.json$/, /(^|\/)thumbs\//, /^second-brain\/.*graph.*\.json$/, /(^|\/)index\.tsv$/, /^second-brain\/brain\.json$/, /^web\/public\/.*\.(png|jpe?g|webp|pdf)$/];
  const leaks = tracked.filter(file => forbidden.some(re => re.test(file)));
  assert.deepEqual(leaks, []);
});

test('every path the map writes to is gitignored', () => {
  const paths = writtenPaths(); assert.ok(paths.length >= 3);
  for (const target of paths) {
    const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
    assert.ok(relative && !relative.startsWith('..'), target + ' must live inside the repo to be judged');
    const check = spawnSync('git', ['check-ignore', '-q', relative + (target.endsWith('.json') ? '' : '/probe')], { cwd: projectRoot });
    assert.equal(check.status, 0, relative + ' is not gitignored');
  }
});
