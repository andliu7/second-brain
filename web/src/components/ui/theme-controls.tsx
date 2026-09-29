// The two ways to change the theme: a one-click sun/moon in the top bar, and the full System / Light / Dark
// choice in Settings. Both read and write the one store in lib/theme.ts, so they can never disagree.
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePref } from '@/lib/theme';

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
export function ThemeChoice() {
  const { pref, setPref } = useTheme();
  return <fieldset className="theme-choice">
    <legend className="sr-only">Theme</legend>
    {CHOICES.map(({ value, label, icon: Icon }) => <label key={value} className="theme-option">
      <input type="radio" name="theme" value={value} checked={pref === value} onChange={() => setPref(value)}/>
      <span><Icon size={15}/>{label}</span>
    </label>)}
  </fieldset>;
}
