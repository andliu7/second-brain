import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { HeatCalendar } from '../src/components/ui/heat-calendar';

// Noon local on a day N days ago, so the activity lands on that local day whatever the timezone.
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d; };
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('the heat calendar', () => {
  it('three activities on one day light that cell to the top level and every other cell stays at zero', () => {
    const day = daysAgo(3);
    const activity = [1, 2, 3].map(() => ({ created: day.toISOString() }));
    render(<HeatCalendar activity={activity}/>);
    const cells = Array.from(document.querySelectorAll('.heat-grid .heat-cell'));
    expect(cells).toHaveLength(16 * 7);
    const lit = cells.filter(cell => cell.getAttribute('data-level') !== '0');
    expect(lit).toHaveLength(1);
    expect(lit[0]).toHaveAttribute('data-level', '4');
    expect(lit[0]).toHaveAttribute('data-count', '3');
    expect(lit[0]).toHaveAttribute('title', `3 activities on ${key(day)}`);
    expect(document.querySelector('.heat-grid')).toHaveAttribute('aria-label', 'Activity over the last 16 weeks, 3 in total');
    // Today is the last day drawn; the rest of this week is there for the column but marked future.
    const drawn = cells.filter(cell => !cell.hasAttribute('data-future'));
    expect(drawn[drawn.length - 1]).toHaveAttribute('title', `0 activities on ${key(daysAgo(0))}`);
    expect(cells.length - drawn.length).toBe(6 - daysAgo(0).getDay());
    expect(document.querySelectorAll('.heat-legend .heat-cell')).toHaveLength(5);
  });

  it('scales levels to the busiest day in view', () => {
    const activity = [...Array(4)].map(() => ({ created: daysAgo(1).toISOString() })).concat([{ created: daysAgo(2).toISOString() }]);
    render(<HeatCalendar activity={activity}/>);
    const level = (title: string) => document.querySelector(`.heat-grid .heat-cell[title="${title}"]`)?.getAttribute('data-level');
    expect(level(`4 activities on ${key(daysAgo(1))}`)).toBe('4');
    expect(level(`1 activity on ${key(daysAgo(2))}`)).toBe('1');
  });
});
