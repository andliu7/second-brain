// ColorSwatches: Andrew's categories (lib/categories.ts) as a row of round colour buttons, plus one for
// "no category". Props:
//   value: the current category id, undefined for none
//   onChange(id): called with the picked category id, or undefined when "No category" is pressed
//   label: the accessible name of the row (default "Category")
// Each swatch is named after its category, so a screen reader hears "Urgent", not "red".
import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { CATEGORIES, type CategoryId } from '../../lib/categories';

export function ColorSwatches({ value, onChange, label = 'Category' }: { value?: CategoryId; onChange: (id?: CategoryId) => void; label?: string }) {
  return <div className="swatches" role="group" aria-label={label}>
    <button type="button" className="swatch none" aria-label="No category" aria-pressed={!value} title="No category" onClick={() => onChange(undefined)}>{!value && <Check size={12}/>}</button>
    {CATEGORIES.map(category => <button key={category.id} type="button" className="swatch" style={{ '--cat': category.color } as CSSProperties} aria-label={category.label} title={category.label} aria-pressed={value === category.id} onClick={() => onChange(category.id)}>{value === category.id && <Check size={12}/>}</button>)}
  </div>;
}
