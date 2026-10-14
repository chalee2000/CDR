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
  light: { surface: '#fcfcfb', page: '#eef1f6', ink: '#0e1626', ink2: '#4a5263', muted: '#7d8496', grid: '#e1e4ea', axis: '#c3c8d2', other: '#b3b8c3' },
  // Navy dark surface: the categorical slots were re-validated against #111b2e.
  dark: { surface: '#111b2e', page: '#0a1222', ink: '#e8edf6', ink2: '#b8c2d6', muted: '#8f9ab0', grid: '#1f2d47', axis: '#2e3d5a', other: '#5d6a82' },
};

/** Slot colour; past the eighth slot an entity falls back to the "other" grey. */
export function slotColor(slot: number, mode: ThemeMode): string {
  return slot >= 0 && slot < 8 ? CATEGORICAL[mode][slot] : CHROME[mode].other;
}
