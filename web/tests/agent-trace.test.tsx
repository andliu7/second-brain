// components/ui/agent-trace.tsx: the layout of a trace, the scrubbable playhead, reduced motion, and the
// "How this answer was made" disclosure. tests/setup.ts stubs matchMedia to match, so reduced motion is
// on unless a test stubs it off.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentTrace, MessageTrace, layoutSpans, niceTicks } from '../src/components/ui/agent-trace';
import type { AnswerTrace, TraceSpan } from '../src/types';

const span = (id: string, start: number, end: number, extra: Partial<TraceSpan> = {}): TraceSpan => ({ id, label: id, start, end, kind: 'io', status: 'ok', ...extra });
const rowOf = (label: string) => screen.getByTitle(label).closest('li')!;
const p = (label: string) => Number(rowOf(label).style.getPropertyValue('--p'));
const slider = () => screen.getByRole('slider', { name: 'Playhead' });

describe('layoutSpans', () => {
  it('puts parents before children, orders siblings by start, keeps an orphan and breaks a cycle', () => {
    const spans = [
      span('late', 50, 90, { parentId: 'root' }), span('x', 30, 40, { parentId: 'y' }), span('root', 0, 100),
      span('grand', 12, 20, { parentId: 'early' }), span('orphan', 5, 8, { parentId: 'missing' }), span('early', 10, 30, { parentId: 'root' }),
      span('y', 40, 45, { parentId: 'x' }), span('self', 60, 61, { parentId: 'self' }),
    ];
    expect(layoutSpans(spans).map(row => `${row.span.id}:${row.depth}`)).toEqual(['root:0', 'early:1', 'grand:2', 'late:1', 'orphan:0', 'self:0', 'x:0', 'y:1']);
    render(<AgentTrace spans={spans} autoPlay={false}/>);
    expect(screen.getAllByRole('listitem').map(item => item.querySelector('.at-label')!.textContent)).toEqual(['root', 'early', 'grand', 'late', 'orphan', 'self', 'x', 'y']);
  });

  it('picks round ruler ticks', () => {
    expect(niceTicks(1000)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(niceTicks(4200)).toEqual([0, 1000, 2000, 3000, 4000]);
  });
});

describe('AgentTrace playhead', () => {
  const run = [span('read', 0, 400), span('call', 400, 1000, { kind: 'model', status: 'error', attempt: 2 }), span('cache', 200, 600, { status: 'cached' })];

  it('seeks with the slider keys and updates each row fill and state', () => {
    render(<AgentTrace spans={run} runId="abcdef123456" model="fixture-model"/>);
    expect(screen.getByText('x2')).toHaveAttribute('title', 'Attempt 2');
    fireEvent.keyDown(slider(), { key: 'Home' });
    expect(slider()).toHaveAttribute('aria-valuenow', '0');
    expect(slider()).toHaveAttribute('aria-valuetext', '0ms of 1.00s');
    expect([rowOf('read').dataset.state, rowOf('call').dataset.state, rowOf('cache').dataset.state]).toEqual(['running', 'queued', 'queued']);
    expect(p('read')).toBe(0);
    expect(screen.getByText('Running')).toBeInTheDocument();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(slider(), { key: 'PageUp' });
    expect(slider()).toHaveAttribute('aria-valuenow', '500');
    expect([rowOf('read').dataset.state, rowOf('call').dataset.state, rowOf('cache').dataset.state]).toEqual(['done', 'running', 'running']);
    expect(p('read')).toBe(1);
    expect(p('call')).toBeCloseTo(100 / 600);
    expect(p('cache')).toBeCloseTo(0.75);
    fireEvent.keyDown(slider(), { key: 'ArrowLeft' });
    expect(slider()).toHaveAttribute('aria-valuenow', '490');
    fireEvent.keyDown(slider(), { key: 'End' });
    expect([rowOf('read').dataset.state, rowOf('call').dataset.state, rowOf('cache').dataset.state]).toEqual(['done', 'error', 'done']);
    // The status word each row gives a screen reader follows the playhead too.
    expect(rowOf('call').querySelectorAll('.sr-only')[1].textContent).toBe('failed');
    expect(rowOf('cache').querySelectorAll('.sr-only')[1].textContent).toBe('cached');
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('under reduced motion shows the finished run and never starts the animation loop', () => {
    const frame = vi.fn(() => 1); vi.stubGlobal('requestAnimationFrame', frame);
    render(<AgentTrace spans={run}/>);
    expect(frame).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /play|pause/i })).toBeNull();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(slider()).toHaveAttribute('aria-valuenow', '1000');
    expect(p('read') + p('call') + p('cache')).toBe(3);
  });

  it('with motion allowed, autoplay starts at zero and drops aria-valuetext until paused', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    const frame = vi.fn(() => 1); vi.stubGlobal('requestAnimationFrame', frame); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    render(<AgentTrace spans={run}/>);
    expect(frame).toHaveBeenCalled();
    expect(rowOf('call').dataset.state).toBe('queued');
    expect(slider()).not.toHaveAttribute('aria-valuetext');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(slider()).toHaveAttribute('aria-valuetext', '0ms of 1.00s');
  });
});

describe('MessageTrace', () => {
  const trace: AnswerTrace = { runId: 'r-1', model: 'fixture-model', duration: 420, spans: [
    { id: 'run', label: 'Answer', kind: 'agent', status: 'ok', start: 0, end: 420 },
    { id: 's1', label: 'plan.md', kind: 'io', status: 'ok', start: 0, end: 2, parentId: 'run', detail: 'note, 11 chars' },
    { id: 's2', label: 'fixture-model', kind: 'model', status: 'ok', start: 2, end: 415, parentId: 'run', tokens: 57, tokensIn: 812, attempt: 1 },
  ] };

  it('renders collapsed, then expands to the finished trace', () => {
    render(<MessageTrace trace={trace}/>);
    const toggle = screen.getByRole('button', { name: /How this answer was made/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'How this answer was made' })).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('fixture-model', { selector: '.at-meta span' })).toBeInTheDocument();
    expect(rowOf('fixture-model').querySelector('.at-tokens')!.textContent).toBe('812 in, 57 out');
  });

  it('renders nothing for an answer saved without a trace', () => {
    const { container } = render(<MessageTrace/>);
    expect(container).toBeEmptyDOMElement();
  });
});
