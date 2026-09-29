// The sample workspace: a made-up person, Sam Rivera, a sophomore in chemistry and computer science at
// the fictional Lakeshore State University, with enough in every part of the app that each page has
// something to show. It is for demos, screenshots and anyone who clones this public repository; nothing
// in it is real. Settings loads it (components/ui/sample-workspace.tsx), and scripts/make-sample.mjs
// writes it to public/sample-workspace.json as an ordinary backup for Import.
//
// Every date is counted back from `today`, so the streak, the todo chart, the heat calendar, the
// journal's On this day and the month calendar look lived in whenever it is loaded. It is
// deterministic: the same `today` gives the same workspace, because the "random" counts come from a
// seeded generator, never Math.random. It imports types only, so the node script can transpile this
// one file on its own.
import type { Activity, Board, BuyItem, ChecklistItem, Conversation, Doc, Generation, Goal, MiscItem, Notebook, Page, Relation, Resume, TodayWidget, Todo, Todos, Whiteboard, Workspace } from '../types';

// mulberry32: a tiny seeded generator, so the sample is the same on every machine and every run.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A 48 by 32 PNG of a sunset over hills, drawn by a script once and kept as text, for the one finished
// image generation (a completed generation must hold a real raster image).
const SUNSET_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAABLElEQVR42u3OP0tCURzG8eflnFei5Us4LyKQIAKRtDBFpD9yTcRSQ5OLEg0FQUNDQ9DQ4CA4NDQIDQkOgoOLDWe53Hv+mN4fHkT4LD/ufQ5fzDp7VsHUjVsFk/a+VTBuHVgFv81Dq+DnNkFqPnryMv6PYT1Jx1cj6Cf4vkkRkdYImhW+qscUNDWCaohBJUPBGKQaol/OUjAGqYbolfIUjEGqIT6dAgVjkGqIj+I5EU2NZoX3i0s60hr9BG9nDilfjfF/vBaurIKXfMUqeM5VrYLH01ro2C5nMc4inEU52+HBU7PFQ6YRIlWB9JS+gO5JMxSLFEhP3ztw03cr+m9B8PS+BvGhdeQuZ7kC6SkehPdDI9lZ3OoF0hPBD9eJe71wC8xB6z23QdugjQv6A4zS2zp5Ub7fAAAAAElFTkSuQmCC';
// A short text file attached to a board card, as base64 of plain ASCII.
const LAB_CSV = 'trial,mass_g,yield_pct\n1,2.41,68\n2,2.38,71\n3,2.44,74\n';
const toBase64 = (text: string) => btoa(text);

