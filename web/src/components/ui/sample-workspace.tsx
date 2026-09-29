// SampleWorkspaceCard: a Settings section that loads the made-up sample workspace (lib/sample-workspace.ts).
// Loading it REPLACES this browser's workspace, so the card offers the backup download first and asks for
// a second, inline click before it loads anything (an inline confirm rather than window.confirm, which
// blocks the page and cannot be styled or tested). Props:
//   workspace: the current workspace, for the backup download
//   commit: App's commit; the card calls commit(() => sampleWorkspace(), message) only after confirming
// Mount in Settings (App.tsx), next to Your data:
//   <SampleWorkspaceCard workspace={workspace} commit={commit}/>
import { useState } from 'react';
import { Download, FlaskConical } from 'lucide-react';
import type { Workspace } from '../../types';
import { download } from '../../lib/storage';
import { sampleWorkspace } from '../../lib/sample-workspace';

type Commit = (update: (workspace: Workspace) => Workspace, message?: string) => Promise<boolean>;

export function SampleWorkspaceCard({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const backup = () => download(`second-brain-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' }));
  async function load() { setBusy(true); try { await commit(() => sampleWorkspace(), 'Sample workspace loaded'); } finally { setBusy(false); setConfirming(false); } }
  return <section className="panel settings-section" aria-labelledby="sample-workspace-title">
    <div className="section-heading"><h2 id="sample-workspace-title"><FlaskConical size={17}/>Try the sample workspace</h2><span className="tag">DEMO</span></div>
    <p className="settings-intro">A made-up student, Sam Rivera, with notes, a journal, a board with projects, todos, goals, a resume and a few chats, so every page has something to show. Loading it <strong>replaces this browser's workspace</strong>. Download a backup first if you want to come back; Import backup restores it.</p>
    <div className="data-actions"><div>
      <button className="button" onClick={backup}><Download size={15}/>Download my backup first</button>
      {!confirming
        ? <button className="button" onClick={() => setConfirming(true)}>Load sample</button>
        : <span role="group" aria-label="Confirm loading the sample">
            <span>Replace this workspace with the sample?</span>{' '}
            <button className="button primary" disabled={busy} onClick={() => void load()}>Yes, replace it</button>{' '}
            <button className="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </span>}
    </div></div>
  </section>;
}
