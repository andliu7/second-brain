// TextReveal: one line of text uncovered by a solid block, from the TextAnimation component Andrew
// pasted from 21st.dev (2026-09-28). The block wipes across the line left to right, the text is
// there underneath it, and the block wipes off to the right. The original drives this with gsap
// and SplitText, one block per wrapped line; a title is one short line, so a CSS keyframe on one
// span does the same with no dependency (text-reveal.css holds the motion). Props:
//   text: the line
//   as: the element it renders as, h1 by default, so a page title stays its page's heading
//   blockColor: the block's fill, the accent token by default
//   delay, duration: seconds before the wipe starts, and the whole wipe (in and out), 1.2 by default
//   className: added to the outer element
// Under prefers-reduced-motion the text is shown at once and no block is drawn at all.
import { useState, type CSSProperties } from 'react';
import './text-reveal.css';

type Tag = 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TextReveal({ text, as: As = 'h1', blockColor = 'var(--acc)', delay = 0, duration = 1.2, className = '' }: { text: string; as?: Tag; blockColor?: string; delay?: number; duration?: number; className?: string }) {
  // Read once, on mount: the reveal plays once, so a later change of the setting has nothing to stop.
  const [reduced] = useState(reducedMotion);
  // The timing reaches the stylesheet as custom properties, so the keyframes stay in the .css file.
  const style = { '--reveal-color': blockColor, '--reveal-delay': `${delay}s`, '--reveal-duration': `${duration}s` } as CSSProperties;
  return <As className={`text-reveal ${reduced ? '' : 'text-reveal-animated'} ${className}`.trim()} style={style}>
    <span className="text-reveal-line">
      <span className="text-reveal-text">{text}</span>
      {!reduced && <span className="text-reveal-block" aria-hidden="true" data-testid="text-reveal-block"/>}
    </span>
  </As>;
}
