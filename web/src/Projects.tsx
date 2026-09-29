// Projects: every repo and every course project, with its git state, read live from disk.
// The data is /api/projects (server/live.mjs), which runs OS/build_home.py --json on each
// request, so a commit made a minute ago shows here on the next visit. #projects is the
// list; #projects/<path> is one project's page, where <path> is its folder under Projects/.
// Above the repos, Board projects lists the Kanban cards promoted to projects. They live in the workspace,
// not on disk, so they show while git state is still loading, and open the board's own drawer (ProjectPanel).
// Under them, each board project has its Pipeline view switch; a project with it on shows its pipeline right
// here (PipelineView.tsx), which is also what keeps it in step with Claude Code while this page is open.
// Above everything, Links: the hand-kept list in ~/.brain/links.json (server/links.mjs), and on each repo row the
// links whose `project` names that row's folder, so a project's GitHub and live site sit with it.
// A project with a plan in ~/.brain/project-plans shows its pipeline's progress on its row, and its page gets
// Walkthrough and Pipeline tabs (ProjectPlan.tsx, which owns that UI; this file only mounts it).
import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, ExternalLink, GitBranch, Github, Globe, Loader2, RefreshCw } from 'lucide-react';
import { api } from './lib/api';
import type { Card, Workspace } from './types';
import { boardOf, boardPatch, ProjectList, ProjectPanel, type Commit } from './Kanban';
import { PipelineSwitch, PipelineView } from './PipelineView';
import { copyText } from './lib/clipboard';
import { PlanSummaryLine, ProjectPlan, usePlanSummaries } from './ProjectPlan';
import { planKey, type PlanSummary } from './lib/project-plans';
import './projects.css';

// The shapes build_home.py --json prints. dirty is null when git could not answer. rootPath,
// the Projects folder on this computer, is added by server/live.mjs.
export type Repo = { name: string; path: string; branch: string; last: string; stale_days: number; dirty: number | null; desc: string };
export type Course = { name: string; title: string; projects: Repo[] };
export type StatusEntry = { what: string; date: string; body: string };
export type ProjectsData = { repos: Repo[]; courses: Course[]; blueberry: { entries: StatusEntry[] } | null; rootPath?: string };

// One word or two for a project's git state, the same everywhere it is shown.
export const gitState = (repo: Repo) => repo.branch === 'not a repo' ? 'not a repo' : repo.dirty === null ? 'unknown' : repo.dirty ? `${repo.dirty} uncommitted` : 'clean';
const stateClass = (repo: Repo) => repo.branch === 'not a repo' || repo.dirty === null ? 'off' : repo.dirty ? 'dirty' : 'clean';

// The shape GET /api/links returns. project, when present, is a folder path this page lists, e.g. "dashboard".
export type LinkItem = { label: string; url: string; note?: string; project?: string };
export type LinkGroup = { name: string; links: LinkItem[] };

// localhost and 127.x mean "this device", so a link to one works only when the page itself is open on the PC.
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const pcOnly = (url: string) => { try { return LOOPBACK.test(new URL(url).hostname); } catch { return false; } };

