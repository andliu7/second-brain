// The Drawnix board itself, kept in its own file so Whiteboard.tsx can load it with React.lazy: Drawnix,
// Plait and Slate come to several hundred kB, and only this page needs them. Nothing else imports this file.
import { Drawnix } from '@drawnix/drawnix';
import type { BoardChangeData } from '@plait-board/react-board';
import { ThemeColorMode, type PlaitElement, type Viewport } from '@plait/core';
import type { Drawing } from './types';
import { useTheme } from './lib/theme';
// The published packages (0.4.0-2) list no stylesheet in their "exports" map, so a bare
// '@drawnix/drawnix/index.css' does not resolve; the files are there, so they are imported by path.
import '../node_modules/@plait-board/react-text/index.css';
import '../node_modules/@plait-board/react-board/index.css';
import '../node_modules/@drawnix/drawnix/index.css';

// Drawnix 0.4.0-2 picks its interface language from localStorage 'language' and falls back to Chinese.
// Set English once, and leave any language chosen in Drawnix's own menu alone.
try { if (!localStorage.getItem('language')) localStorage.setItem('language', 'en'); } catch { /* storage blocked: Drawnix falls back on its own */ }

// The canvas follows the app theme: Plait's default (light) mode by day, its dark mode at night.
const MODES = { light: { themeColorMode: ThemeColorMode.default }, dark: { themeColorMode: ThemeColorMode.dark } };

// initial is read once: after mount Drawnix owns the board, and onChange reports every edit and pan.
// Drawnix's published props type onChange as its own handler AND a div's change handler, which no
// typed function satisfies, so the argument comes in as unknown and is read as the BoardChangeData it is.
export default function WhiteboardCanvas({ initial, onChange }: { initial?: Drawing; onChange: (drawing: Drawing) => void }) {
  const { theme } = useTheme();
  return <Drawnix
    value={(initial?.elements ?? []) as PlaitElement[]}
    viewport={initial?.viewport as Viewport | undefined}
    theme={MODES[theme]}
    onChange={(data: unknown) => { const { children, viewport } = data as BoardChangeData; onChange({ elements: children as Drawing['elements'], viewport: viewport as Drawing['viewport'] }); }}/>;
}
