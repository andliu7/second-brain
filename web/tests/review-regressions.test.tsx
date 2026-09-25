import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import * as storage from '../src/lib/storage';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=';
const ticket = 'critic-fixture-recoverable-provider-ticket';
let providerResult: { status: 'queued' | 'complete'; model: string; images: string[]; job?: string };

beforeEach(() => {
  providerResult = { status: 'complete', model: 'fixture-image-model', images: [png] };
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const endpoint = String(url);
    const response = endpoint.endsWith('/status') ? {
      local: true, authRequired: false,
      providers: { claude: true, openai: false, gemini: true, fal: true, kie: true },
      models: { claude: 'fixture-chat-model', geminiImage: 'fixture-image-model', fal: 'fixture-image-model', kie: 'fixture-image-model' },
    } : endpoint.endsWith('/generate') || endpoint.endsWith('/generation-status') ? providerResult : { sources: [] };
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

// Generate is a mode of Chat: the second button of the Chat | Generate control at the top of that page.
async function openGenerate() {
  render(<App />);
  await screen.findByRole('button', { name: /Capture a thought/ });
  await userEvent.click(screen.getByRole('button', { name: /^Chat\s*AI?$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
}

function rejectResultPersistence() {
  const original = storage.saveWorkspace;
  return vi.spyOn(storage, 'saveWorkspace').mockImplementation(async workspace => {
    if (workspace.generations.some(generation => generation.images.length || generation.job === ticket)) {
      throw new DOMException('Simulated storage quota reached', 'QuotaExceededError');
    }
    return original(workspace);
  });
}

async function downloadText(value: Blob | string) {
  if (typeof value === 'string') return value;
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(value);
  });
}

describe('independent review regressions', () => {
  it.each(['complete', 'queued'] as const)('recovers a %s provider result when the result cannot be persisted', async status => {
    const user = userEvent.setup();
    const downloads = vi.spyOn(storage, 'download').mockImplementation(() => {});
    const save = rejectResultPersistence();
    providerResult = status === 'complete'
      ? { status, model: 'fixture-image-model', images: [png] }
      : { status, model: 'fixture-image-model', images: [], job: ticket };
    await openGenerate();
    if (status === 'queued') await user.selectOptions(screen.getByLabelText('Provider'), 'fal');
    await user.type(screen.getByLabelText('What do you imagine?'), 'A recoverable generated garden');
    await user.click(screen.getByRole('button', { name: /Generate image/ }));
    await waitFor(() => expect(downloads).toHaveBeenCalled());
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
    const artifacts = await Promise.all(downloads.mock.calls.map(([, data]) => downloadText(data)));
    expect(artifacts.join('\n')).toContain(status === 'complete' ? png : ticket);
    expect(screen.getByLabelText('What do you imagine?')).toHaveValue('A recoverable generated garden');
    const persisted = await storage.loadWorkspace();
    expect(persisted.generations).toHaveLength(1);
    expect(persisted.generations[0].images).toEqual([]);
  });

  it('recovers a completed image when checking a saved job and persistence fails', async () => {
    const workspace = storage.initialWorkspace();
    workspace.generations.push({ id: 'existing-job', prompt: 'A saved garden job', provider: 'fal', model: 'fixture-image-model', aspect: '1:1', status: 'queued', images: [], job: 'existing-signed-ticket', created: storage.now() });
    await storage.saveWorkspace(workspace);
    const downloads = vi.spyOn(storage, 'download').mockImplementation(() => {});
    rejectResultPersistence();
    await openGenerate();
    await userEvent.click(screen.getByRole('button', { name: /Check status/ }));
    await waitFor(() => expect(downloads).toHaveBeenCalled());
    const artifacts = await Promise.all(downloads.mock.calls.map(([, data]) => downloadText(data)));
    expect(artifacts.join('\n')).toContain(png);
    const persisted = await storage.loadWorkspace();
    expect(persisted.generations[0].status).toBe('queued');
    expect(persisted.generations[0].job).toBe('existing-signed-ticket');
  });
});
