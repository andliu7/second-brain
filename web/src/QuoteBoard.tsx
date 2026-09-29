// QuoteBoard: one quote from lib/quotes.ts, picked at random on every page load, on the split-flap
// board. Props: rows and cols for the grid (6 by 22 by default), byline to put the author in a plain
// line under the board instead of on it (Today uses 2 by 36 with a byline so the board is a small box
// beside the title, and two rows hold any quote's text but not its author too), className for the
// placement. With a byline the quote is also plain text for a screen reader and the board is hidden
// from it, so the region reads as the quote and its author once. Nothing saved.
// Mount from Today.tsx with one line:
//   <QuoteBoard rows={2} cols={36} byline className="today-quote"/>
import { useState } from 'react';
import { TextFlippingBoard } from '@/components/ui/text-flipping-board';
import { pickQuote, quoteText } from './lib/quotes';
import { cn } from '@/lib/utils';
import './quote.css';

export function QuoteBoard({ rows = 6, cols = 22, byline = false, className }: { rows?: number; cols?: number; byline?: boolean; className?: string }) {
  const [quote] = useState(() => pickQuote());
  if (!byline) return <section className={cn('panel quote-board', className)} aria-label="Quote of the day"><TextFlippingBoard text={quoteText(quote)} rows={rows} cols={cols}/></section>;
  return <section className={cn('panel quote-board', className)} aria-label="Quote of the day">
    <div aria-hidden="true"><TextFlippingBoard text={quote.text} rows={rows} cols={cols}/></div>
    <p className="quote-by"><span className="sr-only">{quote.text} </span>- {quote.by}</p>
  </section>;
}
