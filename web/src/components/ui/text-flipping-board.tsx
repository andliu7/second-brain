// TextFlippingBoard: a split-flap departures board. Props:
//   text: what to show; wrapped by words into the grid, "\n" forces a new row, and it is uppercased
//   rows, cols: the grid, 6 by 22 by default
//   className: extra classes on the board
// Each cell flips through the character set until it lands on its letter, starting a little later
// for each column and row so the board ripples in. Under prefers-reduced-motion every cell shows
// its final letter at once. The board is one image to a screen reader, named by the text.
import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { prefersReducedMotion } from '../../lib/reduced-motion';

const CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?\'"-:;%&';
const TICK_MS = 45;

// Word wrap to `cols` characters; a word longer than the row is split. Returns the rows, at most
// `rows` of them when a limit is given (the rest is dropped, the board has no more room).
export function wrapText(text: string, cols: number, rows?: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > cols) { if (line) { lines.push(line); line = ''; } lines.push(rest.slice(0, cols)); rest = rest.slice(cols); }
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= cols) line += ' ' + rest;
      else { lines.push(line); line = rest; }
    }
    lines.push(line);
  }
  return rows === undefined ? lines : lines.slice(0, rows);
}

export function TextFlippingBoard({ text, rows = 6, cols = 22, className }: { text: string; rows?: number; cols?: number; className?: string }) {
  const targets = wrapText(text.toUpperCase(), cols, rows).map(line => line.padEnd(cols, ' '));
  while (targets.length < rows) targets.push(' '.repeat(cols));
  // One counter drives every cell: cell (r, c) starts at tick r * 2 + c and steps one character per
  // tick until it reaches its own, so the whole board is a single interval and a single state value.
  const startOf = (r: number, c: number) => r * 2 + c;
  const stepsOf = (char: string) => { const i = CHARSET.indexOf(char); return i < 0 ? 0 : i; };
  const lastTick = Math.max(...targets.flatMap((line, r) => [...line].map((ch, c) => startOf(r, c) + stepsOf(ch))));
  const [tick, setTick] = useState(() => prefersReducedMotion() ? Infinity : 0);
  useEffect(() => {
    if (prefersReducedMotion()) { setTick(Infinity); return; }
    setTick(0);
    const timer = setInterval(() => setTick(t => { if (t + 1 >= lastTick) clearInterval(timer); return t + 1; }), TICK_MS);
    return () => clearInterval(timer);
  }, [text, lastTick]);
  const shown = (r: number, c: number, target: string) => { const k = tick - startOf(r, c); if (k < 0) return ' '; const i = CHARSET.indexOf(target); return i < 0 || k >= i ? target : CHARSET[k]; };
  return <div className={cn('flap-board', className)} role="img" aria-label={text.replace(/\n/g, ' ')} style={{ '--cols': cols } as CSSProperties}>
    {targets.map((line, r) => <div key={r} className="flap-row" aria-hidden="true">
      {[...line].map((target, c) => { const char = shown(r, c, target); return <span key={c} className="flap-cell" data-blank={char === ' ' || undefined}>
        <motion.span key={char} className="flap-face" initial={tick === Infinity ? false : { rotateX: -90 }} animate={{ rotateX: 0 }} transition={{ duration: 0.09, ease: 'easeOut' }}>{char}</motion.span>
      </span>; })}
    </div>)}
  </div>;
}
