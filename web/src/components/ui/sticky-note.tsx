// StickyNote: one card drawn as a sticky note on the sticky canvas. framer-motion drags it and flips it.
// Props:
//   card: the Card to show (title, notes, category, checklist)
//   position: { x, y, rotate } in canvas pixels and degrees; the parent decides this (persisted or a default)
//   canvas: ref of the element the note may be dragged within
//   onMove(x, y): the note was dropped; persist the position
//   onRotate(): Rotate 45 from the menu
//   onCategory(id): a category picked from the menu's Colour row
//   onToggle(itemId): a checklist item on the back was ticked
//   onDelete(): Delete from the menu
// Right-click (or Shift+F10, or Enter when focused) opens the menu: Rotate 45, Flip, Colour, Delete.
// Flip is local state: the back of the note shows the checklist, and it is not saved. The note's fill is
// its category's colour, or paper when it has none; the ink is picked to read on that fill.
import { useEffect, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion, useMotionValue, type MotionStyle } from 'framer-motion';
import { Palette, RotateCw, Trash2, Undo2 } from 'lucide-react';
import type { Card } from '../../types';
import { categoryOf, inkOn, type CategoryId } from '../../lib/categories';
import { Checklist, checklistSummary } from './checklist';
import { ColorSwatches } from './color-swatches';

export type StickyPosition = { x: number; y: number; rotate: number };
type Props = { card: Card; position: StickyPosition; canvas: RefObject<HTMLElement | null>; onMove: (x: number, y: number) => void; onRotate: () => void; onCategory: (id?: CategoryId) => void; onToggle: (itemId: string) => void; onDelete: () => void };
const PAPER = '#f2e6a8';

export function StickyNote({ card, position, canvas, onMove, onRotate, onCategory, onToggle, onDelete }: Props) {
  const x = useMotionValue(position.x); const y = useMotionValue(position.y);
  useEffect(() => { x.set(position.x); y.set(position.y); }, [position.x, position.y, x, y]);
  const [flipped, setFlipped] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; colours: boolean } | null>(null);
  const fill = categoryOf(card.category)?.color || PAPER;
  function openMenu(event: MouseEvent | KeyboardEvent) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); const at = 'clientX' in event && event.clientX ? { x: event.clientX, y: event.clientY } : { x: rect.left + 16, y: rect.top + 16 }; setMenu({ ...at, colours: false }); }
  function keys(event: KeyboardEvent<HTMLDivElement>) { if (event.target === event.currentTarget && event.key === 'Enter') openMenu(event); }
  const item = (label: string, Icon: typeof RotateCw, action: () => void, first = false) => <button type="button" role="menuitem" autoFocus={first} onClick={() => { setMenu(null); action(); }}><Icon size={14}/>{label}</button>;
  return <>
    <motion.div className="sticky" data-card={card.id} data-category={card.category} tabIndex={0} aria-label={card.title} style={{ x, y, '--cat': fill, '--ink': inkOn(fill) } as MotionStyle} drag dragMomentum={false} dragConstraints={canvas} dragElastic={0.05} initial={false} animate={{ rotate: position.rotate }} whileDrag={{ scale: 1.04, zIndex: 2 }} onDragEnd={() => onMove(Math.round(x.get()), Math.round(y.get()))} onContextMenu={openMenu} onKeyDown={keys}>
      <motion.div className="sticky-faces" initial={false} animate={{ rotateY: flipped ? 180 : 0 }} transition={{ duration: 0.45 }}>
        <div className="sticky-face">
          <strong>{card.title}</strong>
          {card.notes && <p>{card.notes}</p>}
          {card.checklist.length > 0 && <small>{checklistSummary(card.checklist)}</small>}
        </div>
        <div className="sticky-face back" aria-hidden={!flipped}>
          <small>Checklist</small>
          {card.checklist.length ? <Checklist items={card.checklist} onToggle={onToggle}/> : <p>Nothing on the list.</p>}
        </div>
      </motion.div>
    </motion.div>
    {menu && createPortal(<div className="sticky-menu-layer" onClick={() => setMenu(null)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setMenu(null); } }}>
      <div className="sticky-menu" role="menu" aria-label={`${card.title} menu`} style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }} onClick={event => event.stopPropagation()}>
        {item('Rotate 45', RotateCw, onRotate, true)}
        {item(flipped ? 'Flip to front' : 'Flip', Undo2, () => setFlipped(f => !f))}
        <button type="button" role="menuitem" aria-expanded={menu.colours} onClick={() => setMenu({ ...menu, colours: !menu.colours })}><Palette size={14}/>Colour</button>
        {menu.colours && <ColorSwatches value={card.category} onChange={id => { setMenu(null); onCategory(id); }}/>}
        {item('Delete', Trash2, onDelete)}
      </div>
    </div>, document.body)}
  </>;
}
