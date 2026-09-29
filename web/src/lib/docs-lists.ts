// Converting a bullet list to a checklist and back, keeping every level of nesting.
//
// TipTap's own toggleTaskList only rewraps the items at the cursor's depth, so a two-level bullet
// list comes out as a checklist with bullet sub-points (or is split apart). This walks each list the
// selection touches and rebuilds it whole: every bulletList or orderedList becomes a taskList and
// every listItem a taskItem, at every depth, or the reverse. A list is converted whole, children and
// all, even when the selection covers only part of it, the way "select the list and convert it"
// reads. Only imported by the editor chunk (doc-editor.tsx), so it never loads at start.
import { Fragment, type Node, type Schema } from '@tiptap/pm/model';
import { Selection, type EditorState, type Transaction } from '@tiptap/pm/state';

export type ListTarget = 'taskList' | 'bulletList';
const LISTS = ['bulletList', 'orderedList', 'taskList'];
const ITEMS = ['listItem', 'taskItem'];

// The outermost lists that the selection touches, with their positions. nodesBetween walks top down,
// and returning false stops it descending, so a list inside a found list is never reported twice.
export function selectedLists(state: EditorState): { node: Node; pos: number }[] {
  const { from, to } = state.selection;
  const found: { node: Node; pos: number }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!LISTS.includes(node.type.name)) return true;
    found.push({ node, pos });
    return false;
  });
  return found;
}

// A copy of the node with every list and list item below it retyped. Item content is the same shape
// for both item types ("paragraph block*"), so the copy is always valid and exactly the same size,
// which keeps the cursor where it was. A checklist item going back to a bullet loses its tick.
function retype(node: Node, schema: Schema, to: ListTarget): Node {
  const children: Node[] = [];
  node.forEach(child => children.push(retype(child, schema, to)));
  const content = Fragment.from(children);
  const name = node.type.name;
  if (LISTS.includes(name) && (to === 'taskList' || name === 'taskList')) return schema.nodes[to].create(null, content);
  if (ITEMS.includes(name) && (to === 'taskList' || name === 'taskItem')) return schema.nodes[to === 'taskList' ? 'taskItem' : 'listItem'].create(to === 'taskList' ? { checked: false } : null, content);
  return node.copy(content);
}

// Rewrites the selected lists on tr. Returns false when the selection touches no list, so the caller
// can fall back to wrapping plain paragraphs in a new list.
export function convertLists(state: EditorState, tr: Transaction, to: ListTarget): boolean {
  const lists = selectedLists(state);
  if (!lists.length) return false;
  // A replaced range maps the cursor to its edge; the sizes do not change, so the selection is put
  // back where it was. Read it first: inside a TipTap command, state.selection follows tr.
  const selection = state.selection.toJSON();
  for (const { node, pos } of lists) {
    const at = tr.mapping.map(pos);
    tr.replaceWith(at, at + node.nodeSize, retype(node, state.schema, to));
  }
  tr.setSelection(Selection.fromJSON(tr.doc, selection));
  return true;
}

// The checklist toggle: if every selected list is already a checklist, back to bullets; otherwise
// everything selected becomes a checklist.
export const allChecklists = (state: EditorState) => {
  const lists = selectedLists(state);
  return lists.length > 0 && lists.every(({ node }) => node.type.name === 'taskList');
};
