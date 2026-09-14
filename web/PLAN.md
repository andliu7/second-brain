# Second Brain — implementation and next steps

The first version is a working personal workspace that lives alongside the existing retrieval engine. It uses the repository’s React + TypeScript + Vite stack. The existing Python engine and OS dashboard keep their own workflows.

## This build

| Page | Responsibility |
| --- | --- |
| Overview | Actual saved counts, quick capture, pinned notes, goal focus, recent activity |
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

## Next phase

Add authenticated multi-device storage with per-user authorization, private object storage, automatic backups, and conflict handling. Then integrate the existing Python lexical retrieval engine through a separately deployed service or an explicit local bridge. Keep a visible source citation and retrieval confidence when adding it. Add provider spend tracking from actual usage, not estimated dashboard totals. Add reference-image editing and video adapters after implementing provider-specific cost quotes and per-run approval. Build Business only when its entities and workflows are defined.

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
