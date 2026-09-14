import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptInput } from '../src/components/ui/ai-chat-input';

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
afterEach(() => {
  if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
  else Reflect.deleteProperty(navigator, 'mediaDevices');
});

function mockImages() {
  const images: { onload?: () => void; onerror?: () => void; naturalWidth: number; naturalHeight: number; src: string }[] = [];
  vi.stubGlobal('Image', class {
    onload?: () => void;
    onerror?: () => void;
    naturalWidth = 100;
    naturalHeight = 80;
    src = '';
    constructor() { images.push(this); }
  });
  let next = 0;
  vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:image-${++next}`);
  return images;
}

describe('PromptInput interactions and resource ownership', () => {
  it('selects models with the keyboard and sends the chosen metadata', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<PromptInput onSubmit={submit} />);
    await user.click(screen.getByRole('button', { name: 'Open prompt input' }));
    await user.click(screen.getByRole('button', { name: /Select model/ }));
    expect(screen.getByRole('menuitemradio', { name: 'GPT 5.5' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    await user.click(screen.getByRole('button', { name: /Reasoning effort: Medium/ }));
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Make a plan');
    await user.click(screen.getByRole('button', { name: 'Send prompt' }));
    expect(submit).toHaveBeenCalledWith('Make a plan', { model: 'Opus 4.8', effort: 'Max Effort', attachments: [] });
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveValue(''));
  });

  it('preserves failed drafts and prevents duplicate asynchronous submissions', async () => {
    let reject!: (error: Error) => void;
    const submit = vi.fn(() => new Promise<boolean>((_, fail) => { reject = fail; }));
    render(<PromptInput defaultValue="Keep this draft" onSubmit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }));
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Network unavailable')));
    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByLabelText('Prompt')).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: 'Send prompt' })).toBeEnabled();
  });

  it('respects controlled values, Shift+Enter, composition, and disabled sending', async () => {
    const submit = vi.fn();
    function Controlled({ submitDisabled = false }) {
      const [value, setValue] = React.useState('A draft');
      return <PromptInput value={value} onChange={setValue} onSubmit={submit} submitDisabled={submitDisabled} />;
    }
    const view = render(<Controlled />);
    const input = screen.getByRole('textbox', { name: 'Prompt' });
    fireEvent.change(input, { target: { value: 'A revised draft' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(submit).not.toHaveBeenCalled();
    view.rerender(<Controlled submitDisabled />);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    view.rerender(<Controlled />);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input).toHaveValue(''));
    expect(submit).toHaveBeenCalledWith('A revised draft', expect.any(Object));
  });

  it('owns image URLs until removal, submission, or unmount and reserves upload slots before decoding', async () => {
    const images = mockImages();
    const submit = vi.fn();
    const view = render(<React.StrictMode><PromptInput maxAttachments={2} onSubmit={submit} /></React.StrictMode>);
    const input = screen.getByLabelText('Attach images');
    const one = new File(['one'], 'one.png', { type: 'image/png' });
    const two = new File(['two'], 'two.png', { type: 'image/png' });
    const three = new File(['three'], 'three.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [one] } });
    fireEvent.change(input, { target: { files: [two, three] } });
    expect(images).toHaveLength(2);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    act(() => { images[1].onload?.(); images[0].onload?.(); });
    expect(screen.getAllByRole('button', { name: /Open preview of/ })).toHaveLength(2);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove one.png' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-1');
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }));
    expect(submit).toHaveBeenCalledWith('', expect.objectContaining({ attachments: [two] }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-2'));
    fireEvent.change(input, { target: { files: [three] } });
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-3');
    act(() => images[2].onload?.());
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it('closes image previews on Escape with reduced motion and restores focus', async () => {
    mockImages();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', window.clearTimeout);
    render(<PromptInput />);
    fireEvent.change(screen.getByLabelText('Attach images'), { target: { files: [new File(['image'], 'preview.png', { type: 'image/png' })] } });
    const thumbnail = screen.getByRole('button', { name: 'Open preview of preview.png' });
    fireEvent.click(thumbnail);
    const dialog = screen.getByRole('dialog', { name: 'Preview of preview.png' });
    expect(screen.getByRole('button', { name: 'Close image preview' })).toHaveFocus();
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(thumbnail).toHaveFocus();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('never fabricates text when speech recognition is unavailable', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    render(<PromptInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Use voice input' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Voice input is unavailable');
    expect(screen.getByLabelText('Prompt')).toHaveValue('');
  });

  it('reports microphone denial without changing the draft', async () => {
    vi.stubGlobal('SpeechRecognition', class {});
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')) } });
    render(<PromptInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Use voice input' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start voice input');
    expect(screen.getByLabelText('Prompt')).toHaveValue('');
  });

  it('stops a late microphone stream when permission resolves after unmount', async () => {
    let resolve!: (stream: MediaStream) => void;
    const stop = vi.fn();
    vi.stubGlobal('SpeechRecognition', class {});
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => new Promise<MediaStream>(done => { resolve = done; })) } });
    const view = render(<PromptInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Use voice input' }));
    view.unmount();
    await act(async () => resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('replaces interim speech and releases the recognizer, audio context, animation, and stream', async () => {
    const stopTrack = vi.fn();
    const stopSpeech = vi.fn();
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const cancelFrame = vi.fn();
    let recognizer: { onresult?: (event: unknown) => void; onend?: () => void; onerror?: () => void } = {};
    vi.stubGlobal('SpeechRecognition', class {
      constructor() { recognizer = this; }
      onresult?: (event: unknown) => void;
      onend?: () => void;
      onerror?: () => void;
      start() {}
      stop = stopSpeech;
    });
    vi.stubGlobal('AudioContext', class {
      state = 'running';
      close = closeContext;
      createAnalyser() { return { fftSize: 64, frequencyBinCount: 32, getByteFrequencyData: (data: Uint8Array) => data.fill(100) }; }
      createMediaStreamSource() { return { connect() {} }; }
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 42));
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } });
    render(<PromptInput />);
    fireEvent.click(screen.getByRole('button', { name: 'Use voice input' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Listening'));
    act(() => recognizer.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'Make a' } }] }));
    expect(screen.getByLabelText('Prompt')).toHaveValue('Make a');
    act(() => recognizer.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'Make a plan' } }] }));
    expect(screen.getByLabelText('Prompt')).toHaveValue('Make a plan');
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(stopSpeech).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(screen.getByLabelText('Prompt')).not.toHaveAttribute('readonly');
  });
});
