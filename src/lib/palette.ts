// Validated reference palette (dataviz skill, palette.md): eight categorical
// slots stepped separately for the light and dark surfaces, assigned in this
// fixed order and never cycled. Colour follows the entity (a dataset keeps
// its slot no matter what is filtered).

export type ThemeMode = 'light' | 'dark';

export const CATEGORICAL: Record<ThemeMode, string[]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

/** Sequential blue ramp 100 -> 700 for magnitude (heatmaps). */
export const SEQUENTIAL_BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

export const CHROME: Record<ThemeMode, { surface: string; page: string; ink: string; ink2: string; muted: string; grid: string; axis: string; other: string }> = {
  light: { surface: '#fcfcfb', page: '#f9f9f7', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', other: '#b5b3ab' },
  dark: { surface: '#1a1a19', page: '#0d0d0d', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', other: '#5d5c57' },
};

/** Slot colour; past the eighth slot an entity falls back to the "other" grey. */
export function slotColor(slot: number, mode: ThemeMode): string {
  return slot >= 0 && slot < 8 ? CATEGORICAL[mode][slot] : CHROME[mode].other;
}
