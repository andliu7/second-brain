# Second Brain

A local personal workspace: a globe of every file on this computer's configured roots as the front door, with Today (todos, the kanban board, the month calendar), Board, Buy, Skills, Chat with Generate, Network and Goals behind it. Source code lives alongside the repository’s existing Python retrieval engine; the original engine and OS dashboard are preserved.

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

**The shell** is the sidebar, the top bar and the page between them. The sidebar has three modes, kept in this browser: open (always there), hidden (gone entirely, with a burger at the left of the top bar to bring it back; Ctrl B toggles open and hidden) and Auto-hide (it floats over the page and slides away once the pointer has been off it for a moment; the left edge, focus or the burger calls it back). Its Settings button sits at the foot with the two mode buttons. The profile is the avatar in the top bar beside andliu.ai: its menu shows the name, status and that everything is saved on this device, and links to Edit profile, Settings and the theme; the editor is the first section of Settings. Arriving on Today or Settings, opening a PDF in Docs, and switching andliu.ai between Chat and Generate play a short ascii sweep over the page; it is a copy laid over the live page that never blocks input, and it is skipped without WebGL2 or under reduced motion.

**Home** (the bare address, and #today) is the whole workspace as a globe: the Network's graph with images, code, text, PDFs and other files folded into one node per folder and kind (/api/graph/grouped, about 1,200 nodes from 12,900), each department a cluster on a sphere that turns slowly, nearer nodes larger and brighter. Drag to orbit, scroll to zoom, click a node to open the detail panel over the right edge (the viewer, or a grouped node's files with Open and Reveal, and the file tree as a tab; Escape closes it). A key on the left lists every colour with its count. The navigation sits behind the burger at the top left. The turntable, the load-in and the messages travelling the edges are off under prefers-reduced-motion. Local only, like Network.

**Today** (#agenda, "Today" in the navigation) is the daily page, top to bottom: the quote board (a split-flap board with a different quote each load); the todo card (two defaults, Read 15 minutes and Write 15 minutes, until you remove one for good; a time of day sends a todo to Google Calendar once it is connected; completed todos clear each day and yesterday stays readable as a ghost; a todo dragged onto the board becomes a card and stays a todo); the kanban board; a month calendar with the connected calendar's events; and the heat calendar of activity. Below those, the older parts: repos with uncommitted work, each course's projects with their git state, Blueberry's newest STATUS.md entry, the skills that run on this computer with their last run, pinned notes and quick capture, read live from /api/projects and /api/tasks on each visit. **Projects** is the row at the end of Today, not a navigation item: every repo and course project with branch, last commit and uncommitted count; each opens at #projects/<folder>.

**Board** (#board) is the same kanban as a page of its own: columns and cards that hold files, images, a checklist and a category colour (project purple, family green, academic blue, professional orange, fitness deep blue, relationships flamingo, urgent red, other yellow); a sticky-note view; From calendar imports events as cards, each once. Make it a project, in a card's dialog, turns a card into a project: its checklist becomes numbered stages in a drawer over the right edge, where each stage is ticked (with the day), given notes, added, reordered or deleted, and the next unfinished one is marked current. Back to a card undoes it and keeps the checklist. The projects are listed under the board and above the repos on Projects (#projects), and both open the same drawer. **Buy** (#buy) is the to-buy list: a link with a fetched preview, an image, and store, price and rating per item.

**Notes** come from quick capture on Today or Capture a thought in the top bar. The Ctrl+K search finds them, and a note's preview pins it for Today. The Files page is gone; notes stay in this browser's storage, and importing files and Browse library have no button for now.

**Docs** (#docs) is the notebook and journal, and the PDFs, in three panes. Left: All notes, Journal, Ideas, PDFs, Pinned, then your notebooks with their counts (make, rename and delete one; deleting a notebook keeps its notes) and every tag you have typed. Middle: the notes in that view, pinned first then newest, each with a two-line preview, and a search; the Journal groups entries by month under their dates, with Today's entry (opens or makes today's) and On this day (the same date in earlier months and years) at the top. Right: the note, its kind, notebook, tags, word count, save status, pin, Save as PDF, Full screen and delete, then the editor; edits save by themselves. New has a menu for the other kinds: Note, Journal entry, Idea, Resume, which opens the resume editor with its Template menu (Classic, Onyx, Ditto, Azurill, Ditgar, Leafish, Kakuna, Meowth, Scizor) and Import LaTeX and Export LaTeX in the right pane (there is one resume, and #resume still opens it as a page), and Import PDF, which adds each chosen PDF (up to 25 MiB) as a document. A PDF opens in the right pane as PDF tools working on that document: Organize (reorder, rotate, swap, duplicate, delete, extract pages), Edit (text boxes and ink) and Pamphlet (a saddle-stitched booklet); Save writes the pages back into the same document and Save as new PDF adds a copy. #pdf still opens PDF tools on its own, for bookmarks. Notes render LaTeX math: $x^2$ inline and $$...$$ on its own lines, drawn by KaTeX in the editor, in Chat and Skills, and in print; a click on a formula shows its source to edit, and the markdown keeps the dollars exactly as written. **Full screen** (the button, or Ctrl+Shift+F outside a text field) opens the note alone at #write/<id> (a PDF opens there as PDF tools across the page): no sidebar or top bar, a centred column, a strip with Back, the word count, Saved, Save as PDF and the browser's own full screen. Escape leaves the browser's full screen, then goes Back; the address works as a bookmark. Save as PDF is the print dialog with only the note on letter paper. At phone width the panes stack and the list and the note take turns.

**Skills** lists every skill installed in ~/.claude/skills, read live from /api/skills on each visit, plus skills you write here, marked Personal, as a card grid or a list (a switch at the top right; this browser remembers the choice). Each skill opens in a pop-up at #skills/<folder> (#skills/personal/<id> for yours): README.md and SKILL.md as tabs when a skill has both (a lone SKILL.md shows without a tab bar, its path above it), frontmatter as labels, the skill's file list, Use in Chat (sends SKILL.md as context held in memory, nothing saved), and Duplicate to edit for a personal copy. Skills listed in server/runner.mjs get a run box in a column beside the list: a play button starts the run, the box streams its output with the elapsed time, and when it ends shows the run's closing summary as Takeaways, or why it failed. The app does not execute scripts inside skills or synchronize your Claude account.

**Goals** tracks outcomes with dated milestones and an archive.

**Health** (#health) is food, training and bodyweight, in five tabs. **Today**: Log anything takes a brain dump ("2 eggs and toast, big coffee; bench 3x8 at 135, ran 2 miles in 18 min; weighed 162"); the chat model picked at the top of the page (the first provider with a key unless you choose) turns it into meals, sets, cardio and a weigh-in, and each food goes down a lookup ladder: your own foods (rows you ticked Remember), then USDA FoodData Central, then the model's estimate marked Guessed. Nothing is saved until you correct the preview and press Save. Below it, hit or miss per macro against your targets in words and bars, the week's average over logged days, the day's nutrition table (item, grams, kcal, protein, carbs, fat, source), and Quick add for foods (with Look up, no AI), sets and bodyweight. **Trends**: bodyweight with a 7-day average, estimated 1RM per lift (Epley, best set each session) and cardio pace, each as a small chart with the trend in words and a data table. **Coach**: rule-based advice per exercise (double progression, hold or deload 10% when reps fall two sessions running, a form cue after three sessions without a new best, more distance when pace improves and it felt easy), and Review my regime, which sends a compact summary to the chat model and labels the answer as AI suggestions, not medical advice. **Regimes**: several saved regimes; Share copies one as text or JSON or downloads a .json file, and Import reads that file back. **Targets**: daily kcal and macros, goal and target weight. The server half is server/health.mjs (POST /api/health/parse, /resolve, /review, local only); USDA answers are cached in ~/.brain/usda-cache.json, outside this repository.

**Network** is the whole workspace as a map: every file under the configured roots plus every installed skill, as departments (the areas in Projects/CLAUDE.md) and the four ARMS layers (Applications blue from the Claude Code config on disk, Routines yellow from OS/routines, Memory, Skills in Claude orange). Edges come only from real links read from the files: markdown links, [[wikilinks]], path and folder-name mentions, /skill mentions. Beside the map, a file tree with a search box (Enter opens the top match; arrows, Right, Left and Enter work in the tree) and a viewer: markdown rendered, code and text with line numbers, images whole, PDFs as their first page (rendered by the PyMuPDF that ships with this machine's Python, the way HTML gets a headless Chrome screenshot), a skill as its whole SKILL.md, plus Linked from and Links to, Open on device, Reveal in Explorer and Copy path. Open on device hands a document to its default app but only ever reveals a script or an executable (.js, .bat, .exe, .py and the like), so nothing on the map can be run from here. Hover a node or a tree row for a preview; Local graph shows one node and its neighbours. The selection is the hash (#network/<id>), and the Ctrl+K search lists map files, so from the front door a file is Ctrl+K, its name, Enter. Read only: nothing here renames, moves or deletes a file. The roots come from `second-brain/graph-roots.json` (gitignored; a missing file means ~/Downloads/Projects and ~/.claude/skills), and the built graph and hover thumbnails cache under `second-brain/.cache/graph/`, also gitignored. The panel summary reads at most the first 8 KB of a text file; the viewer pages through the rest in 64 KB chunks. Local only: /api/graph* returns 404 on a hosted deploy.

**andliu.ai** opens from the top right: the andliu.ai button in the top bar, or Ctrl J outside a text field, slides a panel over the right edge of whatever page is open, without leaving it; Escape or the X closes it. Its tabs are Chat and Generate. Full screen (the panel's button, or the andliu.ai row in the navigation) is the same thing at #chat as a page that never scrolls: conversations in a rail on the left that folds away, the messages as the only scrolling part, and the message box pinned at the bottom; new messages follow while you are at the bottom, and Jump to latest brings you back if you scrolled up. The model is picked in the message box, one menu for Claude (Opus 5.5 by default), OpenAI and Gemini. A provider error (an account out of API credit, say) is shown in the conversation with the provider's reason and a Switch to button for each other provider with a key; nothing is retried by itself. Only conversation messages and explicitly attached text go to the provider. Binary file text extraction and autonomous tools are not included. Provider limits: at most 100 messages, 10 context attachments, 40,000 characters per message, and 120,000 combined characters per request, which one attachment may use alone.

**Generate**, the second mode of Chat, sends one image request to the selected provider. Kie uses Nano Banana Pro; fal uses FLUX Schnell; Google uses Gemini 3.1 Flash Image. Queued jobs survive reloads and can be checked without resubmitting. Results are downloaded into browser storage as actual bytes. Prompts, providers, model IDs, timestamps, and job tickets are preserved. Provider keys do not imply verified billing/model access, and no paid requests ran during development. Video and reference-image editing are future additions.

## Project pipelines

A board project can be shown as a **pipeline** instead of a list of stages: the **Pipeline view** switch in the project's drawer (and beside each board project on Projects) turns it on for that project only, and it is off until you do. The stages are the same checklist either way, so switching back loses nothing. Each stage gets a status (pending, queued, running, paused, completed, completed with warning, failed, skipped, cancelled), always shown as an icon and a word, and optionally a progress number, start and end times, an attempt count, an error, a warning, output and log lines. Progress is only ever a number someone set; a stage without one has no bar. The header shows the job's status, "n of m stages" and an overall bar; Cancel stops every unfinished stage, Restart puts every stage back to pending (notes, output and logs are kept), Retry runs a failed stage again as a new attempt, and Skip finishes a skippable stage as skipped. **Edit pipeline** builds it out: add, rename, reorder and delete stages, set a status from the menu, set progress with the slider or the number, write the description, warning, error and output, append log lines, mark a stage as skippable, make a stage the current one (a running stage is paused, not reset), and choose a subtitle and a vertical or horizontal layout. Everything saves through the board like any card edit. Ticking a stage in the ordinary stage list still works: a tick always wins over a stale status.

**Claude Code can read and update a pipeline.** The workspace lives in this browser, so while the app runs (npm run dev) each project with Pipeline view on is mirrored to `~/.brain/pipelines.json`, under your user profile and never in this repository, which is public. The app pushes a change as it is made and, while the drawer or Projects is open, pulls the mirror every 5 seconds and when the window regains focus, merging stage by stage (the newer edit wins; a stage you deleted stays deleted unless it changed after). The routes are local only, with the same origin and Host checks as the rest of the API (server/pipelines.mjs). From a terminal, or from Claude Code:

```powershell
cd C:\Users\zeusa\Downloads\Projects\second-brain\web
node scripts/pipeline.mjs list
node scripts/pipeline.mjs show "Blueberry"
node scripts/pipeline.mjs set "Blueberry" "Draft questions" --status active --progress 40
node scripts/pipeline.mjs log "Blueberry" "Draft questions" "Lesson 3 drafted"
node scripts/pipeline.mjs add "Blueberry" "Playtest"
```

A project or a stage can be named by id, by any unique part of its title, or (a stage) by its number in `show`. The script talks to 127.0.0.1 on PORT, 5174 unless set. `set` also takes `--error`, `--warning`, `--output` and `--progress none`; `list` and `show` take `--json`. The andliu.ai chat can read the same pipelines through `pipelinesContext()` in src/lib/pipeline.ts, a short text summary.

**What pipelines are for.** Three examples ship as test fixtures and for the sample workspace (src/lib/pipeline-examples.ts); none is put in your data:

- *A Blueberry unit's curriculum*: outline, question sources, draft questions, review, pathway art (skippable), publish. A long piece of your own work where "which step am I on" matters more than a tick list.
- *A skill run*: Clean up as scan processes, kill stragglers, clear temp, report, stopped on a failure you can retry or skip. A routine's steps with their output and logs.
- *A Claude build and critique loop*: build, critic, fix, verify, commit. A long agent task calls scripts/pipeline.mjs at each step, so the board shows where it is, what failed and on which attempt, without reading the terminal.

## Google Calendar

The todo card, the month calendar and the board's From calendar read your Google Calendar through /api/calendar (server/calendar.mjs), local only. Create an OAuth client in Google Cloud with the redirect URI http://127.0.0.1:5174/api/calendar/callback (and the same path on your tailnet name if you use one), put GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in ~/.claude/.env, then click Connect on the calendar. The token lives in ~/.brain/google-calendar-token.json; Disconnect deletes it.

## Other devices

The server binds to 127.0.0.1 unless HOST says otherwise, and never to 0.0.0.0: the API opens files and runs skills on this computer. To reach it from a phone or an iPad on a private Tailscale network, start it with HOST set to this computer's tailnet address, BRAIN_PUBLIC_NAME and BRAIN_ALLOWED_HOSTS set to its tailnet name, and use that name in the browser. Over plain http the browser withholds crypto.randomUUID and the clipboard; the app falls back to getRandomValues and execCommand, so everything still works.

## Provider keys

**On this PC, the easy way is Settings > Keys.** Each provider has a Get a key link to its key page and a one-line setup hint; paste the key and Save. The field clears and only the last four characters are shown from then on. Save runs a free check (a models list, KIE's credit balance, one USDA search; never a call that spends tokens) and the dot says how it went, in words as well as colour: green Verified, yellow Not verified (saved but unchecked, checking, rate limited or unreachable; fal has no free check so it stays yellow), red Rejected (the provider refused the key), none Not set. Verify re-runs the check and Remove forgets a saved key. No restart is needed.

Saved keys live in `~/.brain/keys.dpapi`, under the user profile and outside every repository, and are read by server/keys.mjs. On Windows the file is one DPAPI blob in current-user scope, made by a child PowerShell that gets the data on stdin, never on its command line: it opens only for this Windows account on this machine, and there is no key file to steal. On other systems it is AES-256-GCM with a random key in `~/.brain/keys.aes.key` (mode 600) beside it, which only protects against casual reading, since anything running as you can read both files. Under either scheme, any program running as you can decrypt the store, as it could read .env, and the keys sit decrypted in the server's memory while it runs. The browser never receives a key back: the API returns only whether one is set, its last four characters, where it came from and the check's result, and nothing about keys is kept in localStorage, the workspace or a backup. Keys can be changed only from the PC itself: a request through the Tailscale name, from a tailnet address, or carrying proxy headers is refused, and a phone sees the list read-only without the last four characters. A saved key wins over the same provider's environment variable; remove it and the environment key is used again.

The environment still works, and is the only way on a hosted deploy. Copy .env.example to .env and add only the providers you use. Server-only keys:

| Provider | Environment variable |
| --- | --- |
| Claude | ANTHROPIC_API_KEY |
| OpenAI | OPENAI_API_KEY |
| Gemini chat and images | GEMINI_API_KEY or GOOGLE_API_KEY |
| fal.ai | FAL_KEY |
| Kie | KIE_API_KEY |
| USDA FoodData Central (Health nutrition lookups) | FDC_API_KEY, free at https://api.data.gov/signup; without it the shared DEMO_KEY allows only a few lookups an hour |

The local .env supplied on this machine only points GENERATE_ENV_FILE at your existing ~/.claude/.env. It contains no copied API secrets and is ignored by Git. The server loads those keys when it starts. Restart after changing environment values. Settings > AI connections shows which keys are available; Settings > Keys can check them live. Consumer chat subscriptions do not provide the API keys used by this website.

SECOND_BRAIN_ROOT changes the folder the Files library reads. CLAUDE_SKILLS_DIR only changes where the Run control (server/runner.mjs) checks that a skill is installed; it does not move the Skills list. The development server binds only to 127.0.0.1 and rejects foreign origins and Host headers.

Skills, projects and brain search are read live from disk on every request (server/live.mjs, /api/skills, /api/projects, /api/brain?q=). They run OS/build_home.py --json and second-brain/q.py --json, so python must be on PATH. The skills list always reads ~/.claude/skills, because build_home.py does.

Settings > Brain shows the date of the brain's last full reindex (from second-brain/log.md) and the latest benchmark's headline numbers, brain against grep, from second-brain/bench/results-speed-summary.json and results-history-summary.json, through GET /api/brain/summary (server/live.mjs brainSummary, aggregate numbers only). It never runs the index or a benchmark; it shows `python idx.py` to copy and run yourself. Files changed since the reindex are not counted, because that means walking every root.

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

## Sample workspace

A made-up workspace for demos, screenshots and trying the app: Sam Rivera, a sophomore in chemistry and computer science at a fictional university, with notes in notebooks, a journal (with an On this day entry), ideas, a resume, a personal skill, a board with two projects and dated stages, three weeks of todos, goals, a buy list, brainstorm lines, a whiteboard, two chats and sixteen weeks of activity. Nothing in it is real. src/lib/sample-workspace.ts builds it with every date counted back from today, so the streak and the charts look alive whenever it is loaded.

Settings can load it through the Try the sample workspace card, which **replaces this browser's workspace**: download your backup first (the card has the button), and restore it later with Import backup. The same data ships as an ordinary backup, public/sample-workspace.json, for Import on any machine. Its dates are fixed at the day it was written; to freshen them:

```powershell
node scripts/make-sample.mjs
```

## Vercel later

No site has been published. To deploy later, push source to your chosen private repository, import into Vercel, and set **Root Directory: web**. The included vercel.json builds the Vite frontend and routes /api/* to the server function.

Set provider keys and a long random APP_ACCESS_TOKEN in the hosted environment. Hosted API calls fail closed without the token. Enter it in Settings; it stays in tab memory and is not backed up. The site shell is not a multi-user authenticated product: the token protects the API, while private data remains in your browser. For shared use, add individual authentication, durable authorization/rate limits, and private object storage.

Vercel cannot access your local folders. Local source routes are disabled on hosted deployments. Its function response limit also constrains large generated images; responses over 4 MB are rejected with a recovery instruction to download the completed image from the provider dashboard. Use object storage before relying on large hosted generations. The current rate limit is per server process and is not a distributed quota.

GitHub Pages can serve a static build but cannot run the provider API routes. A private repository does not make a deployed website private. See [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

## Third-party

The Onyx, Ditto, Azurill, Ditgar, Leafish, Kakuna, Meowth and Scizor resume templates adapt the layout and typography of the templates of those names in [Reactive Resume](https://github.com/amruthpillai/reactive-resume) (commit d9fdf7a30a3eb132986b3f82dea01c21738540eb), MIT License, Copyright (c) 2026 Amruth Pillai; they are rewritten as CSS in src/resume.css, and no Reactive Resume code or data schema is used. Export LaTeX writes the command names and argument order of Jake Gutierrez's resume template (MIT) with its own preamble; Import LaTeX reads that shape. Math is drawn by [KaTeX](https://katex.org) (MIT) through @tiptap/extension-mathematics (MIT). The Docs layout and the full screen page take ideas only from Notesnook (GPL-3.0) and Edgeever (AGPL-3.0); no code from either is used.

## Review status

Backend, backup, graph, and core interaction tests are included. Model calls use explicit test fixtures in tests, never fabricated responses in the application. Browser/3D rendering, mobile overflow, and a blind visual comparison remain unverified because no browser was connected to the building session. The progress page records this limitation.

[BUILD-PROMPT.md](BUILD-PROMPT.md) is the short reusable gauntlet prompt. [PLAN.md](PLAN.md) describes the implementation and future phases. Sources for API contracts are linked there.

