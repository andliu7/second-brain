// Writes public/sample-workspace.json: the made-up sample workspace (src/lib/sample-workspace.ts) as an
// ordinary backup, so Settings' Import backup can load it on any machine. Its dates are counted from the
// day this runs, so run it again to freshen them:  node scripts/make-sample.mjs
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { validateWorkspace } from '../shared/validate.mjs';

const source = await readFile(new URL('../src/lib/sample-workspace.ts', import.meta.url), 'utf8');
// The generator imports types only, so it transpiles and runs on its own.
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { sampleWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const workspace = validateWorkspace(sampleWorkspace());
const out = new URL('../public/sample-workspace.json', import.meta.url);
await writeFile(out, JSON.stringify(workspace, null, 2) + '\n');
console.log(`Wrote public/sample-workspace.json: ${workspace.docs.length} docs, ${workspace.board.cards.length} cards, ${workspace.activity.length} activity entries.`);
