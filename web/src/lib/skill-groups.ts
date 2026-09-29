// Which shelf a skill sits on in the Skills page. Skills are folders with no category of their own, so
// this is a curated map by slug; a family (caveman-*, ponytail-*) is matched by its prefix, and anything
// unknown lands on "Other" rather than vanishing. Keep the order: it is the order the shelves show in.
export type SkillGroup = { id: string; title: string; blurb: string };
export const SKILL_GROUPS: SkillGroup[] = [
  { id: 'brevity', title: 'Shorter answers', blurb: 'Compress what Claude says or writes.' },
  { id: 'workflow', title: 'How code gets changed', blurb: 'Rules and loops for editing, reviewing and verifying code.' },
  { id: 'design', title: 'Design and UI', blurb: 'Interfaces, motion, brand and visual references.' },
  { id: 'documents', title: 'Documents and diagrams', blurb: 'Files Claude can produce: slides, PDFs, Office, diagrams.' },
  { id: 'science', title: 'Chemistry and data', blurb: 'Molecules, plots and figures.' },
  { id: 'writing', title: 'Writing', blurb: 'Editing prose so it reads as yours.' },
  { id: 'media', title: 'Images and video', blurb: 'Generation and rendering.' },
  { id: 'browser', title: 'Browser and computer', blurb: 'Driving Chrome, the desktop browser, and running the app.' },
  { id: 'os', title: 'This second brain', blurb: 'Memory, routines, upkeep and the skills that manage skills.' },
  { id: 'other', title: 'Other', blurb: 'Not shelved yet.' },
];
const BY_SLUG: Record<string, string> = {
  bro: 'brevity', 'i-have-adhd': 'brevity',
  'karpathy-guidelines': 'workflow', 'investigate-first': 'workflow', 'lean-build': 'workflow', migration: 'workflow', 'safe-refactor': 'workflow', 'surgical-patch': 'workflow', 'verify-and-stop': 'workflow', 'code-review': 'workflow', simplify: 'workflow', 'security-review': 'workflow', cavecrew: 'workflow', dcg: 'workflow', 'gauntlet-loop': 'workflow', calibrate: 'workflow', 'independent-review-loop': 'workflow', 'grill-me': 'workflow',
  'frontend-design': 'design', 'ui-styling': 'design', 'ui-ux-pro-max': 'design', design: 'design', 'design-md': 'design', 'design-system': 'design', 'sticker-ui': 'design', 'mobile-ui': 'design', 'canvas-effects': 'design', 'layered-motion': 'design', 'banner-design': 'design', brand: 'design', 'canvas-design': 'design',
  docx: 'documents', pdf: 'documents', pptx: 'documents', xlsx: 'documents', slides: 'documents', 'marp-slides': 'documents', archify: 'documents', 'diagram-html': 'documents', 'artifact-design': 'documents', 'artifact-diagramming': 'documents', 'artifact-capabilities': 'documents', docs: 'documents',
  'chem-vis': 'science', datamol: 'science', rdkit: 'science', matplotlib: 'science', 'scientific-visualization': 'science', dataviz: 'science',
  humanizer: 'writing', 'no-ai-slop': 'writing', 'technical-instructions': 'writing',
  generate: 'media', 'hyperframes-helper': 'media',
  'chrome-browser': 'browser', 'built-in-browser': 'browser', 'claude-in-chrome': 'browser', 'computer-use': 'browser', run: 'browser',
  arms: 'os', brain: 'os', 'clean-up': 'os', morning: 'os', 'doctor-plus': 'os', 'import-memory': 'os', learn: 'os', 'skill-creator': 'os', 'skill-reviewer': 'os', 'skill-inspector': 'os', 'update-config': 'os', 'keybindings-help': 'os', init: 'os', 'fewer-permission-prompts': 'os', loop: 'os', schedule: 'os', 'deep-research': 'os', 'claude-api': 'os', 'workflow-authoring': 'os',
};
const BY_PREFIX: [string, string][] = [['caveman', 'brevity'], ['ponytail', 'brevity'], ['artifact-', 'documents'], ['figma', 'design']];
export function skillGroup(slug: string): string {
  const bare = slug.replace(/^[^:]+:/, ''); // a synced plugin skill may carry its plugin as a prefix
  return BY_SLUG[bare] ?? BY_PREFIX.find(([prefix]) => bare.startsWith(prefix))?.[1] ?? 'other';
}
