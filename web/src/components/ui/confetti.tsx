// Confetti: a one-shot burst of coloured pieces, CSS animated, drawn when every todo is done.
// Renders nothing at all under prefers-reduced-motion, so the check is here, not in the caller.
// Props:
//   colors: the fills to cycle through (the category palette, so these stay the only saturated colours)
//   pieces: how many, 28 by default
import type { CSSProperties } from 'react';
import { prefersReducedMotion } from '../../lib/reduced-motion';

export function Confetti({ colors, pieces = 28 }: { colors: string[]; pieces?: number }) {
  if (prefersReducedMotion() || !colors.length) return null;
  return <div className="confetti" aria-hidden="true">
    {Array.from({ length: pieces }, (_, i) => {
      // Spread evenly around the centre with a little jitter, so the burst reads as a burst and not a column.
      const angle = (i / pieces) * 360 + ((i * 37) % 23) - 11;
      const style = { '--angle': angle + 'deg', '--dist': 70 + ((i * 53) % 60) + 'px', '--spin': ((i * 97) % 720) - 360 + 'deg', '--delay': (i % 5) * 30 + 'ms', background: colors[i % colors.length] } as CSSProperties;
      return <span key={i} className="confetti-piece" style={style}/>;
    })}
  </div>;
}
