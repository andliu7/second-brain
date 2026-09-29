import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { initialWorkspace, saveWorkspace } from '../src/lib/storage';
import { pipelineExamples } from '../src/lib/pipeline-examples';

// andliu.ai as rebuilt on 2026-09-28: a panel from the top bar's right side over whatever page is open,
// Chat and Generate as tabs, Full screen at #chat that never scrolls the page, the model picked inside the
// message box, and provider errors said plainly with a one-click switch. Every /api call is a fixture.
const calls: { path: string; body: any }[] = [];
let chatReply: (body: any) => { status: number; json: object } = () => ({ status: 200, json: { text: 'TEST FIXTURE: answer' } });
let providers: Record<string, boolean> = { claude: true, openai: true, gemini: false };
beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  providers = { claude: true, openai: true, gemini: false };
  chatReply = () => ({ status: 200, json: { text: 'TEST FIXTURE: answer' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const path = String(url); const body = options?.body ? JSON.parse(String(options.body)) : undefined; calls.push({ path, body });
    if (path.endsWith('/chat')) { const { status, json } = chatReply(body); return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }); }
    // No models from the server, so the client's own default is what the menu shows.
    const reply = path.endsWith('/status') ? { local: true, authRequired: false, providers, models: {} }
      : path.includes('/projects') ? { repos: [], courses: [], blueberry: null } : path.includes('/tasks') ? { tasks: [] } : path.includes('/skills') ? { skills: [] }
      : path.includes('/brain') ? { status: 'none' } : { sources: [] };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

async function onBoard() {
  window.location.hash = 'board';
  render(<App/>);
  await screen.findByRole('heading', { level: 1, name: 'Board' });
  return userEvent.setup();
}
const panel = () => screen.getByRole('dialog', { name: 'andliu.ai' });

describe('andliu.ai from the top right', () => {
  it('opens as a panel over the current page from the top-bar button or Ctrl J, without changing the address, and Escape closes it', async () => {
    const user = await onBoard();
    const button = within(document.querySelector<HTMLElement>('header.topbar')!).getByRole('button', { name: 'Ask andliu.ai' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+J');
    // It sits on the right, then the profile avatar (2026-09-28), then the focus timer and the theme button.
    expect(button.nextElementSibling).toHaveClass('pf');
    expect(button.nextElementSibling?.nextElementSibling).toHaveClass('focus-timer');
    await user.click(button);
    expect(panel()).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(location.hash).toBe('#board');
    expect(screen.getByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument(); // the page is still there under it
    expect(within(panel()).getByLabelText('Message')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'andliu.ai' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    // Ctrl J opens and closes it from the page, but not while typing in a field.
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true });
    expect(panel()).toBeInTheDocument();
    expect(location.hash).toBe('#board');
    fireEvent.keyDown(within(panel()).getByLabelText('Message'), { key: 'j', ctrlKey: true });
    expect(panel()).toBeInTheDocument();
    await user.click(within(panel()).getByRole('button', { name: 'Close andliu.ai' }));
    expect(screen.queryByRole('dialog', { name: 'andliu.ai' })).not.toBeInTheDocument();
  });

  it('switches between the Chat and Generate tabs inside the panel', async () => {
    const user = await onBoard();
    await user.click(screen.getByRole('button', { name: 'Ask andliu.ai' }));
    const tabs = () => within(panel()).getByRole('group', { name: 'Chat mode' });
    await user.click(within(tabs()).getByRole('button', { name: 'Generate' }));
    expect(within(tabs()).getByRole('button', { name: 'Generate' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel()).getByRole('heading', { level: 2, name: 'Generate' })).toBeInTheDocument();
    expect(within(panel()).getByLabelText('What do you imagine?')).toBeInTheDocument();
    expect(within(panel()).queryByLabelText('Message')).not.toBeInTheDocument();
    expect(within(panel()).getByLabelText('What do you imagine?')).toHaveFocus();
    await user.click(within(tabs()).getByRole('button', { name: 'Chat' }));
    expect(within(panel()).getByLabelText('Message')).toBeInTheDocument();
    expect(location.hash).toBe('#board');
  });

  it('goes full screen at #chat, where only the message list scrolls and the composer sits below it', async () => {
    const user = await onBoard();
    await user.click(screen.getByRole('button', { name: 'Ask andliu.ai' }));
    await user.click(within(panel()).getByRole('button', { name: 'Full screen' }));
    expect(location.hash).toBe('#chat');
    expect(screen.queryByRole('dialog', { name: 'andliu.ai' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'andliu.ai' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask andliu.ai' })).not.toBeInTheDocument(); // already here
    expect(document.querySelector('.app-shell')).toHaveClass('app-chat');
    expect(screen.getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument();
    // One scroll region in the conversation column, and it is the message list; the composer is outside it.
    const main = screen.getByRole('region', { name: 'Conversation' });
    const scrollers = main.querySelectorAll('.ai-scroll');
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]).toBe(within(main).getByRole('log', { name: 'Messages' }));
    expect(scrollers[0]).not.toContainElement(screen.getByLabelText('Message'));
    expect(main.lastElementChild).toContainElement(screen.getByLabelText('Message'));
    // jsdom does not lay out, so the CSS that makes this true is checked where it is written: the shell is locked
    // to the viewport, and the only rules that scroll are the message list and the conversation rail's list.
    const css = readFileSync('src/chat.css', 'utf8');
    expect(css).toMatch(/\.app-chat \.main-shell\{height:100dvh;overflow:hidden\}/);
    expect(css).toMatch(/\.ai-scroll\{flex:1;min-height:0;overflow-y:auto/);
    expect([...css.matchAll(/([^{}\n]+)\{[^}]*overflow(?:-y)?:auto/g)].map(m => m[1].trim())).toEqual(['.ai-scroll', '.ai-rail-list']);
    // The nav row goes to the same page.
    expect(within(screen.getByRole('complementary', { name: 'Workspace navigation' })).getByRole('button', { name: /^andliu\.ai/ })).toHaveAttribute('aria-current', 'page');
  });

  it('shows Jump to latest once the reader scrolls up, and it goes back to the bottom', async () => {
    window.location.hash = 'chat';
    render(<App/>);
    const log = await screen.findByRole('log', { name: 'Messages' });
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 500 });
    log.scrollTop = 200; fireEvent.scroll(log);
    const jump = await screen.findByRole('button', { name: 'Jump to latest' });
    await userEvent.setup().click(jump);
    expect(log.scrollTop).toBe(2000);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).not.toBeInTheDocument();
  });

  it('puts the model picker inside the message box, defaulting to Claude Opus 5.5, with every provider in one menu', async () => {
    const user = await onBoard();
    await user.click(screen.getByRole('button', { name: 'Ask andliu.ai' }));
    const box = within(panel()).getByLabelText('Message').closest('.cci-card-shell') as HTMLElement;
    const picker = within(box).getByRole('button', { name: /^Chat model/ });
    expect(picker).toHaveTextContent(/^Claude Opus 5\.5$/);
    expect(within(box).getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Add context' })).toBeInTheDocument();
    await user.click(picker);
    const menu = screen.getByRole('listbox', { name: 'Models' });
    expect(within(menu).getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Claude', 'OpenAI', 'Gemini']);
    expect(within(within(menu).getByRole('group', { name: 'Claude' })).getAllByRole('option').map(o => o.querySelector('.cci-model-name')!.textContent))
      .toEqual(['Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Fable 5.1', 'Claude Opus 5', 'Claude Sonnet 5', 'Claude Haiku 4.5']);
    await user.click(within(within(menu).getByRole('option', { name: /Claude Sonnet 5\.5/ })).getByRole('button'));
    await user.type(within(panel()).getByLabelText('Message'), 'Hello');
    await user.click(within(panel()).getByRole('button', { name: 'Send message' }));
    await within(panel()).findByText('TEST FIXTURE: answer');
    expect(calls.find(c => c.path.endsWith('/chat'))!.body).toMatchObject({ provider: 'claude', model: 'claude-sonnet-5-5' });
  });

  it('uses the /prompt-demo box in the panel and full screen, with the model and effort pickers inside it', async () => {
    const user = await onBoard();
    await user.click(screen.getByRole('button', { name: 'Ask andliu.ai' }));
    const inBox = (scope: HTMLElement) => {
      const box = within(scope).getByLabelText('Message').closest('.cci-card-shell') as HTMLElement;
      expect(within(box).getByRole('button', { name: /^Chat model/ })).toBeInTheDocument();
      expect(within(box).getByRole('button', { name: /^Reasoning effort: Default/ })).toBeInTheDocument();
      expect(within(box).getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    };
    inBox(panel());
    await user.click(within(panel()).getByRole('button', { name: 'Full screen' }));
    inBox(await screen.findByRole('region', { name: 'Conversation' }));
  });

  it('sends the chosen effort to Claude and none on Default', async () => {
    const user = await onBoard();
    await user.click(screen.getByRole('button', { name: 'Ask andliu.ai' }));
    const effortButton = () => within(panel()).getByRole('button', { name: /^Reasoning effort/ });
    const lastChat = () => calls.filter(c => c.path.endsWith('/chat')).at(-1)!.body;
    await user.type(within(panel()).getByLabelText('Message'), 'Hi');
    await user.click(within(panel()).getByRole('button', { name: 'Send message' }));
    await within(panel()).findByText('TEST FIXTURE: answer');
    expect(lastChat()).not.toHaveProperty('effort');
    await user.click(effortButton()); await user.click(effortButton()); await user.click(effortButton()); // from Default to Low, Medium, High
    expect(effortButton()).toHaveTextContent('High');
    await user.type(within(panel()).getByLabelText('Message'), 'Hi');
    await user.click(within(panel()).getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(calls.filter(c => c.path.endsWith('/chat'))).toHaveLength(2));
    expect(lastChat()).toMatchObject({ provider: 'claude', effort: 'high' });
  });

  it('hides the effort button for Haiku 4.5 and the other providers, which have no effort setting here, and sends none', async () => {
    const user = await onBoard();
    await user.click(screen.getByRole('button', { name: 'Ask andliu.ai' }));
    const effortButton = () => within(panel()).queryByRole('button', { name: /^Reasoning effort/ });
    await user.click(effortButton()!); // Low, chosen on Claude first, must not leak into the others' requests
    await user.click(within(panel()).getByRole('button', { name: /^Chat model/ }));
    await user.click(within(screen.getByRole('option', { name: /Claude Haiku 4\.5/ })).getByRole('button'));
    expect(effortButton()).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole('button', { name: /^Chat model/ }));
    await user.click(within(screen.getByRole('option', { name: /GPT-5\.4/ })).getByRole('button'));
    expect(effortButton()).not.toBeInTheDocument();
    await user.type(within(panel()).getByLabelText('Message'), 'Hi');
    await user.click(within(panel()).getByRole('button', { name: 'Send message' }));
    await within(panel()).findByText('TEST FIXTURE: answer');
    expect(calls.find(c => c.path.endsWith('/chat'))!.body).toMatchObject({ provider: 'openai' });
    expect(calls.find(c => c.path.endsWith('/chat'))!.body).not.toHaveProperty('effort');
  });

  it('sends the project pipelines on the board as one context note, and nothing when no project has Pipeline view on', async () => {
    const pipelineNote = () => calls.filter(c => c.path.endsWith('/chat')).at(-1)!.body.context.find((item: { name: string }) => item.name === 'Project pipelines');
    const ask = async () => {
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Ask andliu.ai' }));
      await user.click(within(panel()).getByRole('checkbox', { name: /Brain/ })); // no brain lookup, so the context is only what is tested
      await user.type(within(panel()).getByLabelText('Message'), 'Where is it up to?');
      await user.click(within(panel()).getByRole('button', { name: 'Send message' }));
      await within(panel()).findByText('TEST FIXTURE: answer');
    };
    const w = initialWorkspace(); w.board = { ...w.board!, cards: pipelineExamples(new Date('2026-09-28T12:00:00')) };
    await saveWorkspace(w);
    window.location.hash = 'board';
    const view = render(<App/>);
    await ask();
    expect(pipelineNote()).toMatchObject({ kind: 'note', content: expect.stringContaining('Project pipelines (from the Board') });
    expect(pipelineNote().content).toContain('Blueberry unit 3: carbonyl chemistry');
    view.unmount(); calls.length = 0;
    await saveWorkspace({ ...w, board: { ...w.board!, cards: [] }, conversations: [] });
    render(<App/>);
    await ask();
    expect(pipelineNote()).toBeUndefined();
  });

  it('says a 400 credit error plainly in the conversation, retries nothing, and Switch to OpenAI works in one click', async () => {
    chatReply = body => body.provider === 'claude'
      ? { status: 400, json: { error: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }
      : { status: 200, json: { text: 'TEST FIXTURE: an OpenAI answer' } };
    const user = await onBoard();
    await user.click(screen.getByRole('button', { name: 'Ask andliu.ai' }));
    await user.type(within(panel()).getByLabelText('Message'), 'Summarise this board');
    await user.click(within(panel()).getByRole('button', { name: 'Send message' }));
    const notice = await within(panel()).findByRole('alert');
    expect(within(within(panel()).getByRole('log')).getByRole('alert')).toBe(notice); // in the conversation, not a banner
    expect(notice).toHaveTextContent('Claude could not answer this one');
    expect(notice).toHaveTextContent('Your credit balance is too low to access the Anthropic API.');
    expect(notice).toHaveTextContent('Your message is saved, and nothing was retried.');
    expect(within(notice).queryByRole('button', { name: 'Switch to Gemini' })).not.toBeInTheDocument(); // no Gemini key
    expect(calls.filter(c => c.path.endsWith('/chat'))).toHaveLength(1);
    await user.click(within(notice).getByRole('button', { name: 'Switch to OpenAI' }));
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: /^Chat model/ })).toHaveTextContent('GPT-5.4');
    expect(calls.filter(c => c.path.endsWith('/chat'))).toHaveLength(1); // switching sends nothing by itself
    await user.type(within(panel()).getByLabelText('Message'), 'Summarise this board');
    await user.click(within(panel()).getByRole('button', { name: 'Send message' }));
    await within(panel()).findByText('TEST FIXTURE: an OpenAI answer');
    expect(calls.filter(c => c.path.endsWith('/chat')).at(-1)!.body).toMatchObject({ provider: 'openai', model: 'gpt-5.4' });
  });

  it('keeps a reply\'s trace on the message and shows it collapsed under the answer', async () => {
    const trace = { runId: 'run-fixture', model: 'claude-opus-5-5', duration: 1200, spans: [{ id: 'root', label: 'Answer', start: 0, end: 1200, kind: 'agent', status: 'ok' }, { id: 'm', label: 'claude-opus-5-5', start: 100, end: 1100, kind: 'model', status: 'ok', parentId: 'root' }] };
    chatReply = () => ({ status: 200, json: { text: 'TEST FIXTURE: traced answer', trace } });
    const user = await onBoard();
    await user.click(screen.getByRole('button', { name: 'Ask andliu.ai' }));
    await user.type(within(panel()).getByLabelText('Message'), 'How was this made?');
    await user.click(within(panel()).getByRole('button', { name: 'Send message' }));
    await within(panel()).findByText('TEST FIXTURE: traced answer');
    const toggle = within(panel()).getByRole('button', { name: /How this answer was made/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await waitFor(async () => {
      const { loadWorkspace } = await import('../src/lib/storage');
      expect((await loadWorkspace()).conversations[0].messages[1].trace?.runId).toBe('run-fixture');
    });
  });
});
