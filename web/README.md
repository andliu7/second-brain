# Second Brain

A local personal workspace with Files, Skills, Goals, Chat, Generate, and a Network map of every file on this computer's configured roots. Source code lives alongside the repository’s existing Python retrieval engine; the original engine and OS dashboard are preserved.

## Run

Node.js 22.12 or newer is required.

```powershell
cd C:\Users\zeusa\Downloads\Projects\second-brain\web
npm install
npm run dev
```

Open http://127.0.0.1:5174. The live build report is http://127.0.0.1:5174/progress.html. You can also double-click start-second-brain.cmd after installing dependencies.

```powershell
npm run build
npm start
npm test
npm run test:ui
```

## Use

**Today** is the front page. It reads /api/projects and /api/tasks live on each visit: repos with uncommitted work, each course's projects with their git state, Blueberry's newest STATUS.md entry, and the skills that run on this computer with their last run, beside pinned items and quick capture. **Projects** lists every repo and course project with branch, last commit and uncommitted count; each opens at #projects/<folder>.

**Files** creates notes and imports files up to 20 MB each. Text is editable and searchable; raster images and PDFs have previews, while other formats remain downloadable. Pin items for Today. “Browse library” discovers root documentation, OS/memory, OS/routines and second-brain/memories. Saving a source creates a personal copy. The original source is never edited.

**Skills** lists every skill installed in ~/.claude/skills, read live from /api/skills on each visit, plus skills you write here, marked Personal. Each skill opens as its own page at #skills/<folder> (#skills/personal/<id> for yours): README.md and SKILL.md as tabs when a skill has both (a lone SKILL.md shows without a tab bar, its path above it), frontmatter as labels, Use in Chat (sends SKILL.md as context held in memory, nothing saved), and Duplicate to edit for a personal copy. Skills listed in server/runner.mjs also get a Run control and their output on that page. The app does not execute scripts inside skills or synchronize your Claude account.

**Goals** tracks outcomes with dated milestones and an archive.

