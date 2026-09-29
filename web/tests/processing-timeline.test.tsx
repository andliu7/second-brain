import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcessingTimeline, jobStatus, overallProgress, type StageStatus, type TimelineStage } from '../src/components/ui/processing-timeline';

// components/ui/processing-timeline.tsx on its own: what it draws for each status, when it draws a bar,
// its disclosures, the current stage, the live region and reduced motion.
const LABELS: Record<StageStatus, string> = { pending: 'Pending', queued: 'Queued', active: 'Running', paused: 'Paused', completed: 'Completed', warning: 'Completed with warning', failed: 'Failed', skipped: 'Skipped', cancelled: 'Cancelled' };
const stage = (id: string, status: StageStatus, extra: Partial<TimelineStage> = {}): TimelineStage => ({ id, title: id, status, ...extra });
const item = (title: string) => screen.getByText(title, { selector: 'strong' }).closest('li') as HTMLElement;

describe('ProcessingTimeline', () => {
  it('shows every status as an icon and a word, never colour alone', () => {
    const all = (Object.keys(LABELS) as StageStatus[]).map(status => stage(status, status));
    render(<ProcessingTimeline title="Job" stages={all}/>);
    for (const status of Object.keys(LABELS) as StageStatus[]) {
      const badge = item(status).querySelector('.pt-status') as HTMLElement;
      expect(badge).toHaveTextContent(LABELS[status]);
      expect(badge.querySelector('svg')).not.toBeNull();
    }
  });

  it('draws a stage progressbar only for a running or paused stage whose owner gave a number', () => {
    render(<ProcessingTimeline title="Job" stages={[
      stage('Draft', 'active', { progress: 40 }), stage('Guess', 'active'), stage('Hold', 'paused', { progress: 10 }),
      stage('Done', 'completed', { progress: 100 }), stage('Later', 'pending', { progress: 50 }), stage('Broke', 'failed', { progress: 30 }),
    ]}/>);
    const bars = screen.getAllByRole('progressbar').map(bar => bar.getAttribute('aria-label'));
    expect(bars).toEqual(['Overall progress', 'Draft progress', 'Hold progress']);
    expect(screen.getByRole('progressbar', { name: 'Draft progress' })).toHaveAttribute('aria-valuenow', '40');
    // Overall: one finished stage whole, plus 0.4 and 0.1 of the two with numbers, over six stages.
    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toHaveAttribute('aria-valuenow', String(Math.round(1.5 / 6 * 100)));
    expect(screen.getByText('1 of 6 stages')).toBeInTheDocument();
  });

  it('derives the job status for the header pill', () => {
    expect(jobStatus([stage('a', 'completed'), stage('b', 'failed')])).toBe('failed');
    expect(jobStatus([stage('a', 'completed'), stage('b', 'active')])).toBe('running');
    expect(jobStatus([stage('a', 'completed'), stage('b', 'skipped')])).toBe('completed');
    expect(jobStatus([stage('a', 'completed'), stage('b', 'warning')])).toBe('warning');
    expect(jobStatus([stage('a', 'pending')])).toBe('pending');
    expect(jobStatus([stage('a', 'completed'), stage('b', 'cancelled')])).toBe('cancelled');
    expect(overallProgress([])).toBe(0);
    render(<ProcessingTimeline title="Unit 3" subtitle="Curriculum" stages={[stage('a', 'completed'), stage('b', 'failed')]}/>);
    expect(screen.getByRole('heading', { name: 'Unit 3' })).toBeInTheDocument();
    expect(screen.getByText('Curriculum')).toBeInTheDocument();
    expect(screen.getByRole('banner').querySelector('.pt-status')).toHaveTextContent('Failed');
  });

  it('opens and closes a stage as a disclosure, with its details inside', async () => {
    const user = userEvent.setup();
    render(<ProcessingTimeline title="Job" stages={[stage('Draft', 'failed', { description: 'Sixty questions', error: 'Source 3 is paywalled', warning: 'Slow', output: '12 files', logs: ['one', 'two'], attempt: 2, metadata: { Model: 'opus' } })]}/>);
    const toggle = screen.getByRole('button', { name: /Draft/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Sixty questions')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    for (const text of ['Sixty questions', 'Source 3 is paywalled', 'Slow', '12 files', 'opus']) expect(within(panel).getByText(text, { exact: false })).toBeInTheDocument();
    expect(within(panel).getByText('Attempt').nextSibling).toHaveTextContent('2');
    expect(within(panel).getByRole('heading', { name: 'Log 2' })).toBeInTheDocument();
    expect(panel.querySelector('.pt-logs')).toHaveTextContent('one two');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the current stage with aria-current="step" and a visible label, and only that one', () => {
    render(<ProcessingTimeline title="Job" stages={[stage('Outline', 'completed'), stage('Draft', 'active'), stage('Review', 'pending')]}/>);
    expect(item('Draft')).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByText('Current stage')).toHaveLength(1);
    expect(within(item('Draft')).getByText('Current stage')).toBeInTheDocument();
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('announces a stage changing status, and not the first render or a progress tick', () => {
    const { rerender } = render(<ProcessingTimeline title="Job" stages={[stage('Draft', 'active', { progress: 10 }), stage('Review', 'pending')]}/>);
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toBeEmptyDOMElement();
    rerender(<ProcessingTimeline title="Job" stages={[stage('Draft', 'active', { progress: 60 }), stage('Review', 'pending')]}/>);
    expect(live).toBeEmptyDOMElement();
    rerender(<ProcessingTimeline title="Job" stages={[stage('Draft', 'completed'), stage('Review', 'active')]}/>);
    expect(live).toHaveTextContent('Draft: Completed. Review: Running');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('under reduced motion renders bars at their final width; with motion allowed they start from empty', () => {
    const { unmount } = render(<ProcessingTimeline title="Job" stages={[stage('Draft', 'active', { progress: 40 })]}/>);
    expect((screen.getByRole('progressbar', { name: 'Draft progress' }).firstChild as HTMLElement).style.width).toBe('40%');
    unmount();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<ProcessingTimeline title="Job" stages={[stage('Draft', 'active', { progress: 40 })]}/>);
    expect((screen.getByRole('progressbar', { name: 'Draft progress' }).firstChild as HTMLElement).style.width).not.toBe('40%');
  });

  it('offers Retry on a failed stage, Skip on a skippable unfinished one, Cancel while running and Restart once ended', async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const props = { onRetry: (id: string) => calls.push('retry ' + id), onSkip: (id: string) => calls.push('skip ' + id), onCancel: () => calls.push('cancel'), onRestart: () => calls.push('restart') };
    const { rerender } = render(<ProcessingTimeline title="Job" {...props} stages={[stage('Build', 'failed'), stage('Art', 'pending', { skippable: true }), stage('Ship', 'pending')]}/>);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restart' }));
    await user.click(screen.getByRole('button', { name: /Build/ }));
    await user.click(screen.getByRole('button', { name: 'Retry Build' }));
    await user.click(screen.getByRole('button', { name: /^Art/ }));
    await user.click(screen.getByRole('button', { name: 'Skip Art' }));
    await user.click(screen.getByRole('button', { name: /^Ship/ }));
    expect(screen.queryByRole('button', { name: 'Skip Ship' })).not.toBeInTheDocument();
    rerender(<ProcessingTimeline title="Job" {...props} stages={[stage('Build', 'active'), stage('Art', 'pending', { skippable: true }), stage('Ship', 'pending')]}/>);
    expect(screen.queryByRole('button', { name: 'Retry Build' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls).toEqual(['restart', 'retry Build', 'skip Art', 'cancel']);
  });

  it('lays the stages out in a row with one detail panel, the current stage shown first', async () => {
    const user = userEvent.setup();
    render(<ProcessingTimeline title="Job" layout="horizontal" stages={[stage('Scan', 'completed', { output: '214 processes' }), stage('Clear', 'failed', { error: 'Locked file' })]}/>);
    expect(screen.getByRole('region', { name: 'Details for Clear' })).toHaveTextContent('Locked file');
    expect(screen.getByRole('button', { name: /Current stage Clear/ })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: /Scan/ }));
    expect(screen.getByRole('region', { name: 'Details for Scan' })).toHaveTextContent('214 processes');
    expect(screen.getByRole('button', { name: /Scan/ })).toHaveAttribute('aria-expanded', 'true');
  });
});
