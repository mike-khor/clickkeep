import { COPY } from '../copy/strings.js';
import { formatActivityTime, type ActivityEvent } from '../lib/session-activity.js';

interface Props {
  enabled: boolean;
  onToggleEnabled: () => void;
  events: readonly ActivityEvent[];
}

/**
 * Owner-only secondary affordance inside the Session sheet: a disclosure row
 * that, opted into, reveals a compact join/leave log. Collapsed (the
 * default) it's a single row indistinguishable from the rest of the sheet —
 * the busy default view is unaffected until the owner asks for this.
 */
export function MemberActivityLog({ enabled, onToggleEnabled, events }: Props): JSX.Element {
  return (
    <div className="rounded-xl border border-ink-200 dark:border-ink-700">
      <button
        type="button"
        onClick={onToggleEnabled}
        aria-expanded={enabled}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-medium text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"
      >
        <span>{COPY.session.activityToggle}</span>
        <ChevronIcon expanded={enabled} />
      </button>
      {enabled && (
        <div className="border-t border-ink-200 px-4 py-3 dark:border-ink-700">
          {events.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-ink-400">{COPY.session.activityEmpty}</p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
              {events
                .slice()
                .reverse()
                .map((e) => (
                  <li key={e.id} className="flex items-baseline gap-2 text-sm">
                    <span className="shrink-0 font-mono tabular-nums text-xs text-ink-400 dark:text-ink-500">
                      {formatActivityTime(e.atMs)}
                    </span>
                    <span className="text-ink-700 dark:text-ink-200">
                      {e.delta} {e.delta === 1 ? COPY.session.membersOne : COPY.session.membersMany}{' '}
                      {e.kind === 'joined' ? COPY.session.activityJoined : COPY.session.activityLeft}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['shrink-0 transition-transform', expanded ? 'rotate-180' : ''].join(' ')}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
