import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /**
   * Optional sub-line under the title, e.g. live status.
   */
  subtitle?: ReactNode;
  children: ReactNode;
}

/**
 * Minimal disclosure surface. Bottom sheet on mobile, centered card on desktop.
 * Esc and backdrop click both dismiss. No portal — rendered inline at the end
 * of the document is sufficient when only one sheet is open at a time.
 *
 * NOTE: no focus trap. v1 trade-off; revisit if accessibility audit demands it.
 */
export function Sheet({ open, onClose, title, subtitle, children }: Props): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Move focus into the sheet on open so screen readers and keyboard users
    // land somewhere meaningful (the close button is first).
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus="true"]')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      aria-modal="true"
      role="dialog"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm motion-safe:animate-[fade-in_140ms_ease-out]"
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        className={[
          'relative w-full sm:w-[min(28rem,calc(100vw-2rem))]',
          'bg-ink-50 dark:bg-ink-900 text-ink-900 dark:text-ink-50',
          'border border-ink-200 dark:border-ink-700',
          'rounded-t-2xl sm:rounded-2xl',
          'shadow-2xl shadow-ink-900/20',
          'max-h-[88svh] overflow-y-auto',
          'p-5 sm:p-6',
          'motion-safe:animate-[sheet-rise_180ms_cubic-bezier(0.22,1,0.36,1)]',
        ].join(' ')}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight">{title}</h2>
            {subtitle !== undefined && (
              <div className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            data-autofocus="true"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-2 h-9 w-9 shrink-0 rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-50 flex items-center justify-center"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