// Read once when the page opens. A failed request (a hosted deploy has no /api/links) shows no section rather
// than an error; `live` drops a reply that lands after the page has closed.
function useLinks() {
  const [links, setLinks] = useState<{ groups: LinkGroup[]; error?: string }>({ groups: [] });
  useEffect(() => {
    let live = true;
    api<{ groups?: LinkGroup[]; error?: string }>('links').then(reply => { if (live) setLinks({ groups: Array.isArray(reply.groups) ? reply.groups : [], error: reply.error }); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return links;
}

// One small card per group, each link a full-width button with its host and note under the label. A PC-only
// link is tagged, and dimmed with a tooltip when this page was opened from another device (over Tailscale),
// where 127.0.0.1 is the phone itself. `host` is a prop only so a test can stand in for another device.
export function LinksSection({ groups, error, host = location.hostname }: { groups: LinkGroup[]; error?: string; host?: string }) {
  const [copied, setCopied] = useState<{ url: string; ok: boolean } | null>(null);
  if (!groups.length && !error) return null;
  const remote = !LOOPBACK.test(host);
  async function copy(url: string) { setCopied({ url, ok: await copyText(url) }); }
  return <section className="panel project-links-panel">
    <h2 className="project-group">Links</h2>
    {error && <p className="links-error" role="alert">{error}</p>}
    <div className="links-grid">{groups.map(group => <div key={group.name} className="links-card">
      <h3>{group.name}</h3>
      <ul>{group.links.map(link => {
        const local = pcOnly(link.url), dim = local && remote;
        return <li key={link.label + link.url} className={'links-item' + (dim ? ' dim' : '')} title={dim ? 'Only works on the PC itself' : undefined}>
          <a className="links-open" href={link.url} target="_blank" rel="noopener noreferrer">
            <span className="links-label">{link.label}{local && <span className="tag">This PC only</span>}</span>
            <small className="links-host">{hostOf(link.url)}</small>
            {/* The file's own "This PC only" note would repeat the tag, so the tag alone says it. */}
            {link.note && !(local && /^this pc only$/i.test(link.note)) && <small className="links-note">{link.note}</small>}
            <ExternalLink size={14} aria-hidden="true"/>
          </a>
          <button type="button" className="icon-button links-copy" aria-label={`Copy link: ${link.label}`} title="Copy link" onClick={() => void copy(link.url)}>{copied?.url === link.url && copied.ok ? <Check size={14}/> : <Copy size={14}/>}</button>
        </li>;
      })}</ul>
    </div>)}</div>
    {copied && !copied.ok && <p className="links-foot" role="status">The clipboard is not available here. Long-press the link to copy it.</p>}
    <p className="links-foot">Edit <code>~/.brain/links.json</code> to change these.</p>
  </section>;
}

// One line per project: name and description, branch, last commit date, uncommitted count.
// It is a link, so it opens the project's page and a middle click opens it in a new tab.
// A link cannot sit inside another link, so a row with links of its own is the row and its icons side by side.
export function ProjectRow({ repo, links = [], plan }: { repo: Repo; links?: LinkItem[]; plan?: PlanSummary }) {
  const git = repo.branch !== 'not a repo';
  const row = <a className="project-row" href={'#projects/' + repo.path}>
    <span className="project-name"><strong>{repo.name}</strong>{repo.desc && <small>{repo.desc}</small>}<PlanSummaryLine plan={plan}/></span>
    <span className="project-branch">{git && <><GitBranch size={13}/>{repo.branch}</>}</span>
    <span className="project-last" title="Last commit">{git ? repo.last : ''}</span>
    <span className={'project-state ' + stateClass(repo)}>{gitState(repo)}</span>
  </a>;
  if (!links.length) return row;
  return <div className="project-line">{row}<span className="project-links">{links.map(link => <a key={link.label + link.url} className="icon-button" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.label} title={`${link.label}, ${hostOf(link.url)}`}>
    {/(^|\.)github\.com$/i.test(hostOf(link.url)) ? <Github size={15}/> : <Globe size={15}/>}
  </a>)}</span></div>;
}

// The Kanban page's own project list (Kanban.tsx), in a panel with a count; its rows open the same drawer.
function BoardProjects({ workspace, commit }: { workspace: Workspace; commit: Commit }) {
  const [open, setOpen] = useState<string | null>(null);
  const board = boardOf(workspace);
  const projects = board.cards.filter(card => card.project), count = projects.length;
  const openCard = board.cards.find(card => card.project && card.id === open);
  const patch = boardPatch(commit);
  // One card's change, saved through the board's patch like the drawer's.
  const changeOf = (id: string) => (update: (card: Card) => Card, message?: string) => void patch(b => ({ ...b, cards: b.cards.map(card => card.id === id ? update(card) : card) }), message);
  return <section className="panel project-list board-projects">
    <h2 className="project-group">Board projects {count > 0 && <span>{count}</span>}</h2>
    <ProjectList board={board} open={setOpen}/>
    {count > 0 && <div className="project-pipelines">
      <h3 className="project-group">Pipeline view</h3>
      {projects.map(card => <div key={card.id} className="project-pipeline">
        <div className="project-pipeline-head"><span>{card.title}</span><PipelineSwitch card={card} change={changeOf(card.id)} name={`Pipeline view for ${card.title}`}/></div>
        {card.pipeline?.enabled && open !== card.id && <PipelineView card={card} change={changeOf(card.id)}/>}
      </div>)}
    </div>}
    {openCard && <ProjectPanel card={openCard} patch={boardPatch(commit)} close={() => setOpen(null)}/>}
  </section>;
}

export function Projects({ path, data, error, refresh, workspace, commit }: { path: string; data: ProjectsData | null; error: string; refresh: () => void; workspace: Workspace; commit: Commit }) {
  const links = useLinks();
  const plans = usePlanSummaries();
  if (path) return <ProjectPage path={path} data={data} error={error}/>;
  const linksOf = (repo: Repo) => links.groups.flatMap(group => group.links).filter(link => link.project === repo.path);
  return <>
    <div className="page-heading"><div><h1>Projects</h1></div><div className="heading-actions"><button className="button" onClick={refresh}><RefreshCw size={15}/>Refresh</button></div></div>
    <LinksSection groups={links.groups} error={links.error}/>
    <BoardProjects workspace={workspace} commit={commit}/>
    {error && <div className="error-banner" role="alert"><p>{error}</p></div>}
    {!data ? !error && <div className="panel project-empty"><Loader2 className="spin" size={16}/>Reading git state…</div> : <div className="panel project-list">
      <section><h2 className="project-group">Repositories <span>{data.repos.length}</span></h2>{data.repos.map(repo => <ProjectRow key={repo.path} repo={repo} links={linksOf(repo)} plan={plans[planKey(repo.path)]}/>)}</section>
      {data.courses.map(course => <section key={course.name}><h2 className="project-group">{course.title || course.name} {course.projects.length > 0 && <span>{course.projects.length}</span>}</h2>{course.projects.length ? course.projects.map(repo => <ProjectRow key={repo.path} repo={repo} links={linksOf(repo)} plan={plans[planKey(repo.path)]}/>) : <p className="project-empty">No project folders in school/{course.name} yet.</p>}</section>)}
    </div>}
  </>;
}

function ProjectPage({ path, data, error }: { path: string; data: ProjectsData | null; error: string }) {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const course = data?.courses.find(item => item.projects.some(repo => repo.path === path));
  const repo = data && [...data.repos, ...data.courses.flatMap(item => item.projects)].find(item => item.path === path);
  const back = <a className="text-button project-back" href="#projects"><ArrowLeft size={15}/>All projects</a>;
  if (!repo) return <>{back}{error ? <div className="error-banner" role="alert"><p>{error}</p></div> : <div className="panel project-empty">{data ? `Nothing at #projects/${path}. It may have been moved or renamed.` : <><Loader2 className="spin" size={16}/>Reading git state…</>}</div>}</>;
  const git = repo.branch !== 'not a repo';
  // The full path with forward slashes, which PowerShell, git and editors all accept on Windows.
  const folder = (data?.rootPath ? data.rootPath.replace(/\\/g, '/').replace(/\/+$/, '') : 'Projects') + '/' + repo.path;
  async function copy() { setCopied(await copyText(folder) ? 'yes' : 'failed'); }
  const rows: [string, string][] = [
    ['Folder', folder],
    ...(course ? [['Course', course.title || course.name] as [string, string]] : []),
    ['Branch', git ? repo.branch : 'Not a git repository'],
    ['Last commit', git ? `${repo.last}${repo.stale_days ? `, ${repo.stale_days} ${repo.stale_days === 1 ? 'day' : 'days'} ago` : ', today'}` : 'None'],
    ['Uncommitted', gitState(repo)],
  ];
  return <>
    {back}
    <div className="page-heading"><div><h1>{repo.name}</h1></div><div className="heading-actions"><button className="button" onClick={() => void copy()}>{copied === 'yes' ? <Check size={15}/> : <Copy size={15}/>}Copy folder path</button></div></div>
    {repo.desc && <p className="project-lede">{repo.desc}</p>}
    {copied !== 'no' && <p className="project-lede" role="status">{copied === 'yes' ? 'Folder path copied. Paste it into a terminal or your editor.' : 'The clipboard is not available here. Select the folder path below and copy it.'}</p>}
    <dl className="panel project-facts">{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd className={key === 'Uncommitted' ? 'project-state ' + stateClass(repo) : undefined}>{value}</dd></div>)}</dl>
    <ProjectPlan projectKey={planKey(repo.path)}/>
  </>;
}
