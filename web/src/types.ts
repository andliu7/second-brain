import type { CategoryId } from './lib/categories';
// 'files' and 'generate' are no longer pages of their own (Files left the nav, Generate lives inside Chat)
// but activity entries still name them, so they stay in the union. 'write' is one note as a page of its
// own, #write/<docId>, drawn without the app shell (Write.tsx).
export type Page = 'today' | 'agenda' | 'projects' | 'calendar' | 'board' | 'buy' | 'files' | 'skills' | 'goals' | 'network' | 'chat' | 'generate' | 'settings' | 'docs' | 'draw' | 'resume' | 'write' | 'pdf';
export type Doc = { id: string; name: string; content: string; kind: 'note' | 'file' | 'skill'; tags: string[]; pinned: boolean; created: string; updated: string; mime?: string; data?: string; size?: number; source?: string };
export type Goal = { id: string; title: string; description: string; category: string; due: string; archived: boolean; milestones: {id: string; title: string; done: boolean}[]; created: string };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; created: string; provider?: string; model?: string };
export type Conversation = { id: string; title: string; messages: Message[]; updated: string };
export type Generation = { id: string; prompt: string; provider: string; model: string; aspect: string; created: string; status: 'queued' | 'complete' | 'failed'; job?: string; images: string[]; error?: string };
export type Activity = { id: string; text: string; page: Page; created: string };
export type Relation = { id: string; source: string; target: string; relation: 'references' | 'supports' | 'depends_on' | 'uses_skill' | 'related_to'; created: string };
// The kanban board (Kanban.tsx). A card lives in one column; the order of board.cards is its order within
// that column. Its colour tag is a category id (lib/categories.ts). sticky is where the card sits in
// sticky-note mode, set the first time it is moved there. eventId is the calendar event a card was
// imported from and sourceTodoId the todo it was dropped from, so importing either twice adds nothing.
// minutes is the todo's estimate, shown as a chip. project marks a card promoted to a project: its
// checklist items are then its stages (StageTimeline), detail a stage's notes and doneOn the day (YYYY-MM-DD)
// it was ticked. All three are optional, so every checklist saved before them is already a list of stages.
export type ChecklistItem = { id: string; title: string; done: boolean; detail?: string; doneOn?: string };
export type Card = { id: string; title: string; notes: string; column: string; category?: CategoryId; checklist: ChecklistItem[]; attachments: string[]; due?: string; minutes?: number; eventId?: string; sourceTodoId?: string; sticky?: { x: number; y: number; rotate: number }; project?: boolean };
export type Column = { id: string; name: string };
export type Board = { columns: Column[]; cards: Card[]; view: 'board' | 'sticky' };
// The daily todo card (TodoCard.tsx). items are today's todos; history holds earlier days' completed
// ones by date, all of them; removedDefaults names the built-in daily todos the user deleted for good.
export type Todo = { id: string; text: string; done: boolean; category: CategoryId; minutes?: number; goal?: string; time?: string; defaultKey?: string };
export type Todos = { day: string; items: Todo[]; history: Record<string, Todo[]>; removedDefaults: string[] };
// The long-term to-buy list (BuyList.tsx). image is a URL, or "doc:<id>" for an image doc in this workspace.
// options are the manual store rows; the card shows their lowest price and highest rating.
export type BuyOption = { id: string; store: string; price: number | null; currency: string; rating: number | null; notes: string; link: string };
export type BuyItem = { id: string; name: string; category: CategoryId; image: string; links: string[]; notes: string; options: BuyOption[] };
// board, todos and buyList are optional because workspaces saved before they existed have none;
// Kanban.tsx fills in defaultBoard(), TodoCard.tsx and BuyList.tsx fill in theirs.
export type Workspace = { version: 1; docs: Doc[]; goals: Goal[]; conversations: Conversation[]; generations: Generation[]; activity: Activity[]; relations?: Relation[]; board?: Board; todos?: Todos; buyList?: BuyItem[]; favorites?: Favorites; resume?: Resume; drawing?: Drawing; misc?: MiscItem[]; todayLayout?: TodayWidget[]; notebooks?: Notebook[] };
// A notebook on the Docs page. Only the name lives here; a note joins one with a "notebook:<id>" tag
// (lib/docs-kinds.ts), so deleting a notebook drops the tag and keeps every note.
export type Notebook = { id: string; name: string };
// Today's progress dashboard (TodayWidgets.tsx): the widgets' order and sizes. Optional, because every
// workspace saved before it had none; TodayWidgets falls back to its default layout.
export type TodayWidget = { id: string; size: 'sm' | 'wide' | 'tall' | 'lg' };
// The brainstorm list (MiscList.tsx): loose lines that are not cards yet. created is an ISO timestamp.
export type MiscItem = { id: string; text: string; kind: 'task' | 'idea' | 'note'; done: boolean; created: string };
// The whiteboard (Whiteboard.tsx). elements are Drawnix's Plait elements exactly as it hands them over
// (shapes, arrows, mind maps, freehand strokes), and viewport is where the view was left. A workspace
// without a drawing opens an empty board.
export type Drawing = { elements: { id: string; [key: string]: unknown }[]; viewport?: { zoom: number; origination?: [number, number] } };
// The resume (Resume.tsx). Education, experience and projects share one entry shape; the form labels
// title and subtitle per section (School and Degree, Company and Role, Project and Tech). bullets and
// skills hold one line each, empty lines included while typing; the preview and plain text skip those.
export type ResumeEntry = { id: string; title: string; subtitle: string; date: string; location: string; bullets: string[] };
export type Resume = { profile: { name: string; email: string; phone: string; location: string; links: string[] }; education: ResumeEntry[]; experience: ResumeEntry[]; projects: ResumeEntry[]; skills: string[]; template?: ResumeTemplate };
// The look of the resume page (Resume.tsx TEMPLATES); optional, so a resume saved before it is Classic.
export type ResumeTemplate = 'classic' | 'onyx' | 'ditto' | 'azurill';
// Starred things (lib/favorites.ts): skills by slug, projects by repo path. Both pages sort these first.
export type Favorites = { skills: string[]; projects: string[]; review?: string[] };  // review: skills bookmarked "mark for review"
export type Source = { id: string; name: string; kind: 'file'; path: string; size: number; updated: string };
export type Connections = { local: boolean; providers: Record<string, boolean>; authRequired: boolean; models: Record<string, string> };
