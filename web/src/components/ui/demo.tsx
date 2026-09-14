"use client";

import * as React from 'react';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { PromptInput, type PromptInputMeta } from '@/components/ui/ai-chat-input';

export default function Demo() {
  const [dark, setDark] = React.useState(false);
  const [submission, setSubmission] = React.useState<{ message: string; meta: PromptInputMeta } | null>(null);
  return <main className={`prompt-demo ${dark ? 'dark' : ''} relative flex min-h-screen w-full items-center justify-center overflow-hidden text-foreground`}
    style={{ backgroundImage: 'radial-gradient(125% 125% at 50% 101%, rgba(245,87,2,1) 10.5%, rgba(245,120,2,1) 16%, rgba(245,140,2,1) 17.5%, rgba(245,170,100,1) 25%, rgba(238,174,202,1) 40%, rgba(202,179,214,1) 65%, rgba(148,201,233,1) 100%)' }}>
    <a href="/#chat" className="absolute left-5 top-5 flex min-h-11 items-center gap-2 rounded-full bg-card/80 px-4 text-sm text-foreground no-underline backdrop-blur"><ArrowLeft size={15} />Back to Chat</a>
    <button type="button" aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark(!dark)} className="absolute right-5 top-5 flex size-11 items-center justify-center rounded-full border-0 bg-card/80 text-foreground backdrop-blur">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
    <div className="relative z-10 flex w-full max-w-lg flex-col items-center gap-6 p-4">
      <h1 className="sr-only">AI chat input demo</h1>
      <PromptInput placeholder="Ask anything..." onSubmit={(message, meta) => setSubmission({ message, meta })} />
      {submission && <div role="status" className="w-full max-w-[480px] rounded-2xl bg-card/90 p-4 text-sm text-foreground shadow-sm backdrop-blur">
        <p className="font-semibold">Prompt captured</p>
        <p className="mt-2 whitespace-pre-wrap break-words">{submission.message || 'Images attached'}</p>
        <p className="mt-3 text-xs text-muted-foreground">{submission.meta.model} · {submission.meta.effort} · {submission.meta.attachments.length} images</p>
        {submission.meta.attachments.length > 0 && <p className="mt-2 break-words text-xs">{submission.meta.attachments.map(file => file.name).join(', ')}</p>}
        <p className="mt-3 text-xs text-muted-foreground">This demo captures your prompt locally. Use Chat to send messages to your configured provider.</p>
      </div>}
    </div>
  </main>;
}
