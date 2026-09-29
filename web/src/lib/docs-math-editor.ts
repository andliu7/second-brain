// The editor's math: @tiptap/extension-mathematics' InlineMath and BlockMath nodes, changed in four ways.
// Only imported by the editor chunk (components/ui/doc-editor.tsx), so KaTeX loads with the editor.
//
// 1. Markdown in and out keeps the formula exactly as written. The extension trims it and writes a
//    display formula back on three lines; here the text between the dollars is kept as it was, so
//    "$$x$$" stays one line and the spacing around a multi-line formula survives a save. Which $ starts
//    math is Pandoc's rule (lib/docs-math.ts), so "$5 and $10" stays text.
// 2. Typing: "$x$" makes inline math the moment the closing $ is typed, and a paragraph that is only
//    "$$x$$" becomes display math. (The extension's own rules want $$x$$ inline and $$$x$$$ for a block.)
// 3. A formula shows rendered, and a click (or Enter while it is selected) turns it into its source in a
//    small text field: Enter or leaving the field keeps the edit, Escape drops it, and an empty field
//    removes the formula. The field lives inside the node's own DOM (a ProseMirror node view), so the
//    document never holds half-typed LaTeX.
// 4. Plain text that would read back as math is saved with its $ escaped (DocMarkdown, at the end), so a
//    note that says "\$x\$" does not come back as a formula. A $ that could not start math (a price) is
//    left as it is.
import katex from 'katex';
import { InputRule, type Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { Markdown, type MarkdownManager } from '@tiptap/markdown';
import { BLOCK_MATH, INLINE_MATH, KATEX_OPTIONS } from './docs-math';

// A formula drawn by KaTeX that edits as source. display is true for a block formula.
function mathView(start: PMNode, editor: Editor, getPos: () => number | undefined, display: boolean) {
  let node = start;
  let field: HTMLInputElement | HTMLTextAreaElement | null = null;
  const dom = document.createElement(display ? 'div' : 'span');
  dom.className = 'doc-math';
  dom.dataset.display = String(display);
  const shown = document.createElement(display ? 'div' : 'span');
  dom.append(shown);
  const render = () => {
    katex.render(node.attrs.latex, shown, { ...KATEX_OPTIONS, displayMode: display });
    dom.title = editor.isEditable ? 'Click to edit the LaTeX' : '';
  };
  // Leaves the field. keep writes the edit into the document; the node's update() then redraws it.
  const close = (keep: boolean) => {
    if (!field) return;
    const value = field.value;
    field = null;  // first, so the blur that removing the field may fire finds nothing to close
    dom.replaceChildren(shown);
    const pos = getPos();
    if (pos === undefined) return;
    const end = pos + node.nodeSize;
    if (keep && !value.trim()) { editor.chain().deleteRange({ from: pos, to: end }).focus(pos).run(); return; }
    if (keep && value !== node.attrs.latex) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, latex: value }));
    editor.commands.focus(end);
  };
  const open = () => {
    if (field || !editor.isEditable) return;
    field = document.createElement(display ? 'textarea' : 'input');
    field.className = 'doc-math-source';
    field.value = node.attrs.latex;
    field.spellcheck = false;
    field.setAttribute('aria-label', display ? 'LaTeX source of the display formula' : 'LaTeX source of the formula');
    if (field instanceof HTMLInputElement) field.size = Math.max(4, field.value.length + 1);
    else field.rows = Math.max(2, field.value.split('\n').length);
    field.addEventListener('keydown', (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      // Shift+Enter is a new line in a display formula; plain Enter keeps the edit.
      if (event.key === 'Enter' && !(display && event.shiftKey)) { event.preventDefault(); close(true); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(false); }
    });
    field.addEventListener('input', () => { if (field instanceof HTMLInputElement) field.size = Math.max(4, field.value.length + 1); });
    field.addEventListener('blur', () => close(true));
    dom.replaceChildren(field);
    field.focus();
    field.select();
  };
  dom.addEventListener('click', event => { event.preventDefault(); open(); });
  // Enter on a selected formula (the extension below) asks for the field with this event.
  dom.addEventListener('doc-math-edit', open);
  render();
  return {
    dom,
    update(next: PMNode) { if (next.type !== node.type) return false; node = next; if (!field) render(); return true; },
    // Keys and clicks inside the field belong to the field, not to the editor around it.
    stopEvent: (event: Event) => !!field && event.target === field,
    ignoreMutation: () => true,
    selectNode: () => dom.classList.add('is-selected'),
    deselectNode: () => dom.classList.remove('is-selected'),
  };
}

