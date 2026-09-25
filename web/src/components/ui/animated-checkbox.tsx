// AnimatedCheckbox: a real <input type="checkbox"> (so it is keyboard and screen reader native)
// drawn as a box whose tick is stroked in when checked. Props:
//   checked, onChange: the input's own
//   label: the accessible name, usually the todo's text
//   disabled: a read-only history row
import type { ChangeEvent } from 'react';

export function AnimatedCheckbox({ checked, onChange, label, disabled }: { checked: boolean; onChange?: (event: ChangeEvent<HTMLInputElement>) => void; label: string; disabled?: boolean }) {
  return <label className="acheck">
    <input type="checkbox" className="sr-only" checked={checked} onChange={onChange ?? (() => {})} aria-label={label} disabled={disabled}/>
    <span className="acheck-box" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
  </label>;
}
