// CodeBlock: a fenced code block with its language and a copy button, from the component Andrew pasted
// (2026-09-27), on the app's tokens. Markdown.tsx renders every ``` fence with it, so andliu.ai's answers,
// skill pages and file previews all get the same block. Props:
//   code: the text; language: the word after the fence, if any ("tsx", "python"); className
// Highlighting is shiki (github-dark, the theme nearest the app's palette), loaded on first use and
// skipped under vitest, where the WASM tokenizer has no business in a jsdom test; any failure falls back
// to plain text, so a block never fails to show. The copy button reads "Copied" for two seconds.
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import './code-block.css';

const inTests = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'test';

export function CodeBlock({ code, language = '', className }: { code: string; language?: string; className?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    setHtml(null);
    if (inTests || !code.trim()) return;
    import('shiki').then(({ codeToHtml }) => codeToHtml(code, { lang: language || 'text', theme: 'github-dark' })).then(out => { if (live) setHtml(out); }, () => { /* plain text stays */ });
    return () => { live = false; };
  }, [code, language]);
  async function copy() { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the clipboard is not available here */ } }
  return <div className={cn('code-block', className)}>
    <div className="code-block-head">
      <span className="code-block-lang">{language || 'code'}</span>
      <button type="button" className="icon-button code-block-copy" aria-label={copied ? 'Copied' : `Copy ${language || 'code'} block`} title="Copy" onClick={() => void copy()}>{copied ? <Check size={14}/> : <Copy size={14}/>}</button>
    </div>
    {html ? <div className="code-block-body" dangerouslySetInnerHTML={{ __html: html }}/> : <div className="code-block-body"><pre><code>{code}</code></pre></div>}
  </div>;
}
export default CodeBlock;
