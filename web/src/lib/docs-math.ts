/// <reference types="vite/client" />
// LaTeX math in notes: $inline$ and $$display$$, drawn by KaTeX (MIT). Two readers share the rules here,
// so a formula looks the same wherever the note is read: the editor (components/ui/doc-editor.tsx, whose
// math nodes come from @tiptap/extension-mathematics) and the read-only renderer (Markdown.tsx), which
// Chat, Skills and the file viewer also use.
//
// Where $ starts math follows Pandoc's rule, so prices are left alone: the opening $ has a non-space
// character right after it, the closing $ has a non-space character right before it and no digit right
// after it. "$x^2$" is math; "$5 and $10" is not, because the second $ has a space before it. \$ is a
// written dollar sign, never math.
//
// KaTeX is about 270 KB of script plus its stylesheet and fonts, so it never loads with the app. The
// editor chunk imports it (it is already lazy), and Markdown.tsx calls loadKatex() only when a text
// holds something that looks like math.

// One inline formula, matched at the start of the text: $, then the formula (a backslash escape such as
// \$ counts as one character of it), then $. Group 1 is the formula exactly as written.
export const INLINE_MATH = /^\$(?=[^\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$(?![\d$])/;
// A display formula on its own lines: $$, the formula (newlines and all), $$. Group 1 is kept exactly as
// written, surrounding newlines included, so saving writes back the same text that was read.
export const BLOCK_MATH = /^\$\$((?:\\.|[^$\\])+?)\$\$[ \t]*(?:\n|$)/;

type Katex = typeof import('katex').default;
let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;
// The module, once loaded; null until then.
export const loadedKatex = () => katex;
// Loads KaTeX and its stylesheet once. The stylesheet's fonts load only when a formula needs them.
export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => (katex = module.default));
  return loading;
}

// KaTeX's options for every formula here. throwOnError off draws a formula with a mistake in red with
// its source, rather than throwing. trust stays at its default (off), which refuses \href, \url,
// \includegraphics and \html*, so a formula cannot add a link or markup of its own.
export const KATEX_OPTIONS = { throwOnError: false, output: 'htmlAndMathml' as const };
