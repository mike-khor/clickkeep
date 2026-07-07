import { SessionPanel } from './components/SessionPanel.js';
import { SoloMetronome } from './components/SoloMetronome.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { COPY } from './copy/strings.js';

export function App(): JSX.Element {
  return (
    <div className="flex min-h-[100svh] flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pb-4 sm:pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">{COPY.appName}</h1>
          <p className="hidden md:block text-sm text-ink-500 dark:text-ink-400">{COPY.tagline}</p>
        </div>
        <div className="flex items-center gap-2">
          <SessionPanel />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SoloMetronome />
      </main>
    </div>
  );
}
