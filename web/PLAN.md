# Second Brain — implementation and next steps

The first version is a working personal workspace that lives alongside the existing retrieval engine. It uses the repository’s React + TypeScript + Vite stack. The existing Python engine and OS dashboard keep their own workflows.

## This build

| Page | Responsibility |
| --- | --- |
| Today | The front page: repos with uncommitted work, course projects and their git state, Blueberry's newest STATUS.md entry, skill runs, pinned items, quick capture |
| Projects | Every repo and course project with branch, last commit and uncommitted count; each opens to its details |
| Network | Color-coded 3D nodes, directed relationships, topic hubs, neighborhood focus, portable agent context retrieval |
| Files | Notes and imported files; search, tags, pins, preview, download; local source discovery |
| Skills | Installed Claude instructions and editable workspace copies; explicit chat attachment |
| Goals | Outcomes with milestones, dates, categories, completion, and archive |
| Chat | Saved conversations; explicit context selection; Claude, OpenAI, Gemini adapters |
| Generate | One image per request through Kie, fal.ai, or Gemini; queue tracking and saved output metadata |
| Settings | Provider status, access token, portable backup export/import, connection explanation |

## How data flows

Browser → IndexedDB saves your documents, imported bytes, goals, chat history, and images on this device.

Browser → /api/chat → chosen model API. Only the messages and explicitly selected text attachments are sent. API secrets remain on the server. Provider API billing and access are separate from a consumer chat subscription.

Browser → /api/generate → provider job → /api/generation-status → downloaded image bytes and metadata → IndexedDB. Provider selection is explicit. This build uses FLUX Schnell for fal, Nano Banana Pro for Kie, and Gemini 3.1 Flash Image for Google. It does not silently substitute providers.

Browser → local library bridge → selected project documents or Claude SKILL.md. Hosted mode disables this bridge. Skills are readable workflow instructions, not arbitrary code execution. Supporting scripts, tool calls, account skill synchronization, and the full /generate agent runtime are not executed by the website.

## Storage decision

IndexedDB makes the first local build usable immediately without requiring a new account or publishing private files. Backup exports include the complete imported file and image data, not just filenames. Browser storage belongs to an origin, so localhost and a Vercel URL have different workspaces; export then import to migrate. Clearing site data or changing browsers can remove access to it. There is no cross-device synchronization in this version.

## Hosting decision

Use a private GitHub repository and Vercel for the eventual full app. Root Directory should be web; the included Vercel configuration routes /api requests to the Node function. Set server provider keys and a long APP_ACCESS_TOKEN. The API fails closed without that token in hosted mode. Unlock it in Settings; the token stays in memory and is not included in backups. The static shell can be public, but the API requires the secret. Add an identity provider before turning it into a shared service.

GitHub Pages can serve the static interface, but cannot execute the server routes. It needs a separate API host for Chat and Generate. A private source repository does not itself make a deployed website private.

## Next phase: find decisions and research reliably

Updated 2026-09-22 after the workspace audit and last30days research. This is a proposed implementation sequence. This update changes documentation only.

The owner's priorities are project decisions and research, predictable file locations after agent work, and suggested memories that require approval. Google Drive and notes remain useful capture sources; a migration is not a prerequisite. Keep the existing division: the separate dashboard is the life app, while this app handles local project files, retrieval, skills and runs.

1. **Make the current map trustworthy.** Reconcile the existing root README, OS/README and web/README with the running code and branch state. Keep OS/MEMORY as the existing cross-project note index. Show where an item lives: disk, browser copy, or external link. End agent work with linked paths for files created/changed and any explicitly authorized moves. No automatic rearrangement and no additional master index.
2. **Finish the existing file navigation.** Review and continue P7 on `web-p7-network`, preserving the unrelated main-tree work. It already contains FileTree and FileViewer. Fix the known selection/load-more race before integration. Prioritize breadcrumbs, shared selection, Open, Reveal in Explorer, Copy path, and P4 keyboard search. Include project planning/research documents currently absent from the bounded library. Keep browsing read-only; file mutation needs its separately authorized scope. Verify that a found result opens the correct source within two actions, including duplicate filenames and rapid selection changes.
3. **Add a small approval workflow.** Suggest a memory with its proposed text, source, destination, and reason for saving; offer Approve, Edit and Reject. Rejection must not create a durable memory. Keep existing cross-project notes in OS/memory; keep project decisions with the project's plan/specification. For this repo, use this plan's decision record until its size justifies a linked file. Give new research briefs one stable project-local home, `web/research/`, linked from web/README when created. Store dated conclusions and source links; preserve originals and link Drive items before considering imports. Record rejected alternatives and mark superseded decisions. Update the old save-immediately instruction as part of implementing this workflow, and configure native Claude auto memory consistently so it cannot bypass approval. Neither instruction nor settings are changed by this plan update.
4. **Repair retrieval using real questions.** Start P13 with 10-15 questions about actual decisions, rejected choices and research. Compare the current engine with direct file search. Make project scoping use a canonical path, distinguish other checkouts, and inspect inappropriate query expansion such as memory becoming RAM/heap. Show citations, source freshness and missing-index coverage. Retain the existing Python engine while measuring correctness, latency and context size. Keep the existing 30% token-saving goal as an unverified target, conditional on unchanged correctness and speed. Full reindex remains user-run under the standing rule.
5. **Prove the daily loop before adding infrastructure.** Capture or link a research item, approve a proposed decision, then retrieve both in a fresh session and open the originals. Review pending suggestions and stale decisions weekly. Defer additional graph polish, embeddings/MCP services, background rewriting, a wholesale Obsidian migration and multi-device storage until this loop exposes a specific need. Spend tracking and generation features remain later work.

