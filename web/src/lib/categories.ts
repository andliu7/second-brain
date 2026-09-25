// Andrew's categories, the one palette every feature colours by. A card's colour tag is a category id.
// Keep the order: it is the order swatch rows show them in.
export type CategoryId = 'project' | 'family' | 'academic' | 'professional' | 'fitness' | 'relationships' | 'urgent' | 'other';
export type Category = { id: CategoryId; label: string; color: string };
export const CATEGORIES: Category[] = [
  { id: 'project', label: 'Project', color: '#8E24AA' },
  { id: 'family', label: 'Family', color: '#66BB6A' },
  { id: 'academic', label: 'Academic', color: '#1E88E5' },
  { id: 'professional', label: 'Professional', color: '#F57C00' },
  { id: 'fitness', label: 'Fitness', color: '#1565C0' },
  { id: 'relationships', label: 'Relationships', color: '#E67C73' },
  { id: 'urgent', label: 'Urgent', color: '#D32F2F' },
  { id: 'other', label: 'Other', color: '#FBC02D' },
];
export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
export const categoryOf = (id?: CategoryId) => CATEGORIES.find(c => c.id === id);
// Whether text on a solid fill of this colour should be dark (a light fill, like yellow) or light.
export const inkOn = (hex: string) => { const n = parseInt(hex.slice(1), 16); const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return lum > 0.6 ? '#1b1b1f' : '#ffffff'; };
