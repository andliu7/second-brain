// The to-buy list's pure logic (BuyList.tsx): what a card shows from its option rows, and the sorts.
import type { BuyItem, BuyOption } from '../types';
import { CATEGORY_IDS } from './categories';

export type SortKey = 'category' | 'price' | 'name';

// The cheapest row with a price, or null when no row has one.
export const lowestPrice = (item: BuyItem): BuyOption | null => item.options.filter(o => o.price !== null).reduce<BuyOption | null>((best, o) => best === null || (o.price as number) < (best.price as number) ? o : best, null);
// The best-rated row with a rating, or null when no row has one.
export const bestRating = (item: BuyItem): BuyOption | null => item.options.filter(o => o.rating !== null).reduce<BuyOption | null>((best, o) => best === null || (o.rating as number) > (best.rating as number) ? o : best, null);

export function sortItems(items: BuyItem[], by: SortKey): BuyItem[] {
  const byName = (a: BuyItem, b: BuyItem) => a.name.localeCompare(b.name);
  if (by === 'name') return [...items].sort(byName);
  if (by === 'category') return [...items].sort((a, b) => CATEGORY_IDS.indexOf(a.category) - CATEGORY_IDS.indexOf(b.category) || byName(a, b));
  // Items without a price go last, then by name.
  const price = (item: BuyItem) => lowestPrice(item)?.price ?? Infinity;
  return [...items].sort((a, b) => price(a) - price(b) || byName(a, b));
}

export function money(price: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(price); } catch { return `${price} ${currency}`; }
}
