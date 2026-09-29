// PageSkeleton: grey blocks in a page's rough shape, shown by PageSweep when the page it is sweeping to
// takes longer than a moment to be ready (Andrew, 2026-09-29: "a skeleton loader page. That way, it
// actually looks like it's loading the pieces that aren't fully loaded"). The band sweeps onto this, and
// the finished page fades in over it when it lands. Props:
//   shape: 'cards' (a heading and a grid of cards; the default), 'list' (a heading, a search row and
//          rows, like Skills), 'docs' (a list beside a document), 'canvas' (a toolbar over one surface)
// skeletonFor(page) picks the shape for one of App's page ids. Decorative only: aria-hidden, since the
// sweep's overlay that holds it is itself hidden from assistive tech.
import './page-skeleton.css';

export type SkeletonShape = 'cards' | 'list' | 'docs' | 'canvas';

export function skeletonFor(page: string | number): SkeletonShape {
  if (page === 'docs') return 'docs';
  if (page === 'draw' || page === 'network') return 'canvas';
  if (page === 'skills') return 'list';
  return 'cards';
}

const Block = ({ w, h }: { w?: string; h?: number }) => <span className="sk" style={{ width: w, height: h }}/>;

export function PageSkeleton({ shape = 'cards' }: { shape?: SkeletonShape }) {
  const heading = <div className="sk-heading"><Block w="28%" h={30}/><Block w="44%" h={12}/></div>;
  return <div className={`page-skeleton page-skeleton-${shape}`} aria-hidden="true" data-testid="page-skeleton">
    {shape === 'cards' && <>{heading}<div className="sk-grid">{[0, 1, 2, 3].map(i => <div key={i} className="sk-card"><Block w="40%" h={14}/><Block w="90%"/><Block w="75%"/><Block w="60%"/></div>)}</div></>}
    {shape === 'list' && <>{heading}<Block w="100%" h={38}/>{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="sk-row"><Block w="32px" h={32}/><Block w={`${40 + (i % 3) * 12}%`}/></div>)}</>}
    {shape === 'docs' && <div className="sk-docs"><div className="sk-card">{[0, 1, 2, 3, 4, 5].map(i => <Block key={i} w={`${60 + (i % 3) * 12}%`}/>)}</div><div className="sk-card"><Block w="45%" h={26}/>{[0, 1, 2, 3, 4, 5, 6].map(i => <Block key={i} w={`${70 + (i % 4) * 8}%`}/>)}</div></div>}
    {shape === 'canvas' && <><div className="sk-row"><Block w="18%" h={32}/><Block w="32px" h={32}/><Block w="32px" h={32}/></div><div className="sk-card sk-surface"/></>}
  </div>;
}
