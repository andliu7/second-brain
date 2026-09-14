# Shared UI components

The React application is in `web/`. It uses React 19, TypeScript, Vite, Tailwind CSS 4, and shadcn-compatible aliases. No context provider or state-management library is needed for the prompt input.

- Shared components: `web/src/components/ui/` (`@/components/ui`).
- Tailwind entry and prompt theme: `web/src/index.css`.
- Existing app styles: `web/src/styles.css`, imported in the components cascade layer.
- Existing accessibility overrides: `web/src/accessibility.css`.
- Class merging: `web/src/lib/utils.ts` (`clsx` + `tailwind-merge`).

There was no shared UI folder previously. `src/components/ui` is the source-root equivalent of `/components/ui`; `@` resolves to `src`. Keeping this folder and the `components.json` aliases aligned lets the shadcn CLI install reusable components and resolve their imports consistently.

## Run and preview

```powershell
cd web
npm install
npm run dev
```

Open `http://127.0.0.1:5174/#chat` for the integrated input or `http://127.0.0.1:5174/prompt-demo` for the supplied gradient demo. The demo includes light/dark themes and displays the submitted text, model, effort, and image filenames locally. Its model names are sample UI choices, not a claim of provider availability.

Chat preserves the existing provider selector, editable model ID, saved context, and persistence flow. Its current transport accepts text only, so the image and effort controls are hidden there. The full component supports those features through its submission metadata for a transport that implements them. Chat clears the controlled draft only after saving the user message successfully.

## Component API

```tsx
import { PromptInput } from '@/components/ui/ai-chat-input';

<PromptInput
  onSubmit={async (text, { model, effort, attachments }) => {
    // Pass text and metadata to your transport. Files remain ordinary File objects.
    // Return false or throw to retain the draft; successful completion clears it.
  }}
  placeholder="Ask anything..."
  maxAttachments={6}
/>
```

Use `value` and `onChange` for controlled state, or `defaultValue` for local state. `models` and `efforts` customize the available choices. `disabled` locks the input; `submitDisabled` blocks sending while still allowing drafting. `ariaLabel` and `sendLabel` customize accessible names. `showModelSelector` and `showEffortSelector` hide unsupported controls; `maxAttachments={0}` hides image selection.

The input expands from 320 to 480 pixels and stays within its parent's width. Text grows up to 160 pixels before scrolling. Image thumbnails have a keyboard-accessible gallery and remove buttons. Enter submits, Shift+Enter inserts a newline, and input-method composition does not submit. Model selection supports arrow keys and Escape; dialogs use native focus containment and restore focus on close. Reduced-motion settings disable animations.

Voice input requires a secure context (localhost or HTTPS), microphone permission, and browser speech-recognition support. Unsupported or denied access produces an inline message; no simulated transcription is inserted. Audio resources and image URLs are cleaned up on stop/removal/unmount. Icons use the installed `lucide-react` package; attachments are user-selected images, so there are no placeholder or stock-image assets to replace.

## Tailwind and shadcn setup

Setup is already implemented. Tailwind uses `@tailwindcss/vite`, while `tw-animate-css` provides the supplied animation utilities. The stylesheet imports Tailwind's theme and utility layers separately to retain the existing application reset, as supported by the [Tailwind Preflight documentation](https://tailwindcss.com/docs/preflight).

The supplied CSS had undefined `----color-*` references and nested `hsl(hsl(...))` values. The integrated stylesheet maps actual semantic tokens directly and scopes them to the prompt UI to avoid overwriting the app's existing `--border` and `--muted` variables.

To add another shadcn component from `web/`:

```powershell
npx shadcn@latest add button
```

For a new Vite React TypeScript project, use the [shadcn Vite setup](https://ui.shadcn.com/docs/installation/vite) and [Tailwind Vite setup](https://tailwindcss.com/docs/installation/using-vite): scaffold with `npm create vite@latest my-app -- --template react-ts`, install `tailwindcss @tailwindcss/vite`, configure the Vite plugin and the `@/*` alias in Vite and TypeScript, import Tailwind in the stylesheet, then run `npx shadcn@latest init`. This project already has those pieces and should not be reinitialized.
