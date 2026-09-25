// BuyList: the long-term to-buy list, one card per item. Props:
//   workspace: the Workspace; the list is workspace.buyList, empty when a saved workspace predates it
//   commit: App's commit, which saves the updated workspace and reports failure with a toast
// Mount from Today.tsx with one line:
//   <BuyList workspace={workspace} commit={commit}/>
//
// Add by name, or paste a link: the link goes to GET /api/link-preview (server/link-preview.mjs) for
// its title, image and site, and becomes the item's first link. Each item has a category, an image
// (a URL, or "doc:<id>" for an image doc in this workspace), links, notes and manual option rows
// (store, price, currency, rating, notes, link); the card shows the lowest price and the best rating
// from those rows (lib/buylist.ts). Nothing is scraped beyond the page's title tags.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowUpRight, ImageIcon, Loader2, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import type { BuyItem, BuyOption, Doc, Workspace } from './types';
import { CATEGORIES, categoryOf, type CategoryId } from './lib/categories';
import { uid } from './lib/storage';
import { api } from './lib/api';
import { bestRating, lowestPrice, money, sortItems, type SortKey } from './lib/buylist';
import './buylist.css';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;
type Preview = { title?: string; image?: string; site?: string; error?: string };

const isLink = (text: string) => /^https?:\/\/\S+$/i.test(text);
const hostOf = (link: string) => { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return link; } };
const newOption = (): BuyOption => ({ id: uid(), store: '', price: null, currency: 'USD', rating: null, notes: '', link: '' });
// An item's picture: a doc's data URL when image is "doc:<id>", otherwise the URL as given.
const imageSrc = (item: BuyItem, docs: Doc[]) => item.image.startsWith('doc:') ? docs.find(d => d.id === item.image.slice(4))?.data ?? '' : item.image;

export function BuyList({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  const items = workspace.buyList ?? [];
  const patch = (change: (items: BuyItem[]) => BuyItem[], message?: string) => commit(w => ({ ...w, buyList: change(w.buyList ?? []) }), message);
  const [sort, setSort] = useState<SortKey>('category');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim(); if (!value || busy) return;
    const item: BuyItem = { id: uid(), name: value, category: 'other', image: '', links: [], notes: '', options: [] };
    setNote('');
    if (isLink(value)) {
      setBusy(true);
      item.links = [value]; item.name = hostOf(value);
      try {
        const preview = await api<Preview>('link-preview?url=' + encodeURIComponent(value));
        if (preview.error) setNote(preview.error);
        else { if (preview.title) item.name = preview.title; if (preview.image) item.image = preview.image; }
      } catch (error) { setNote(String((error as Error).message || 'The link could not be read.')); }
      finally { setBusy(false); }
    }
    if (await patch(list => [...list, item], 'Added to the list')) { setDraft(''); setEditing(item.id); }
  }
  const save = (item: BuyItem) => patch(list => list.map(i => i.id === item.id ? item : i));
  const remove = (id: string) => { setEditing(null); void patch(list => list.filter(i => i.id !== id), 'Removed from the list'); };

  return <section className="panel buy-list" aria-label="To buy">
    <div className="section-heading"><h2>To buy</h2>
      <label className="buy-sort">Sort<select value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort by"><option value="category">Category</option><option value="price">Lowest price</option><option value="name">Name</option></select></label>
    </div>
    <div className="buy-body">
      <form className="buy-add" onSubmit={add}>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Paste a link, or type a name" aria-label="Link or name of the item to add" disabled={busy}/>
        <button type="submit" className="button" disabled={!draft.trim() || busy}>{busy ? <Loader2 size={14} className="spin"/> : <Plus size={14}/>}Add</button>
      </form>
      {note && <p className="today-note" role="status">{note}</p>}
      {items.length === 0 && <p className="today-note">Nothing on the list yet.</p>}
      <ul className="buy-grid">
        {sortItems(items, sort).map(item => <li key={item.id}>
          {editing === item.id
            ? <BuyEditor item={item} docs={workspace.docs} save={save} remove={() => remove(item.id)} close={() => setEditing(null)}/>
            : <BuyCard item={item} docs={workspace.docs} edit={() => setEditing(item.id)}/>}
        </li>)}
      </ul>
    </div>
  </section>;
}

function BuyCard({ item, docs, edit }: { item: BuyItem; docs: Doc[]; edit: () => void }) {
  const cat = categoryOf(item.category);
  const cheapest = lowestPrice(item); const best = bestRating(item); const src = imageSrc(item, docs);
  return <article className="buy-card" style={{ '--cat': cat?.color } as CSSProperties}>
    <div className="buy-image">{src ? <img src={src} alt="" loading="lazy"/> : <ImageIcon size={22}/>}</div>
    <div className="buy-main">
      <div className="buy-title"><h3>{item.name}</h3><button type="button" className="icon-button" aria-label={`Edit ${item.name}`} onClick={edit}><Pencil size={14}/></button></div>
      <div className="buy-chips">
        <span className="tag buy-cat">{cat?.label}</span>
        {cheapest && <span className="tag">{money(cheapest.price as number, cheapest.currency)}{cheapest.store && ` at ${cheapest.store}`}</span>}
        {best && <span className="tag"><Star size={11}/>{best.rating}{best.store && ` ${best.store}`}</span>}
      </div>
      {item.notes && <p className="buy-notes">{item.notes}</p>}
      {item.links.length > 0 && <div className="buy-links">{item.links.map(link => <a key={link} href={link} target="_blank" rel="noreferrer">{hostOf(link)}<ArrowUpRight size={12}/></a>)}</div>}
    </div>
  </article>;
}

