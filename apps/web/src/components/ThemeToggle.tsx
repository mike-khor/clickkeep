import { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, setStoredTheme, type Theme } from '../lib/theme.js';

export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const handler = (): void => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const cycle = (): void => {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    setTheme(next);
    setStoredTheme(next);
  };

  const label = theme === 'light' ? '☀︎' : theme === 'dark' ? '☾' : '⌂';
  const aria = theme === 'light' ? 'Light theme' : theme === 'dark' ? 'Dark theme' : 'System theme';

  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-md border border-ink-200 dark:border-ink-700 px-3 py-1.5 text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
      aria-label={`Theme: ${aria}. Click to change.`}
    >
      {label}
    </button>
  );
}
