// DocEditor: the rich text body of a document, TipTap (ProseMirror) with markdown in and out. Props:
//   markdown: the document's saved content, read once when the editor mounts
//   onChange: called with the new markdown on every edit; Docs.tsx debounces the save
//   label: the accessible name of the editing area
// Docs.tsx loads this file with React.lazy, so TipTap is its own chunk and the app's start is unchanged.
// Mount it with key={doc.id}: a different document is a fresh editor, never a content swap.
//
// Typing shortcuts are TipTap input rules from StarterKit and the task list: "- " or "* " starts a
// bullet list, "1. " a numbered one, "[] " a checklist item, "# " to "### " a heading. Tab and
// Shift+Tab indent and outdent a list item. Selecting text shows a small toolbar; its Checklist
// button and Ctrl+Shift+9 convert whole lists, nesting kept (lib/docs-lists.ts).
// LaTeX math: "$x^2$" becomes an inline formula and a paragraph of "$$x$$" a display one, drawn by KaTeX;
// a click shows the source to edit (lib/docs-math-editor.ts). KaTeX and its stylesheet load with this chunk.
import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Bold, Heading2, Italic, List, ListChecks } from 'lucide-react';
import { allChecklists, convertLists, selectedLists } from '@/lib/docs-lists';
import { DocBlockMath, DocInlineMath, DocMarkdown } from '@/lib/docs-math-editor';
import 'katex/dist/katex.min.css';
import './doc-editor.css';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    checklist: {
      // Checklist on or off for the selected lists, every level; plain paragraphs become a new checklist.
      toggleChecklist: () => ReturnType;
      // Bullets on or off; a selected checklist goes back to bullets with its nesting kept.
      toggleBullets: () => ReturnType;
    };
  }
}

// TipTap's TaskList, with its Ctrl+Shift+9 pointed at the nesting-safe conversion instead of
// toggleTaskList. this.parent keeps the extension's own commands alongside the two new ones.
const Checklist = TaskList.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      toggleChecklist: () => ({ state, tr, dispatch, commands }) => {
        if (!selectedLists(state).length) return commands.toggleTaskList();
        return convertLists(state, dispatch ? tr : state.tr, allChecklists(state) ? 'bulletList' : 'taskList');
      },
      toggleBullets: () => ({ state, tr, dispatch, commands }) => {
        if (selectedLists(state).some(({ node }) => node.type.name === 'taskList')) return convertLists(state, dispatch ? tr : state.tr, 'bulletList');
        return commands.toggleBulletList();
      },
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-9': () => this.editor.commands.toggleChecklist() };
  },
});

// Four spaces per level when writing lists: CommonMark reads it as nesting, and the app's own
// Markdown.tsx (which works out depth as indent / 3) shows the first two levels at their depth.
export const docExtensions = () => [
  StarterKit.configure({ link: { openOnClick: false } }),
  Checklist,
  TaskItem.configure({ nested: true }),
  DocInlineMath,
  DocBlockMath,
  DocMarkdown.configure({ indentation: { style: 'space', size: 4 } }),
];

// The saved markdown. StarterKit keeps an empty paragraph after a list at the end of the document so
// the cursor can leave it; that paragraph is not content, so trailing blank lines are dropped.
export const markdownOf = (editor: Editor) => editor.getMarkdown().replace(/\s+$/, '');

export default function DocEditor({ markdown, onChange, label = 'Document body' }: { markdown: string; onChange: (markdown: string) => void; label?: string }) {
  // The latest onChange in a ref: the editor is created once, and its onUpdate would otherwise
  // keep calling the onChange from the first render.
  const changed = useRef(onChange);
  useEffect(() => { changed.current = onChange; }, [onChange]);
  const editor = useEditor({
    extensions: docExtensions(),
    content: markdown,
    contentType: 'markdown',
    editorProps: { attributes: { class: 'doc-editor-body', 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => changed.current(markdownOf(editor)),
  });
  return <div className="doc-editor">
    <SelectionToolbar editor={editor}/>
    <EditorContent editor={editor}/>
  </div>;
}

function SelectionToolbar({ editor }: { editor: Editor }) {
  // useEditorState re-renders this toolbar only when one of these answers changes, not on every keystroke.
  const on = useEditorState({ editor, selector: ({ editor }) => ({
    bold: editor.isActive('bold'), italic: editor.isActive('italic'), heading: editor.isActive('heading', { level: 2 }),
    bullets: editor.isActive('bulletList'), checklist: editor.isActive('taskList'),
  }) });
  const buttons = [
    { label: 'Bold', icon: Bold, active: on.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', icon: Italic, active: on.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Heading', icon: Heading2, active: on.heading, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Bullet list', icon: List, active: on.bullets, run: () => editor.chain().focus().toggleBullets().run() },
    { label: 'Checklist (Ctrl+Shift+9)', icon: ListChecks, active: on.checklist, run: () => editor.chain().focus().toggleChecklist().run() },
  ];
  return <BubbleMenu editor={editor} className="doc-bubble" role="toolbar" aria-label="Format selection">
    {buttons.map(({ label, icon: Icon, active, run }) =>
      <button key={label} type="button" aria-label={label} title={label} aria-pressed={active} onMouseDown={event => event.preventDefault()} onClick={run}><Icon size={15}/></button>)}
  </BubbleMenu>;
}
