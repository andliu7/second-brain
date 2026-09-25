// HeatCalendar: a GitHub-style activity map, one cell per day, ending today. Props:
//   activity: anything with a created ISO timestamp (Workspace.activity fits as is)
//   weeks: how many columns, default 16
// A cell's level is 0 for no activity, else 1 to 4 relative to the busiest day in view, so the
// scale always uses its full range. The tooltip is the cell's title attribute. Days are local days.
// Columns are whole weeks, so the last column holds today and, drawn empty, the rest of this week.
import { useMemo } from 'react';
import './heat-calendar.css';

const DAY = 24 * 60 * 60 * 1000;
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function HeatCalendar({ activity, weeks = 16 }: { activity: { created: string }[]; weeks?: number }) {
  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of activity) { const k = key(new Date(entry.created)); counts.set(k, (counts.get(k) || 0) + 1); }
    // Whole weeks, Sunday first, with today in the last column; the days after today are drawn empty.
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const start = new Date(today.getTime() - (weeks - 1) * 7 * DAY);
    start.setDate(start.getDate() - start.getDay());
    const list: { key: string; count: number; future: boolean }[] = [];
    for (let d = new Date(start); list.length < weeks * 7; d = new Date(d.getTime() + DAY)) list.push({ key: key(d), count: counts.get(key(d)) || 0, future: d > today });
    const max = Math.max(1, ...list.map(day => day.count));
    return list.map(day => ({ ...day, level: day.count === 0 ? 0 : Math.ceil((day.count / max) * 4) }));
  }, [activity, weeks]);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  return <div className="heat">
    <div className="heat-grid" role="img" aria-label={`Activity over the last ${weeks} weeks, ${total} in total`} style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
      {days.map(day => <div key={day.key} className="heat-cell" data-level={day.level} data-count={day.count} data-future={day.future || undefined} title={`${day.count} ${day.count === 1 ? 'activity' : 'activities'} on ${day.key}`}/>)}
    </div>
    <div className="heat-legend" aria-hidden="true">Less {[0, 1, 2, 3, 4].map(level => <span key={level} className="heat-cell" data-level={level}/>)} More</div>
  </div>;
}
