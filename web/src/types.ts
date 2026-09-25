import type { CategoryId } from './lib/categories';
// 'files' and 'generate' are no longer pages of their own (Files left the nav, Generate lives inside Chat)
// but activity entries still name them, so they stay in the union.
export type Page = 'today' | 'agenda' | 'projects' | 'board' | 'buy' | 'files' | 'skills' | 'goals' | 'network' | 'chat' | 'generate' | 'settings';
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
// minutes is the todo's estimate, shown as a chip.
export type ChecklistItem = { id: string; title: string; done: boolean };
export type Card = { id: string; title: string; notes: string; column: string; category?: CategoryId; checklist: ChecklistItem[]; attachments: string[]; due?: string; minutes?: number; eventId?: string; sourceTodoId?: string; sticky?: { x: number; y: number; rotate: number } };
export type Column = { id: string; name: string };
export type Board = { columns: Column[]; cards: Card[]; view: 'board' | 'sticky' };
// The daily todo card (TodoCard.tsx). items are today's todos; history holds earlier days' completed
// ones by date, 30 days deep; removedDefaults names the built-in daily todos the user deleted for good.
export type Todo = { id: string; text: string; done: boolean; category: CategoryId; minutes?: number; goal?: string; time?: string; defaultKey?: string };
export type Todos = { day: string; items: Todo[]; history: Record<string, Todo[]>; removedDefaults: string[] };
// The long-term to-buy list (BuyList.tsx). image is a URL, or "doc:<id>" for an image doc in this workspace.
// options are the manual store rows; the card shows their lowest price and highest rating.
export type BuyOption = { id: string; store: string; price: number | null; currency: string; rating: number | null; notes: string; link: string };
export type BuyItem = { id: string; name: string; category: CategoryId; image: string; links: string[]; notes: string; options: BuyOption[] };
// board, todos and buyList are optional because workspaces saved before they existed have none;
// Kanban.tsx fills in defaultBoard(), TodoCard.tsx and BuyList.tsx fill in theirs.
export type Workspace = { version: 1; docs: Doc[]; goals: Goal[]; conversations: Conversation[]; generations: Generation[]; activity: Activity[]; relations?: Relation[]; board?: Board; todos?: Todos; buyList?: BuyItem[]; favorites?: Favorites };
// Starred things (lib/favorites.ts): skills by slug, projects by repo path. Both pages sort these first.
export type Favorites = { skills: string[]; projects: string[] };
export type Source = { id: string; name: string; kind: 'file'; path: string; size: number; updated: string };
export type Connections = { local: boolean; providers: Record<string, boolean>; authRequired: boolean; models: Record<string, string> };