function BuyEditor({ item, docs, save, remove, close }: { item: BuyItem; docs: Doc[]; save: (item: BuyItem) => Promise<boolean>; remove: () => void; close: () => void }) {
  const [links, setLinks] = useState(item.links.join('\n'));
  const set = (update: Partial<BuyItem>) => save({ ...item, ...update });
  const setOption = (id: string, update: Partial<BuyOption>) => set({ options: item.options.map(o => o.id === id ? { ...o, ...update } : o) });
  const number = (value: string, max?: number) => { if (value === '') return null; const n = Number(value); return Number.isFinite(n) ? Math.max(0, max === undefined ? n : Math.min(max, n)) : null; };
  // Escape closes the editor from anywhere on the page, not only from a field inside it, and the
  // editor takes focus when it opens so the keyboard is already in it.
  const nameField = useRef<HTMLInputElement>(null);
  useEffect(() => { nameField.current?.focus(); }, []);
  useEffect(() => { const keys = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close(); }; document.addEventListener('keydown', keys); return () => document.removeEventListener('keydown', keys); }, [close]);
  const images = docs.filter(d => d.data && d.mime?.startsWith('image/'));
  return <div className="buy-card buy-editor" role="group" aria-label={`Editing ${item.name}`}>
    <div className="buy-title"><h3>Edit item</h3><button type="button" className="icon-button" aria-label="Close editor" onClick={close}><X size={15}/></button></div>
    <div className="buy-fields">
      <label>Name<input ref={nameField} value={item.name} onChange={e => set({ name: e.target.value })}/></label>
      <label>Category<select value={item.category} onChange={e => set({ category: e.target.value as CategoryId })}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label>Image URL<input value={item.image.startsWith('doc:') ? '' : item.image} onChange={e => set({ image: e.target.value })} placeholder="https://"/></label>
      <label>Or a workspace image<select value={item.image.startsWith('doc:') ? item.image : ''} onChange={e => set({ image: e.target.value })}><option value="">None</option>{images.map(d => <option key={d.id} value={'doc:' + d.id}>{d.name}</option>)}</select></label>
      <label className="buy-wide">Links, one per line<textarea rows={2} value={links} onChange={e => setLinks(e.target.value)} onBlur={() => set({ links: links.split('\n').map(l => l.trim()).filter(Boolean) })}/></label>
      <label className="buy-wide">Notes<textarea rows={2} value={item.notes} onChange={e => set({ notes: e.target.value })}/></label>
    </div>
    <div className="buy-options-wrap"><table className="buy-options" aria-label="Options">
      <thead><tr><th>Store</th><th>Price</th><th>Currency</th><th>Rating</th><th>Notes</th><th>Link</th><th><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>{item.options.map(o => <tr key={o.id}>
        <td><input value={o.store} onChange={e => setOption(o.id, { store: e.target.value })} aria-label="Store"/></td>
        <td><input type="number" min="0" step="0.01" value={o.price ?? ''} onChange={e => setOption(o.id, { price: number(e.target.value) })} aria-label="Price"/></td>
        <td><input value={o.currency} maxLength={8} onChange={e => setOption(o.id, { currency: e.target.value.toUpperCase() })} aria-label="Currency"/></td>
        <td><input type="number" min="0" max="5" step="0.5" value={o.rating ?? ''} onChange={e => setOption(o.id, { rating: number(e.target.value, 5) })} aria-label="Rating out of 5"/></td>
        <td><input value={o.notes} onChange={e => setOption(o.id, { notes: e.target.value })} aria-label="Option notes"/></td>
        <td><input value={o.link} onChange={e => setOption(o.id, { link: e.target.value })} aria-label="Option link" placeholder="https://"/></td>
        <td><button type="button" className="icon-button" aria-label="Remove option" onClick={() => set({ options: item.options.filter(x => x.id !== o.id) })}><X size={13}/></button></td>
      </tr>)}</tbody>
    </table></div>
    <div className="buy-actions">
      <button type="button" className="button" onClick={() => set({ options: [...item.options, newOption()] })}><Plus size={14}/>Add option</button>
      <button type="button" className="button" onClick={remove}><Trash2 size={14}/>Delete item</button>
      <button type="button" className="button primary" onClick={close}>Done</button>
    </div>
  </div>;
}
