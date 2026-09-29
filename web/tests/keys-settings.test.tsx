// Settings' Keys and Brain sections with fetch stubbed: the dots carry words, Save clears the field and shows only
// the last four, a tailnet visit is read-only, and the brain numbers render from a fixture. Keys are made up.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrainSection, KeysSection, REPORT_URL, type BrainSummaryData, type KeyState } from '@/KeysSettings';

const FAKE_KEY = 'sk-test-' + 'x'.repeat(30) + 'WXYZ';
const none = (provider: string): KeyState => ({ provider, set: false, last4: null, source: null, status: 'none', checkedAt: null, message: 'Not set' });
const list = (overrides: Partial<Record<string, Partial<KeyState>>> = {}) => ['claude', 'openai', 'gemini', 'fal', 'kie', 'usda'].map(p => ({ ...none(p), ...overrides[p] }));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => handler(url, init));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('Keys section', () => {
  it('shows a coloured dot with a word for every state, and a Get a key link that opens a new tab', async () => {
    stubFetch(() => json({ readOnly: false, keys: list({
      claude: { set: true, last4: 'ABCD', source: 'store', status: 'green', checkedAt: '2026-09-29T12:00:00.000Z', message: 'Key works' },
      openai: { set: true, last4: 'EFGH', source: 'env', status: 'yellow', message: 'From .env, not verified' },
      gemini: { set: true, last4: 'IJKL', source: 'store', status: 'red', checkedAt: '2026-09-29T12:00:00.000Z', message: 'Rejected: the provider says this key is not valid (HTTP 400)' },
    }) }));
    render(<KeysSection/>);
    await screen.findByText('Claude (Anthropic)');
    const expectations: [string, string, string][] = [['Claude (Anthropic)', 'Verified', 'key-green'], ['OpenAI', 'Not verified', 'key-yellow'], ['Google Gemini', 'Rejected', 'key-red'], ['fal', 'Not set', 'key-none']];
    for (const [name, word, colour] of expectations) {
      const status = within(row(name)).getByText(word);
      expect(status).toHaveClass('key-status', colour);
      expect(status.querySelector('.key-dot')).not.toBeNull();
    }
    expect(within(row('Claude (Anthropic)')).getByText('•••• ABCD')).toBeInTheDocument();
    expect(within(row('OpenAI')).getByText('from .env')).toBeInTheDocument();
    expect(within(row('OpenAI')).getByRole('button', { name: /Remove/ })).toBeDisabled();
    const link = within(row('Claude (Anthropic)')).getByRole('link', { name: /Get a key/ });
    expect(link).toHaveAttribute('href', 'https://console.anthropic.com/settings/keys');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(within(row('USDA FoodData Central')).getByRole('link', { name: /Get a key/ })).toHaveAttribute('href', 'https://api.data.gov/signup');
  });

  it('Save sends the key once, clears the field and shows only the last four, and nothing lands in browser storage', async () => {
    const fetch = stubFetch((url, init) => url === '/api/keys' ? json({ readOnly: false, keys: list() })
      : json({ key: { provider: 'claude', set: true, last4: 'WXYZ', source: 'store', status: 'green', checkedAt: '2026-09-29T12:00:00.000Z', message: 'Key works' } }));
    render(<KeysSection/>);
    const field = await screen.findByLabelText('Claude (Anthropic) API key');
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
    await userEvent.type(field, FAKE_KEY);
    await userEvent.click(within(row('Claude (Anthropic)')).getByRole('button', { name: /Save/ }));
    await within(row('Claude (Anthropic)')).findByText('Verified');
    expect(field).toHaveValue('');
    expect(within(row('Claude (Anthropic)')).getByText('•••• WXYZ')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(FAKE_KEY);
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toBe('/api/keys/claude');
    expect(JSON.parse(String(put?.[1].body))).toEqual({ key: FAKE_KEY });
    expect(JSON.stringify({ ...localStorage })).not.toContain(FAKE_KEY);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(FAKE_KEY);
  });

  it('through the tailnet the list is read-only, with no field and no buttons', async () => {
    stubFetch(() => json({ readOnly: true, keys: list({ kie: { set: true, last4: null, source: 'store', status: 'green', message: 'Key works' } }) }));
    render(<KeysSection/>);
    expect(await screen.findByRole('note')).toHaveTextContent('Keys can only be changed on the PC itself');
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(document.querySelectorAll('input')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Save|Verify|Remove/ })).toBeNull();
    expect(within(row('KIE')).getByText('Verified')).toBeInTheDocument();
  });

  it('a refused save says why and still leaves the field empty', async () => {
    stubFetch((url, init) => init.method === 'PUT' ? json({ error: 'Keys can only be changed on the PC itself.' }, 403) : json({ readOnly: false, keys: list() }));
    render(<KeysSection/>);
    const field = await screen.findByLabelText('OpenAI API key');
    await userEvent.type(field, FAKE_KEY);
    await userEvent.click(within(row('OpenAI')).getByRole('button', { name: /Save/ }));
    expect(await within(row('OpenAI')).findByRole('alert')).toHaveTextContent('only be changed on the PC itself');
    expect(field).toHaveValue('');
  });
});

describe('Brain section', () => {
  const fixture: BrainSummaryData = {
    index: { lastFullReindex: '2026-09-13 21:20:45', command: 'python idx.py' },
    speed: { built: '2026-09-29T12:33:05', questions: 12, brain: { hitAt1: 5, hitAt5: 6, n: 12, medianTokens: 754, medianMs: 649.9 }, grep: { hitAt1: 0, hitAt5: 3, n: 12, medianTokens: 48335, medianMs: 531.1 } },
    studies: [{ study: 'bench.py hard suite', kind: 'simulated sessions', arms: [{ name: 'BRAIN', correct: 26, n: 27, tokens: 12145 }] }],
  };

  it('renders the index date, the benchmark against grep, the report link and the command to copy', async () => {
    stubFetch(url => url === '/api/brain/summary' ? json(fixture) : json({ error: 'no' }, 404));
    render(<BrainSection/>);
    expect(await screen.findByText(/Last full reindex 2026-09-13/)).toBeInTheDocument();
    const table = screen.getByRole('table');
    const cells = (label: string) => within(within(table).getByRole('row', { name: new RegExp(label) })).getAllByRole('cell').map(c => c.textContent);
    expect(cells('Right file first')).toEqual(['5 of 12', '0 of 12']);
    expect(cells('Tokens to read')).toEqual(['754', '48,335']);
    expect(cells('Time')).toEqual(['649.9', '531.1']);
    expect(screen.getByRole('link', { name: /Full report/ })).toHaveAttribute('href', REPORT_URL);
    expect(screen.getByText('python idx.py').tagName).toBe('CODE');
    expect(screen.getByText('bench.py hard suite')).toBeInTheDocument();
    // Read only: nothing on the section can start a reindex or a benchmark.
    expect(screen.queryByRole('button', { name: /reindex|run|benchmark/i })).toBeNull();
  });

  it('says when no reindex is on record and there is no benchmark yet', async () => {
    stubFetch(() => json({ index: { lastFullReindex: null, command: 'python idx.py' }, speed: null, studies: [] }));
    render(<BrainSection/>);
    expect(await screen.findByText('No full reindex on record.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
