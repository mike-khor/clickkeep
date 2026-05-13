import { SessionPanel } from './components/SessionPanel.js';
import { SoloMetronome } from './components/SoloMetronome.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { COPY } from './copy/strings.js';

export function App(): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-ink-200 dark:border-ink-800 px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight">{COPY.appName}</h1>
          <p className="hidden sm:block text-sm text-ink-500 dark:text-ink-400">{COPY.tagline}</p>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 flex-col-reverse lg:flex-row items-center justify-center gap-12 px-6 py-12">
        <SoloMetronome />
        <SessionPanel />
      </main>

      <footer className="border-t border-ink-200 dark:border-ink-800 px-6 py-3 text-xs text-ink-500 dark:text-ink-400">
        Group sync uses your local clock offset to the session host — synchronized clicks across devices land in v1.1.
      </footer>
    </div>
  );
}