// Enter while a formula of this type is selected opens its source.
const editSelected = (editor: Editor, name: string) => {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== name) return false;
  editor.view.nodeDOM(selection.from)?.dispatchEvent(new Event('doc-math-edit'));
  return true;
};

export const DocInlineMath = InlineMath.extend({
  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start: (src: string) => src.indexOf('$'),
    tokenize: (src: string) => { const match = INLINE_MATH.exec(src); return match ? { type: 'inlineMath', raw: match[0], latex: match[1] } : undefined; },
  },
  addInputRules() {
    // The text before the cursor ends in $formula$, typed just now; a $ or a backslash before the opening
    // $ means it is not an opening one ($$ is display, \$ is a written dollar).
    return [new InputRule({
      find: /(?<![$\\])\$(?=[^\s$])((?:\\.|[^$\\\n])+?)(?<!\s)\$$/,
      handler: ({ state, range, match }) => { state.tr.replaceWith(range.from, range.to, this.type.create({ latex: match[1] })); },
    })];
  },
  addKeyboardShortcuts() { return { Enter: () => editSelected(this.editor, this.name) }; },
  addNodeView() { return ({ node, editor, getPos }) => mathView(node, editor, getPos, false); },
});

export const DocBlockMath = BlockMath.extend({
  renderMarkdown: node => `$$${node.attrs?.latex ?? ''}$$`,
  markdownTokenizer: {
    name: 'blockMath',
    level: 'block',
    start: (src: string) => src.indexOf('$$'),
    tokenize: (src: string) => { const match = BLOCK_MATH.exec(src); return match ? { type: 'blockMath', raw: match[0], latex: match[1] } : undefined; },
  },
  addInputRules() {
    // A paragraph that is only $$formula$$ becomes a display formula in its place.
    return [new InputRule({
      find: /^\$\$([^$]+)\$\$$/,
      handler: ({ state, range, match }) => {
        const $from = state.doc.resolve(range.from);
        const whole = $from.parent.isTextblock && range.from === $from.start() && range.to === $from.end();
        const node = this.type.create({ latex: match[1] });
        if (whole && $from.depth > 0) state.tr.replaceWith($from.before(), $from.after(), node);
        else state.tr.replaceWith(range.from, range.to, node);
      },
    })];
  },
  addKeyboardShortcuts() { return { Enter: () => editSelected(this.editor, this.name) }; },
  addNodeView() { return ({ node, editor, getPos }) => mathView(node, editor, getPos, true); },
});

// A text run's $ that would open a formula, or be half of $$, when the markdown is read again, gets a
// backslash. Runs after TipTap's own escaping, whose backslashes INLINE_MATH reads as escapes too.
export const escapeMathDollars = (text: string) => text.replace(/\$/g, (dollar, at: number) =>
  text[at + 1] === '$' || text[at - 1] === '$' || INLINE_MATH.test(text.slice(at)) ? '\\$' : dollar);

// TipTap's Markdown with that escaping added to the text it writes. The manager is made in
// onBeforeCreate, so its escape is wrapped right after. escapeMarkdownSyntax is a private method (TipTap
// offers no option for it), hence the cast; if an update renames it, the "\$x\$" round trip test in
// tests/docs-editor.test.tsx fails, rather than notes quietly gaining formulas.
type Escaper = { escapeMarkdownSyntax: (text: string) => string };
export const DocMarkdown = Markdown.extend({
  onBeforeCreate(event) {
    this.parent?.(event);
    const manager = (this.storage as { manager: MarkdownManager }).manager as unknown as Escaper;
    const escape = manager.escapeMarkdownSyntax.bind(manager);
    manager.escapeMarkdownSyntax = text => escapeMathDollars(escape(text));
  },
});
