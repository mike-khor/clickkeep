export type Theme = 'light' | 'dark' | 'system';

const KEY = 'clickkeep:theme';

export function getStoredTheme(): Theme {
  const v = localStorage.getItem(KEY);
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

export function setStoredTheme(t: Theme): void {
  if (t === 'system') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, t);
  applyTheme(t);
}

export function applyTheme(t: Theme): void {
  const isDark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}
