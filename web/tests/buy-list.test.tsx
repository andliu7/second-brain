import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { BuyList } from '../src/BuyList';
import { bestRating, lowestPrice, sortItems } from '../src/lib/buylist';
import { initialWorkspace } from '../src/lib/storage';
import { validateWorkspace } from '../shared/validate.mjs';
import type { BuyItem, BuyOption, Workspace } from '../src/types';

const option = (store: string, price: number | null, rating: number | null, extra: Partial<BuyOption> = {}): BuyOption => ({ id: 'opt-' + store.toLowerCase(), store, price, currency: 'USD', rating, notes: '', link: '', ...extra });
const item = (name: string, category: BuyItem['category'], options: BuyOption[] = []): BuyItem => ({ id: 'buy-' + name.toLowerCase(), name, category, image: '', links: [], notes: '', options });

function Harness({ initial, onCommit }: { initial: Workspace; onCommit?: (w: Workspace) => void }) {
  const [workspace, setWorkspace] = useState(initial);
  const commit = async (update: (w: Workspace) => Workspace) => { setWorkspace(w => { const next = update(w); validateWorkspace(next); onCommit?.(next); return next; }); return true; };
  return <BuyList workspace={workspace} commit={commit}/>;
}

describe('the to-buy list', () => {
  it('shows the lowest price and the best rating from an item\'s option rows', () => {
    const kettle = item('Kettle', 'other', [option('Amazon', 39.99, 4.2), option('Target', 34.5, 3.8), option('Local', null, 5), option('Ebay', 60, null)]);
    expect(lowestPrice(kettle)?.store).toBe('Target');
    expect(bestRating(kettle)?.store).toBe('Local');
    expect(lowestPrice(item('Bare', 'other'))).toBeNull();
    expect(bestRating(item('Bare', 'other'))).toBeNull();
    expect(lowestPrice(item('Free', 'other', [option('A', 0, null)]))?.price).toBe(0);
  });

  it('sorts by category, by lowest price with unpriced items last, and by name', () => {
    const items = [item('Zip', 'other', [option('A', 5, null)]), item('Book', 'academic'), item('Weights', 'fitness', [option('B', 1, null)]), item('Apple', 'other', [option('C', 12, null)])];
    expect(sortItems(items, 'category').map(i => i.name)).toEqual(['Book', 'Weights', 'Apple', 'Zip']);
    expect(sortItems(items, 'price').map(i => i.name)).toEqual(['Weights', 'Zip', 'Apple', 'Book']);
    expect(sortItems(items, 'name').map(i => i.name)).toEqual(['Apple', 'Book', 'Weights', 'Zip']);
    expect(items[0].name).toBe('Zip');
  });

  it('a workspace saved before buyList existed loads empty, and adding by link uses the preview', async () => {
    const user = userEvent.setup();
    const { buyList: _list, ...legacy } = initialWorkspace();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('link-preview') ? { title: 'Blue Kettle', image: 'https://shop.example/k.jpg', site: 'Shop' } : {}), { status: 200, headers: { 'content-type': 'application/json' } })));
    const commits: Workspace[] = [];
    render(<Harness initial={legacy as Workspace} onCommit={w => commits.push(w)}/>);
    expect(screen.getByText('Nothing on the list yet.')).toBeInTheDocument();
    expect(document.querySelectorAll('.buy-card')).toHaveLength(0);
    await user.type(screen.getByLabelText('Link or name of the item to add'), 'https://shop.example/kettle');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(commits.length).toBe(1));
    expect(String((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toBe('/api/link-preview?url=' + encodeURIComponent('https://shop.example/kettle'));
    const added = commits[0].buyList?.[0];
    expect(added).toMatchObject({ name: 'Blue Kettle', image: 'https://shop.example/k.jpg', links: ['https://shop.example/kettle'], category: 'other', options: [] });
    // The new item opens in its editor; Escape closes it and the card shows its link by host.
    expect(screen.getByRole('group', { name: 'Editing Blue Kettle' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: /Editing/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /shop.example/ })).toHaveAttribute('href', 'https://shop.example/kettle');
  });
});