export function sampleWorkspace(today = new Date()): Workspace {
  const random = seeded(20260928);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  // A local moment `ago` days before today, as the ISO timestamp the schema wants.
  const at = (ago: number, hour: number, minute = 0) => new Date(y, m, d - ago, hour, minute).toISOString();
  // A local day as YYYY-MM-DD; a negative `ago` is a day in the future.
  const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const day = (ago: number) => dayKey(new Date(y, m, d - ago, 12));
  // The same day of the month `months` back, or the nearest earlier month that has that date, so On this
  // day always finds something (the 31st has no match in a 30-day month).
  const sameDateBack = (months: number) => { for (let back = months; back < months + 12; back++) { const t = new Date(y, m - back, d, 20, 30); if (t.getDate() === d) return t.toISOString(); } return at(28, 20, 30); };

  const notebooks: Notebook[] = [{ id: 'nb-orgo', name: 'Organic Chemistry' }, { id: 'nb-cs', name: 'Data Structures' }, { id: 'nb-lab', name: 'Research Lab' }];
  const note = (id: string, name: string, content: string, tags: string[], created: string, updated = created, pinned = false): Doc => ({ id, name, content, kind: 'note', tags, pinned, created, updated });
  const journalTitle = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const journal = (id: string, created: string, content: string, tags: string[] = []) => note(id, journalTitle(created), content, ['Journal', ...tags], created);

  const docs: Doc[] = [
    note('doc-orgo-sn', 'SN1 vs SN2 cheat sheet', '# SN1 vs SN2\n\n- **SN2**: one step, backside attack, inversion. Primary > secondary. Polar aprotic solvent (DMSO, acetone).\n- **SN1**: carbocation first, racemizes. Tertiary > secondary. Polar protic solvent (water, ethanol).\n\n## Tells on an exam\n\n- [x] Look at the substrate first\n- [x] Then the nucleophile: strong and small means SN2\n- [ ] Rearrangements only happen through a carbocation\n', ['notebook:nb-orgo', 'exam-1', 'mechanisms'], at(20, 21), at(2, 22, 15), true),
    note('doc-orgo-ir', 'IR peaks to memorize', '| Group | Wavenumber |\n| --- | --- |\n| O-H (alcohol) | 3200 to 3550, broad |\n| C=O | 1680 to 1750, sharp |\n| C-H (sp3) | just under 3000 |\n\nMnemonic from study group: "broad is bonded to hydrogen".', ['notebook:nb-orgo', 'spectroscopy'], at(12, 19), at(5, 18)),
    note('doc-cs-heaps', 'Heaps and priority queues', '# Binary heaps\n\nArray layout: children of `i` are `2i + 1` and `2i + 2`.\n\n```python\ndef sift_down(a, i, n):\n    while 2 * i + 1 < n:\n        c = 2 * i + 1\n        if c + 1 < n and a[c + 1] < a[c]:\n            c += 1\n        if a[i] <= a[c]:\n            break\n        a[i], a[c] = a[c], a[i]\n        i = c\n```\n\nBuild heap is O(n), not O(n log n). Ask in office hours why.', ['notebook:nb-cs', 'exam-1', 'algorithms'], at(9, 16), at(1, 20, 40)),
    note('doc-cs-p2', 'Project 2 plan: spell checker', 'Trie for the dictionary, edit distance for suggestions.\n\n1. Load words into a trie\n2. Walk the input, flag misses\n3. Suggest the three closest by Levenshtein distance\n\nPartner: Priya (does the tests).', ['notebook:nb-cs', 'projects'], at(6, 14), at(0, 8, 10)),
    note('doc-lab-log', 'Lab notebook: aspirin synthesis', 'Week 3 of the undergraduate research rotation with Dr. Okafor (made-up lab, made-up data).\n\n- Recrystallized from ethanol and water\n- Melting point 134 to 136 C, close to the literature 135 C\n- Yield up from 68% to 74% after slower cooling\n\nNext: TLC before and after to show the salicylic acid is gone.', ['notebook:nb-lab', 'research'], at(15, 17), at(3, 17, 30)),
    note('doc-reading', 'Reading list', '- *The Disappearing Spoon*, Sam Kean\n- *Grokking Algorithms*, Aditya Bhargava\n- *Atomic Habits*, James Clear (half done)', ['books'], at(30, 12), at(10, 12)),
    note('doc-idea-flash', 'Idea: spaced repetition for reaction mechanisms', 'Flashcards that show a starting material and ask for the arrow pushing, not just the product. Could reuse the heap from CS for the review queue.', ['Idea', 'mechanisms', 'projects'], at(7, 23), at(7, 23)),
    note('doc-idea-club', 'Idea: chem club demo night', 'Elephant toothpaste, a flame test rainbow, and a liquid nitrogen ice cream table. Needs a safety sign-off from the department.', ['Idea', 'club'], at(4, 13), at(4, 13)),
    note('doc-idea-app', 'Idea: dining hall macro tracker', 'Scrape the posted menu each morning, let people tick what they ate. Probably overkill; a spreadsheet might do.', ['Idea'], at(11, 9), at(11, 9)),
    journal('doc-j-today', at(0, 7, 45), 'Up early. Orgo quiz is Thursday, so today is mechanisms and one heap problem before lab.', ['school']),
    journal('doc-j-1', at(1, 22), 'Long day. Lab ran over but the yield was the best yet. Called home; Mom says the dog learned to open the pantry.'),
    journal('doc-j-2', at(2, 21, 30), 'Office hours helped: build heap is O(n) because most nodes are near the bottom and barely move.', ['school']),
    journal('doc-j-4', at(4, 22, 10), 'Ran 5k without stopping for the first time. Slow, but done.', ['running']),
    journal('doc-j-8', at(8, 20), 'Rough exam week ahead. Made a plan on the board and felt better right away.'),
    journal('doc-j-15', at(15, 21), 'First day in the lab. Everyone is kind; I broke nothing.', ['research']),
    journal('doc-j-month', sameDateBack(1), 'Move-in weekend. New room, same bad lamp. Wrote the goals for the semester.'),
    journal('doc-j-year', sameDateBack(12), 'Freshman year, week one. Signed up for chem club and immediately got lost finding the building.'),
    { ...note('doc-resume', 'Resume', '', ['Resume'], at(25, 15), at(3, 15)) },
    { id: 'doc-skill-lab', name: 'Lab report outline', content: '---\nname: lab-report-outline\ndescription: Turn raw lab notes into a report skeleton.\n---\n\nGiven a lab notebook entry, write: Purpose, Procedure (past tense, passive), Data (as a table), Discussion (yield, sources of error), Conclusion. Never invent numbers.', kind: 'skill', tags: ['writing'], pinned: false, created: at(18, 16), updated: at(6, 16) },
    { id: 'doc-file-yield', name: 'aspirin-yields.csv', content: LAB_CSV, kind: 'file', tags: ['research'], pinned: false, created: at(3, 17, 40), updated: at(3, 17, 40), mime: 'text/csv', size: LAB_CSV.length, data: 'data:text/csv;base64,' + toBase64(LAB_CSV) },
  ];

  const goals: Goal[] = [
    { id: 'goal-gpa', title: 'Finish the semester with a 3.6', description: 'Mostly means not letting orgo slide.', category: 'Academic', due: day(-75), archived: false, created: at(40, 10), milestones: [{ id: 'ms-gpa-1', title: 'B+ or better on Orgo exam 1', done: true }, { id: 'ms-gpa-2', title: 'Submit Project 2 on time', done: false }, { id: 'ms-gpa-3', title: 'Weekly office hours for Data Structures', done: false }] },
    { id: 'goal-5k', title: 'Run a 5k under 30 minutes', description: 'Couch to 5k, three runs a week.', category: 'Fitness', due: day(-40), archived: false, created: at(35, 7), milestones: [{ id: 'ms-5k-1', title: 'Run 5k without stopping', done: true }, { id: 'ms-5k-2', title: 'Break 33 minutes', done: false }, { id: 'ms-5k-3', title: 'Break 30 minutes', done: false }] },
    { id: 'goal-research', title: 'Earn a summer research spot', description: 'Ask Dr. Okafor about the summer program by winter break.', category: 'Professional', due: day(-100), archived: false, created: at(30, 11), milestones: [{ id: 'ms-r-1', title: 'Finish the rotation', done: false }, { id: 'ms-r-2', title: 'Update resume', done: true }, { id: 'ms-r-3', title: 'Send the email', done: false }] },
    { id: 'goal-old', title: 'Learn to cook five dinners', description: 'Done over the summer.', category: 'Personal', due: day(45), archived: true, created: at(120, 18), milestones: [{ id: 'ms-old-1', title: 'Stir fry', done: true }, { id: 'ms-old-2', title: 'Chili', done: true }] },
  ];

  const stage = (id: string, title: string, doneAgo: number | null, detail?: string): ChecklistItem => ({ id, title, done: doneAgo !== null, ...(doneAgo !== null ? { doneOn: day(doneAgo) } : {}), ...(detail ? { detail } : {}) });
  const board: Board = {
    view: 'board',
    columns: [{ id: 'todo', name: 'To do' }, { id: 'doing', name: 'Doing' }, { id: 'done', name: 'Done' }],
    cards: [
      { id: 'card-p2', title: 'Project 2: spell checker', notes: 'Data Structures, with Priya.', column: 'doing', category: 'project', project: true, due: day(-9), attachments: ['doc-cs-p2'], checklist: [stage('st-p2-1', 'Read the spec', 12, 'Due date and grading rubric are on the course site.'), stage('st-p2-2', 'Trie loads the dictionary', 8), stage('st-p2-3', 'Flag misspelled words', 3, 'Handles punctuation now.'), stage('st-p2-4', 'Suggestions by edit distance', null, 'Try the two-row DP to save memory.'), stage('st-p2-5', 'Write the README and submit', null)] },
      { id: 'card-lab', title: 'Research rotation write-up', notes: 'Due to Dr. Okafor at the end of the rotation.', column: 'doing', category: 'professional', project: true, due: day(-18), attachments: ['doc-lab-log', 'doc-file-yield'], checklist: [stage('st-lab-1', 'Collect three trials', 5), stage('st-lab-2', 'TLC plates', 2), stage('st-lab-3', 'Draft the discussion', null), stage('st-lab-4', 'Get feedback', null)] },
      { id: 'card-quiz', title: 'Study for Orgo quiz', notes: 'Chapters 7 and 8.', column: 'todo', category: 'academic', due: day(-3), minutes: 90, attachments: ['doc-orgo-sn'], checklist: [{ id: 'ck-q-1', title: 'Redo problem set 4', done: true }, { id: 'ck-q-2', title: 'Mechanism flashcards', done: false }] },
      { id: 'card-urgent', title: 'Financial aid form', notes: 'The portal closes Friday.', column: 'todo', category: 'urgent', due: day(-2), attachments: [], checklist: [] },
      { id: 'card-call', title: 'Call Grandma for her birthday', notes: '', column: 'todo', category: 'family', due: day(-5), attachments: [], checklist: [] },
      { id: 'card-run', title: 'Long run Saturday', notes: '6k at an easy pace.', column: 'todo', category: 'fitness', minutes: 40, attachments: [], checklist: [], sticky: { x: 40, y: 30, rotate: -2 } },
      { id: 'card-club', title: 'Chem club demo night proposal', notes: '', column: 'todo', category: 'other', attachments: ['doc-idea-club'], checklist: [] },
      { id: 'card-dinner', title: 'Dinner with the floor', notes: 'Thai place, Friday.', column: 'done', category: 'relationships', attachments: [], checklist: [] },
      { id: 'card-ex1', title: 'Orgo exam 1', notes: 'Got an 88.', column: 'done', category: 'academic', attachments: [], checklist: [] },
    ],
  };

  // Todos: today's list, and three weeks of finished ones, with one missed day so the streak has a start.
  const POOL: Pick<Todo, 'text' | 'category' | 'minutes'>[] = [
    { text: 'Orgo problem set', category: 'academic', minutes: 60 }, { text: 'Data Structures reading', category: 'academic', minutes: 45 },
    { text: 'Run', category: 'fitness', minutes: 30 }, { text: 'Lab notebook entry', category: 'professional', minutes: 20 },
    { text: 'Text Mom back', category: 'family', minutes: 5 }, { text: 'Laundry', category: 'other', minutes: 30 },
    { text: 'Flashcards', category: 'academic', minutes: 20 }, { text: 'Gym with Jordan', category: 'relationships', minutes: 60 },
  ];
  const history: Record<string, Todo[]> = {};
  for (let ago = 1; ago <= 21; ago++) {
    if (ago === 16) continue;
    const count = 1 + Math.floor(random() * 4);
    history[day(ago)] = Array.from({ length: count }, (_, i) => ({ id: `todo-h${ago}-${i}`, done: true, ...pick(POOL) }));
  }
  const todos: Todos = {
    day: day(0),
    removedDefaults: [],
    history,
    items: [
      { id: 'todo-read', text: 'Read for 15 minutes', done: true, category: 'other', minutes: 15, defaultKey: 'read' },
      { id: 'todo-write', text: 'Write for 15 minutes', done: false, category: 'other', minutes: 15, defaultKey: 'write' },
      { id: 'todo-mech', text: 'Mechanism flashcards', done: true, category: 'academic', minutes: 30, goal: 'Finish the semester with a 3.6' },
      { id: 'todo-p2', text: 'Edit distance for Project 2', done: false, category: 'project', minutes: 90, time: '14:00', goal: 'Submit Project 2 on time' },
      { id: 'todo-lab', text: 'Lab, 3 to 6', done: false, category: 'professional', time: '15:00' },
      { id: 'todo-run', text: 'Easy run', done: false, category: 'fitness', minutes: 30 },
    ],
  };

  const buyList: BuyItem[] = [
    { id: 'buy-goggles', name: 'Splash-proof lab goggles', category: 'academic', image: '', links: ['https://example.com/goggles'], notes: 'Required for lab. The anti-fog ones.', options: [{ id: 'opt-g-1', store: 'Campus bookstore', price: 18.5, currency: 'USD', rating: 4.1, notes: '', link: 'https://example.com/goggles' }, { id: 'opt-g-2', store: 'Online retailer', price: 12.99, currency: 'USD', rating: 4.4, notes: 'Two-day shipping', link: 'https://example.com/goggles-2' }] },
    { id: 'buy-shoes', name: 'Running shoes', category: 'fitness', image: '', links: [], notes: 'Neutral, half size up.', options: [{ id: 'opt-s-1', store: 'Local running store', price: 110, currency: 'USD', rating: 4.8, notes: 'Gait check is free', link: '' }] },
    { id: 'buy-models', name: 'Molecular model kit', category: 'academic', image: '', links: ['https://example.com/model-kit'], notes: 'Chairs and boats are so much easier in 3D.', options: [{ id: 'opt-m-1', store: 'Online retailer', price: 24, currency: 'USD', rating: 4.6, notes: '', link: 'https://example.com/model-kit' }] },
    { id: 'buy-gift', name: 'Birthday gift for Grandma', category: 'family', image: '', links: [], notes: 'A photo book from the summer?', options: [] },
  ];

  const misc: MiscItem[] = [
    { id: 'misc-1', text: 'Ask the TA whether the final is cumulative', kind: 'task', done: false, created: at(1, 10) },
    { id: 'misc-2', text: 'A study playlist that is only lo-fi covers of video game music', kind: 'idea', done: false, created: at(3, 23) },
    { id: 'misc-3', text: 'Dining hall has pho on Wednesdays', kind: 'note', done: false, created: at(5, 12) },
    { id: 'misc-4', text: 'Return the library book', kind: 'task', done: true, created: at(9, 15) },
    { id: 'misc-5', text: 'Make the heap visualizer into a club workshop', kind: 'idea', done: false, created: at(10, 20) },
    { id: 'misc-6', text: 'Priya prefers texts over email', kind: 'note', done: false, created: at(12, 18) },
  ];

  const resume: Resume = {
    template: 'onyx',
    profile: { name: 'Sam Rivera', email: 'sam.rivera@example.com', phone: '(555) 010-0142', location: 'Lakeshore, MI', links: ['https://example.com/samrivera'] },
    education: [{ id: 'ed-1', title: 'Lakeshore State University', subtitle: 'B.S. Chemistry and Computer Science', date: 'Expected May 2029', location: 'Lakeshore, MI', bullets: ['GPA 3.5', 'Coursework: Organic Chemistry I, Data Structures, Discrete Math'] }],
    experience: [
      { id: 'ex-1', title: 'Okafor Lab, Department of Chemistry', subtitle: 'Undergraduate research assistant', date: 'Fall 2026', location: 'Lakeshore, MI', bullets: ['Raised recrystallization yield from 68% to 74% by changing the cooling rate', 'Keep the shared lab notebook and TLC records'] },
      { id: 'ex-2', title: 'Lakeshore State Tutoring Center', subtitle: 'Chemistry tutor', date: 'Spring 2026 to present', location: 'Lakeshore, MI', bullets: ['Tutor general chemistry, four hours a week'] },
    ],
    projects: [{ id: 'pr-1', title: 'Spell checker', subtitle: 'Python, tries, dynamic programming', date: '2026', location: '', bullets: ['Suggests corrections by edit distance over a trie of 100,000 words'] }],
    skills: ['Python, Java, Git', 'Recrystallization, TLC, melting point, IR', 'Spanish (conversational)'],
  };

  // Two whiteboards in Drawnix's own JSON, so the page's board menu has something to switch between:
  // the spell checker's plan (three labelled boxes and a freehand underline) and an SN2 sketch.
  const box = (id: string, text: string, x: number, yy: number) => ({ id, type: 'geometry', shape: 'rectangle', angle: 0, opacity: 1, points: [[x, yy], [x + 180, yy + 70]], text: { children: [{ text }], type: 'paragraph', align: 'center' } });
  const whiteboards: Whiteboard[] = [
    { id: 'wb-spell', name: 'Spell checker plan', updated: at(3, 20), viewport: { zoom: 1 },
      elements: [box('wb-box-1', 'Trie of words', 0, 0), box('wb-box-2', 'Edit distance', 260, 0), box('wb-box-3', 'Top 3 suggestions', 130, 140), { id: 'wb-stroke-1', type: 'freehand', shape: 'feltTipPen', points: [[130, 230], [200, 238], [310, 226]] }] },
    { id: 'wb-sn2', name: 'SN2 backside attack', updated: at(8, 16), viewport: { zoom: 1 },
      elements: [box('wb-sn2-1', 'Nucleophile', 0, 0), box('wb-sn2-2', 'Inverted product', 320, 0)] },
  ];

  const todayLayout: TodayWidget[] = [{ id: 'todos', size: 'wide' }, { id: 'streak', size: 'sm' }, { id: 'stages', size: 'sm' }, { id: 'projects', size: 'tall' }, { id: 'board', size: 'wide' }, { id: 'goals', size: 'sm' }, { id: 'misc', size: 'sm' }, { id: 'activity', size: 'wide' }];

  const message = (id: string, role: 'user' | 'assistant', content: string, created: string) => ({ id, role, content, created, ...(role === 'assistant' ? { provider: 'claude', model: 'sample-model' } : {}) });
  const conversations: Conversation[] = [
    { id: 'chat-heap', title: 'Why is build heap O(n)?', updated: at(2, 19, 5), messages: [message('m-h-1', 'user', 'Why is building a heap O(n) and not O(n log n)?', at(2, 19)), { ...message('m-h-2', 'assistant', 'Most nodes sit near the bottom. Half the nodes are leaves and never move, a quarter move at most one level, and so on. The sum n/4 + 2n/8 + 3n/16 + ... converges to n, so the total work is linear.', at(2, 19, 1)), trace: { runId: 'run-sample-1', model: 'sample-model', duration: 2140, spans: [{ id: 'sp-1', label: 'Answer', start: 0, end: 2140, kind: 'agent' as const, status: 'ok' as const }, { id: 'sp-2', label: 'Brain search', start: 20, end: 310, kind: 'tool' as const, status: 'ok' as const, parentId: 'sp-1', detail: 'heaps' }, { id: 'sp-3', label: 'Model call', start: 330, end: 2120, kind: 'model' as const, status: 'ok' as const, parentId: 'sp-1', tokensIn: 812, tokens: 96 }] } }, message('m-h-3', 'user', 'So sift down from the middle, not sift up from the start?', at(2, 19, 4)), message('m-h-4', 'assistant', 'Exactly. Sifting up from the start would be O(n log n), because the deep nodes are the ones doing the long trips.', at(2, 19, 5))] },
    { id: 'chat-email', title: 'Email to ask about summer research', updated: at(6, 21, 2), messages: [message('m-e-1', 'user', 'Help me write a short email asking my rotation PI about the summer program.', at(6, 21)), message('m-e-2', 'assistant', 'Subject: Summer research in the lab\n\nHi Dr. Okafor,\n\nI have really enjoyed the rotation, especially working on the recrystallization yields. I would love to keep going over the summer. Is there a chance of a spot, and what should I do to apply?\n\nThank you,\nSam', at(6, 21, 2))] },
  ];

  const generations: Generation[] = [{ id: 'gen-1', prompt: 'A flat illustration of a sunset over rolling hills, warm colours, for a study playlist cover', provider: 'gemini', model: 'sample-image-model', aspect: '16:9', created: at(5, 22), status: 'complete', images: [SUNSET_PNG] }];

  const relations: Relation[] = [
    { id: 'rel-1', source: 'doc:doc-idea-flash', target: 'doc:doc-orgo-sn', relation: 'references', created: at(7, 23) },
    { id: 'rel-2', source: 'doc:doc-idea-flash', target: 'doc:doc-cs-heaps', relation: 'related_to', created: at(7, 23) },
    { id: 'rel-3', source: 'doc:doc-cs-p2', target: 'goal:goal-gpa', relation: 'supports', created: at(6, 14) },
    { id: 'rel-4', source: 'doc:doc-lab-log', target: 'doc:doc-skill-lab', relation: 'uses_skill', created: at(3, 17) },
  ];

  // Activity for the heat calendar: sixteen weeks of it, busier lately, on the pages the log may name.
  const PAGES: [Page, string][] = [['today', 'Finished a todo'], ['board', 'Moved a card'], ['network', 'Opened the map'], ['goals', 'Ticked a milestone'], ['chat', 'Asked a question'], ['skills', 'Ran a skill']];
  const activity: Activity[] = [];
  for (let ago = 0; ago < 16 * 7; ago++) {
    const busy = ago < 21 ? 1 + Math.floor(random() * 5) : random() < 0.55 ? Math.floor(random() * 3) : 0;
    for (let i = 0; i < busy; i++) { const [page, text] = pick(PAGES); activity.push({ id: `act-${ago}-${i}`, text, page, created: at(ago, 8 + i * 2, Math.floor(random() * 60)) }); }
  }

  return {
    version: 1, docs, goals, conversations, generations, activity, relations, board, todos, buyList, misc, resume, whiteboards, currentWhiteboard: 'wb-spell', todayLayout, notebooks,
    favorites: { skills: ['doc-skill-lab'], projects: ['~/code/spell-checker'], review: [] },
  };
}
