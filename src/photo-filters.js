/** Postcard filters for photo captures, as CSS filter strings for a 2D canvas. */
export const PHOTO_FILTERS = [
  { id: 'none', label: 'Original', css: 'none' },
  { id: 'golden', label: 'Godavari Golden', css: 'sepia(0.35) saturate(1.25) contrast(1.05) brightness(1.05)' },
  { id: 'monsoon', label: 'Monsoon', css: 'saturate(0.75) contrast(1.08) brightness(0.94) hue-rotate(8deg)' },
  { id: 'vivid', label: 'Bazaar Vivid', css: 'saturate(1.5) contrast(1.1)' },
  { id: 'mono', label: 'Old City Mono', css: 'grayscale(1) contrast(1.12)' },
];

export function nextPhotoFilter(id) {
  const index = PHOTO_FILTERS.findIndex(filter => filter.id === id);
  return PHOTO_FILTERS[(index + 1 + PHOTO_FILTERS.length) % PHOTO_FILTERS.length];
}

export function photoFilterCss(id) {
  return PHOTO_FILTERS.find(filter => filter.id === id)?.css || 'none';
}