**Network** is the whole workspace as a map: every file under the configured roots plus every installed skill, as departments (the areas in Projects/CLAUDE.md) and the four ARMS layers (Applications blue from the Claude Code config on disk, Routines yellow from OS/routines, Memory, Skills in Claude orange). Edges come only from real links read from the files: markdown links, [[wikilinks]], path and folder-name mentions, /skill mentions. Beside the map, a file tree with a search box (Enter opens the top match; arrows, Right, Left and Enter work in the tree) and a viewer: markdown rendered, code and text with line numbers, images whole, PDFs as their first page (rendered by the PyMuPDF that ships with this machine's Python, the way HTML gets a headless Chrome screenshot), a skill as its whole SKILL.md, plus Linked from and Links to, Open on device, Reveal in Explorer and Copy path. Open on device hands a document to its default app but only ever reveals a script or an executable (.js, .bat, .exe, .py and the like), so nothing on the map can be run from here. Hover a node or a tree row for a preview; Local graph shows one node and its neighbours. The selection is the hash (#network/<id>), and the Ctrl+K search lists map files, so from the front door a file is Ctrl+K, its name, Enter. Read only: nothing here renames, moves or deletes a file. The roots come from `second-brain/graph-roots.json` (gitignored; a missing file means ~/Downloads/Projects and ~/.claude/skills), and the built graph and hover thumbnails cache under `second-brain/.cache/graph/`, also gitignored. The panel summary reads at most the first 8 KB of a text file; the viewer pages through the rest in 64 KB chunks. Local only: /api/graph* returns 404 on a hosted deploy.

**Chat** offers Claude, OpenAI, and Gemini with editable model IDs. Only conversation messages and explicitly attached text go to the provider. Binary file text extraction and autonomous tools are not included. Provider limits: at most 100 messages, 10 context attachments, 40,000 characters per message, and 120,000 combined characters per request, which one attachment may use alone.

**Generate** sends one image request to the selected provider. Kie uses Nano Banana Pro; fal uses FLUX Schnell; Google uses Gemini 3.1 Flash Image. Queued jobs survive reloads and can be checked without resubmitting. Results are downloaded into browser storage as actual bytes. Prompts, providers, model IDs, timestamps, and job tickets are preserved. Provider keys do not imply verified billing/model access, and no paid requests ran during development. Video and reference-image editing are future additions.

## Provider keys

Copy .env.example to .env and add only the providers you use. Server-only keys:

| Provider | Environment variable |
| --- | --- |
| Claude | ANTHROPIC_API_KEY |
| OpenAI | OPENAI_API_KEY |
| Gemini chat and images | GEMINI_API_KEY or GOOGLE_API_KEY |
| fal.ai | FAL_KEY |
| Kie | KIE_API_KEY |

The local .env supplied on this machine only points GENERATE_ENV_FILE at your existing ~/.claude/.env. It contains no copied API secrets and is ignored by Git. The server loads those keys when it starts. Restart after changing environment values. Settings shows which keys are available; that is not a live account check. Consumer chat subscriptions do not provide the API keys used by this website.

SECOND_BRAIN_ROOT changes the folder the Files library reads. CLAUDE_SKILLS_DIR only changes where the Run control (server/runner.mjs) checks that a skill is installed; it does not move the Skills list. The development server binds only to 127.0.0.1 and rejects foreign origins and Host headers.

Skills, projects and brain search are read live from disk on every request (server/live.mjs, /api/skills, /api/projects, /api/brain?q=). They run OS/build_home.py --json and second-brain/q.py --json, so python must be on PATH. The skills list always reads ~/.claude/skills, because build_home.py does.

## Make models and CLI tools more efficient

`bin/brain.mjs` searches a workspace graph export (second-brain-agent-graph.json: text nodes, source IDs, tags, and typed relationships, never binary attachments, images, API keys, or chat history). The Network page no longer produces that export; `shared/graph.mjs` still builds it from a workspace backup.

```powershell
node bin/brain.mjs search "carbonyl mechanisms" --graph second-brain-agent-graph.json --budget 6000 --limit 5
node bin/brain.mjs get "doc:YOUR-ID" --graph second-brain-agent-graph.json --budget 6000
node bin/brain.mjs neighbors "doc:YOUR-ID" --graph second-brain-agent-graph.json
node bin/brain.mjs stats --graph second-brain-agent-graph.json
```

Give the returned context to any model or CLI agent. Search uses a deterministic inverted index, title/tag weighting, BM25-style term scoring, and explicit one-hop relationships. No model call is used for retrieval. The budget is **characters**, not a claim about exact model tokens. The export is a point-in-time snapshot; export again after changes. Graph contents are reference data and do not authorize shell commands.

A reproducible synthetic fixture is included in npm test. On the development machine, indexing 1,003 documents took 57.26 ms and one query took 0.23 ms, returning 196 context characters from 1,050,164 corpus characters. This checks a deliberately known lexical answer, not general semantic accuracy or real-world token savings. Source and query timings vary by hardware.

## Data and backup

The workspace is stored in IndexedDB on this browser and origin, including original imported bytes. Settings exports/restores complete validated backups. Changing browsers, using a different hostname, or moving from localhost to Vercel creates a different storage origin; use export/import to migrate. Clearing site data deletes local workspace data. This release has no cross-device synchronization.

Keep private graph exports and backups out of public repositories. .gitignore excludes common export filenames as a convenience.

## Vercel later

No site has been published. To deploy later, push source to your chosen private repository, import into Vercel, and set **Root Directory: web**. The included vercel.json builds the Vite frontend and routes /api/* to the server function.

Set provider keys and a long random APP_ACCESS_TOKEN in the hosted environment. Hosted API calls fail closed without the token. Enter it in Settings; it stays in tab memory and is not backed up. The site shell is not a multi-user authenticated product: the token protects the API, while private data remains in your browser. For shared use, add individual authentication, durable authorization/rate limits, and private object storage.

Vercel cannot access your local folders. Local source routes are disabled on hosted deployments. Its function response limit also constrains large generated images; responses over 4 MB are rejected with a recovery instruction to download the completed image from the provider dashboard. Use object storage before relying on large hosted generations. The current rate limit is per server process and is not a distributed quota.

GitHub Pages can serve a static build but cannot run the provider API routes. A private repository does not make a deployed website private. See [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

## Review status

Backend, backup, graph, and core interaction tests are included. Model calls use explicit test fixtures in tests, never fabricated responses in the application. Browser/3D rendering, mobile overflow, and a blind visual comparison remain unverified because no browser was connected to the building session. The progress page records this limitation.

[BUILD-PROMPT.md](BUILD-PROMPT.md) is the short reusable gauntlet prompt. [PLAN.md](PLAN.md) describes the implementation and future phases. Sources for API contracts are linked there.

