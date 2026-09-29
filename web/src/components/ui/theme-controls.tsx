// The two ways to change the theme: a one-click sun/moon in the top bar, and the full System / Light / Dark
// choice in Settings. Both read and write the one store in lib/theme.ts, so they can never disagree.
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '@/lib/theme';
import { useBackground, type BgMotion, type BgSpeed } from '@/lib/background';

// The top bar button flips what is on screen now. From System it pins the opposite of what the system shows,
// which is what a click on a sun or a moon means; Settings is where to go back to following the system.
export function ThemeButton() {
  const { theme, setPref } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return <button type="button" className="icon-button theme-button" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`} onClick={() => setPref(next)}>
    {theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}
  </button>;
}

const CHOICES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'System', icon: Monitor }, { value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon },
];

// Real radio inputs under the segmented look, so arrow keys move between the three and a screen reader
// hears "Theme, radio group".
// The background rows ride along under it because Settings renders ThemeChoice as its whole Appearance body.
export function ThemeChoice() {
  const { pref, setPref } = useTheme();
  return <>
    <fieldset className="theme-choice">
      <legend className="sr-only">Theme</legend>
      {CHOICES.map(({ value, label, icon: Icon }) => <label key={value} className="theme-option">
        <input type="radio" name="theme" value={value} checked={pref === value} onChange={() => setPref(value)}/>
        <span><Icon size={15}/>{label}</span>
      </label>)}
    </fieldset>
    <BackgroundChoice/>
  </>;
}

// One segmented radio row with a visible label; the legend carries the same name for a screen reader.
function Segmented<T extends string>({ label, name, value, options, onChange }: { label: string; name: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="background-row">
    <span className="background-row-label" aria-hidden="true">{label}</span>
    <fieldset className="theme-choice">
      <legend className="sr-only">{label}</legend>
      {options.map(([v, text]) => <label key={v} className="theme-option">
        <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)}/>
        <span>{text}</span>
      </label>)}
    </fieldset>
  </div>;
}

// The light theme's moving background (lib/background.ts, gradient-background.css). Speed only matters while
// it moves, so that row shows only for Animated.
export function BackgroundChoice() {
  const { motion, speed, setBackground } = useBackground();
  return <div className="background-choice">
    <Segmented<BgMotion> label="Background" name="background" value={motion} options={[['animated', 'Animated'], ['still', 'Still']]} onChange={v => setBackground({ motion: v })}/>
    {motion === 'animated' && <Segmented<BgSpeed> label="Speed" name="background-speed" value={speed} options={[['calm', 'Calm'], ['lively', 'Lively']]} onChange={v => setBackground({ speed: v })}/>}
    <p className="background-hint">Light theme only; dark keeps its still night glow. Always still when your system asks for reduced motion.</p>
  </div>;
}