## Workspace audit behind this sequence

Scope: the entire `Downloads/Projects/second-brain` tree was inventoried, excluding dependency, build, cache and Git internals. The filtered inventory contained 179 files; this is not a claim that every binary or generated file was read. Relevant documentation, retrieval configuration, source code and Claude routing/memory files were inspected. Google Drive contents and actual browser-stored notes were not inspected.

| Location | Role today |
| --- | --- |
| `OS/` | Cross-project memory index and six notes, routines, generated HOME/SKILLS pages, and launcher/older dashboard utilities |
| `second-brain/` | Python lexical retrieval, machine-local index/cache, `q.py`, `remember.py`, monthly memory entries and a separate local console |
| `web/` | React app and local bridges; its own notes, imports, goals, chats and images persist in browser IndexedDB |
| `rounds/`, `GAUNTLET-RESUME.md`, `web/design/` | Evaluation/design artifacts and the paused implementation handoff |
| Claude user/project directories outside the repo | Additional routing instructions and project memory, separate from OS notes and browser storage |

Concrete gaps found:

- The root README does not describe the current web app. OS documentation disagrees about whether its memory is always loaded or read on demand. Routine scheduling documentation also disagrees; the actual scheduler was not audited.
- The local library reads selected root documents plus OS/memory, OS/routines and monthly memories. It omits web/PLAN.md, nested design/planning documents and rounds. Saving a source into the browser creates a copy, not a live filesystem edit.
- The Python index covers much more than this repo, roughly 62,000 sections across configured machine folders. In two spot checks, engine code or another second-brain checkout ranked above the intended notes. `--scope second-brain` also matched the other checkout. These are diagnosed examples, not a measured overall failure rate.
- `/api/brain` already integrates Python retrieval. The previous Next phase paragraph incorrectly described local integration as future work.
- P7 is existing WIP on another branch, not a feature to start again. Its recorded viewer race is also visible in the branch code. The main working tree contains unrelated unfinished changes.
- Parent instructions currently say to save decisions immediately. The latest user preference requires approval before saving memories and governs this proposal.

## Research: ideas to borrow selectively

Research ran September 21-22, 2026, targeting the previous 30 days. The skill returned 15 Reddit candidates, 7 HN candidates, 23 GitHub candidates and 6 older YouTube transcripts. Candidate counts do not establish relevance or independent support. Reddit was partly rate-limited. YouTube results were dated February-June and are background only. The authorized X-cookie attempt could not authenticate: the installed extractor does not support Windows Chrome/Edge and found no usable alternative credentials. Public X searches supplied no usable evidence, so there is no X-based conclusion here.

| Evidence | Borrow | Skip or qualify, and why |
| --- | --- | --- |
| [Recent Reddit discussion of carrying decisions](https://www.reddit.com/r/ClaudeCode/comments/1wmoost/how_do_you_carry_decisions_not_chat_history/) | Small dated decision records with rationale, rejected alternatives, links and supersession | Saving whole chat histories as authoritative truth. Multiple commenters report success with decision records, but these are self-reports, not comparative trials. |
| [A user's overgrown Claude/Obsidian vault](https://www.reddit.com/r/ClaudeCode/comments/1wcw3ws/im_trying_to_build_an_obsidian_second_brain_with/) | Human-readable structure, explicit write proposals, and understandable ownership | Elaborate taxonomies and a large mixed instruction file. The author says the system technically works but they no longer understand its architecture, closely matching the navigation problem here. |
| [Claude's memory documentation](https://code.claude.com/docs/en/memory) | Short instructions with relevant detail loaded on demand; inspectable Markdown | Treating native auto memory as an approval workflow. It saves automatically unless configured otherwise; review-first behavior needs an explicit design. |
| [Obsidian second-brain implementation](https://github.com/eugeniughelbur/obsidian-second-brain) and [an author's wiki workflow](https://www.christianmonge.com/blog/obsidian-second-brain) | Dated or source-backed facts, preserved originals, retrieval evaluation | Copying a command suite, semantic stack or self-rewriting wiki wholesale. Maintenance cost and benefit must be measured against this workspace. |
| [HN context-engineering discussion](https://news.ycombinator.com/item?id=49571131) and [older Claude-Mem demonstration](https://www.youtube.com/watch?v=ryqpGVWRQxA) | Fresh-session recall checks and explicit evaluation | Universal productivity/token-saving claims. HN contains both success anecdotes and demands for benchmarks; the video demonstrates a small bug-recall example, not this workspace's decision/research workload. |
| [RTK](https://github.com/rtk-ai/rtk) | Compact evidence with access to full output and measured savings | Making command-output compression the next memory feature. It does not resolve file ownership, stale decisions or approval. No RTK installation or global hook change is part of this plan. |

The supported working pattern is modest: deliberate capture, understandable files, selective retrieval and source-backed decisions. Claims of effortless autonomous memory or universal graph/vector superiority remain unproven for this workspace.

## Review bar

Use the two actual supplied dashboard references and Linear’s actual My Issues documentation screens. Independent critics inspect artifacts rather than author reports. Measurable targets: core flow checks pass; no horizontal overflow at 375px; initial JavaScript under 250 KB gzip. Visual comparison is reported as identified whenever product labels reveal identity.

## Sources

- [Linear My Issues](https://linear.app/docs/my-issues)
- [OpenAI text generation](https://developers.openai.com/api/docs/guides/text)
- [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Gemini API](https://ai.google.dev/api)
- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [fal queue API](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [Kie Nano Banana Pro](https://docs.kie.ai/market/google/pro-image-to-image)
- [Kie task status](https://docs.kie.ai/market/common/get-task-detail)
- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
