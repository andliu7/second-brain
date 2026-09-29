import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Compose, detectTrigger, segment } from '../src/components/ui/compose';

const mentions = [{ id: 'doc-1', label: 'Research decision', sublabel: 'note' }, { id: 'installed:brain', label: 'brain', sublabel: 'installed skill' }];
const commands = [{ id: 'calibrate', label: 'calibrate', hint: 'Run a calibration roundtable.' }, { id: 'clean-up', label: 'clean-up', hint: 'Kill stray processes.' }];

describe('the chat composer', () => {
  it('finds the @ or / word at the caret only when it starts a word, and highlights known tokens', () => {
    expect(detectTrigger('hello @bra', 10)).toEqual({ type: '@', start: 6, query: 'bra' });
    expect(detectTrigger('/cal', 4)).toEqual({ type: '/', start: 0, query: 'cal' });
    expect(detectTrigger('mail@example', 12)).toBeNull();
    expect(detectTrigger('a/b', 3)).toBeNull();
    expect(detectTrigger('@brain done', 11)).toBeNull();
    expect(segment('ask @brain then /calibrate it', ['@brain'], ['/calibrate']).map(s => s.kind)).toEqual(['text', 'mention', 'text', 'command', 'text']);
    expect(segment('plain', [], [])).toEqual([{ text: 'plain', kind: 'text' }]);
  });

  it('offers mentions on @ and inserts the chosen one, telling the caller', async () => {
    const user = userEvent.setup(); const onMention = vi.fn(); const onChange = vi.fn();
    render(<Compose mentions={mentions} commands={commands} onMention={onMention} onChange={onChange}/>);
    const box = screen.getByRole('combobox', { name: 'Message' });
    await user.type(box, 'see @res');
    const list = screen.getByRole('listbox', { name: 'Files and skills to attach' });
    expect(list).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Research decision/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('option', { name: /^brain/ })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onMention).toHaveBeenCalledWith(mentions[0]);
    expect(box).toHaveValue('see @Research decision ');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('offers skills on / with arrow keys, Escape closes, and Ctrl+Enter or the button sends', async () => {
    const user = userEvent.setup(); const onCommand = vi.fn(); const onSubmit = vi.fn();
    render(<Compose mentions={mentions} commands={commands} onCommand={onCommand} onSubmit={onSubmit} submitLabel="Send message"/>);
    const box = screen.getByRole('combobox', { name: 'Message' });
    await user.type(box, '/c');
    expect(screen.getByRole('listbox', { name: 'Skills to call' })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /clean-up/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await user.keyboard('a');
    await user.keyboard('{Enter}');
    expect(onCommand).toHaveBeenCalledWith(commands[0]);
    expect(box).toHaveValue('/calibrate ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledWith('/calibrate ');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('cannot send when empty, over the limit, or when the caller says the provider is not ready', async () => {
    const user = userEvent.setup(); const onSubmit = vi.fn();
    const { rerender } = render(<Compose onSubmit={onSubmit} maxLength={5} submitLabel="Send message"/>);
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeDisabled();
    await user.type(screen.getByRole('combobox', { name: 'Message' }), 'hello');
    expect(send).toBeEnabled();
    rerender(<Compose onSubmit={onSubmit} maxLength={5} submitLabel="Send message" submitDisabled/>);
    expect(send).toBeDisabled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
