// QuoteBoard: one quote from lib/quotes.ts, picked at random on every page load, on the split-flap
// board. No props, nothing saved.
// Mount from Today.tsx with one line:
//   <QuoteBoard/>
import { useState } from 'react';
import { TextFlippingBoard } from '@/components/ui/text-flipping-board';
import { pickQuote, quoteText } from './lib/quotes';
import './quote.css';

export function QuoteBoard() {
  const [quote] = useState(() => pickQuote());
  return <section className="panel quote-board" aria-label="Quote of the day"><TextFlippingBoard text={quoteText(quote)}/></section>;
}
