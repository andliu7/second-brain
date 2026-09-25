// Projects: every repo and every course project, with its git state, read live from disk.
// The data is /api/projects (server/live.mjs), which runs OS/build_home.py --json on each
// request, so a commit made a minute ago shows here on the next visit. #projects is the
// list; #projects/<path> is one project's page, where <path> is its folder under Projects/.
import { useState } from 'react';
import { ArrowLeft, Check, Copy, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { copyText } from './lib/clipboard';
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

// One line per project: name and description, branch, last commit date, uncommitted count.
// It is a link, so it opens the project's page and a middle click opens it in a new tab.
export function ProjectRow({ repo }: { repo: Repo }) {
  const git = repo.branch !== 'not a repo';
  return <a className="project-row" href={'#projects/' + repo.path}>
    <span className="project-name"><strong>{repo.name}</strong>{repo.desc && <small>{repo.desc}</small>}</span>
    <span className="project-branch">{git && <><GitBranch size={13}/>{repo.branch}</>}</span>
    <span className="project-last" title="Last commit">{git ? repo.last : ''}</span>
    <span className={'project-state ' + stateClass(repo)}>{gitState(repo)}</span>
  </a>;
}

export function Projects({ path, data, error, refresh }: { path: string; data: ProjectsData | null; error: string; refresh: () => void }) {
  if (path) return <ProjectPage path={path} data={data} error={error}/>;
  return <>
    <div className="page-heading"><div><h1>Projects</h1></div><div className="heading-actions"><button className="button" onClick={refresh}><RefreshCw size={15}/>Refresh</button></div></div>
    {error && <div className="error-banner" role="alert"><p>{error}</p></div>}
    {!data ? !error && <div className="panel project-empty"><Loader2 className="spin" size={16}/>Reading git state…</div> : <div className="panel project-list">
      <section><h2 className="project-group">Repositories <span>{data.repos.length}</span></h2>{data.repos.map(repo => <ProjectRow key={repo.path} repo={repo}/>)}</section>
      {data.courses.map(course => <section key={course.name}><h2 className="project-group">{course.title || course.name} {course.projects.length > 0 && <span>{course.projects.length}</span>}</h2>{course.projects.length ? course.projects.map(repo => <ProjectRow key={repo.path} repo={repo}/>) : <p className="project-empty">No project folders in school/{course.name} yet.</p>}</section>)}
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
  </>;
}
