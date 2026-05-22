import { useRef, useState } from 'react';
import { useMetronome } from '../lib/store.js';
import { formatTimeSec, parseTempoMap, type TempoMap } from '../lib/midi-tempo.js';
import { COPY } from '../copy/strings.js';
import { Sheet } from './Sheet.js';

/**
 * The MIDI tempo-map loader. Trigger pill in the toolbar opens the sheet.
 * Sheet contains a drop zone, parsed-file summary, and clear control.
 *
 * Parse-and-apply happens immediately on file drop (kept from the old inline
 * behaviour) so the flow is one decision: drop a file, see it's loaded, close
 * the sheet. Replace = drop another file. Clear = unload.
 */
export function MidiSheet({ disabled }: { disabled: boolean }): JSX.Element {
  const tempoMap = useMetronome((s) => s.tempoMap);
  const tempoMapName = useMetronome((s) => s.tempoMapName);
  const setTempoMap = useMetronome((s) => s.setTempoMap);
  const clearTempoMap = useMetronome((s) => s.clearTempoMap);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File): Promise<void> => {
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const map = parseTempoMap(buf);
      if (map.length === 0) {
        setError(COPY.tempoMap.empty);
        return;
      }
      setTempoMap(map, file.name);
    } catch {
      setError(COPY.tempoMap.parseError);
    }
  };

  const handleClear = (): void => {
    setError(null);
    clearTempoMap();
    if (fileInputRef.current !== null) fileInputRef.current.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file !== undefined) void handleFile(file);
  };

  const hasMap = tempoMap !== null && tempoMap.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={[
          'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium',
          hasMap
            ? 'border-accent bg-accent/15 text-accent-600 dark:text-accent'
            : 'border-ink-200 dark:border-ink-700 bg-transparent hover:bg-ink-100 dark:hover:bg-ink-800',
          'disabled:cursor-not-allowed disabled:opacity-50',
        ].join(' ')}
        aria-label={hasMap ? `${COPY.tempoMap.triggerLoaded}: ${tempoMapName ?? ''}` : COPY.tempoMap.trigger}
      >
        <MidiIcon />
        <span className="max-w-[8rem] truncate">
          {hasMap ? (tempoMapName ?? COPY.tempoMap.triggerLoaded) : COPY.tempoMap.trigger}
        </span>
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={COPY.tempoMap.title}
        subtitle={hasMap ? COPY.tempoMap.loaded : COPY.tempoMap.dropHint}
      >
        <div className="flex flex-col gap-4">
          {!hasMap && (
            <DropZone
              dragging={dragging}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onPick={() => fileInputRef.current?.click()}
            />
          )}

          {hasMap && tempoMap !== null && (
            <Summary name={tempoMapName} map={tempoMap} />
          )}

          {error !== null && (
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          )}

          <div className="flex gap-2">
            {hasMap ? (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 rounded-xl border border-ink-200 dark:border-ink-700 px-4 py-3 text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-800"
                >
                  {COPY.tempoMap.replace}
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-xl border border-ink-200 dark:border-ink-700 px-4 py-3 text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
                >
                  {COPY.tempoMap.clear}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 rounded-xl bg-accent text-ink-900 px-4 py-3 text-sm font-semibold hover:bg-accent-600"
              >
                {COPY.tempoMap.load}
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".mid,.midi,audio/midi,audio/x-midi"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) void handleFile(file);
            }}
          />
        </div>
      </Sheet>
    </>
  );
}

interface DropZoneProps {
  dragging: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPick: () => void;
}

function DropZone({ dragging, onDragOver, onDragLeave, onDrop, onPick }: DropZoneProps): JSX.Element {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onPick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      }}
      className={[
        'flex flex-col items-center justify-center gap-2',
        'rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer',
        'transition-colors',
        dragging
          ? 'border-accent bg-accent/10'
          : 'border-ink-300 dark:border-ink-600 hover:border-accent hover:bg-ink-100/50 dark:hover:bg-ink-800/50',
      ].join(' ')}
      aria-label={COPY.tempoMap.dropHint}
    >
      <UploadIcon />
      <div className="text-sm font-medium">{COPY.tempoMap.dropHint}</div>
      <div className="text-xs text-ink-500 dark:text-ink-400">.mid · .midi</div>
    </div>
  );
}

interface SummaryProps {
  name: string | null;
  map: TempoMap;
}

function Summary({ name, map }: SummaryProps): JSX.Element {
  const bpms = map.map((c) => c.bpm);
  const minBpm = Math.min(...bpms);
  const maxBpm = Math.max(...bpms);
  const lastTime = map[map.length - 1]?.timeSec ?? 0;
  const changes = map.length;
  return (
    <div className="rounded-2xl bg-ink-100 dark:bg-ink-800 p-4">
      {name !== null && (
        <div className="truncate text-base font-semibold text-ink-900 dark:text-ink-50">{name}</div>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <Stat label={COPY.tempoMap.summaryChanges} value={changes.toString()} />
        <Stat label={COPY.tempoMap.summaryLength} value={formatTimeSec(lastTime)} />
        <Stat
          label={COPY.tempoMap.summaryRange}
          value={
            minBpm === maxBpm
              ? `${minBpm.toFixed(0)}`
              : `${minBpm.toFixed(0)}–${maxBpm.toFixed(0)}`
          }
        />
      </dl>
      <details className="mt-4">
        <summary className="cursor-pointer text-xs uppercase tracking-widest text-ink-500 dark:text-ink-400">
          Timeline
        </summary>
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-ink-500 dark:text-ink-400">
          {map.map((entry, i) => (
            <li key={`${i}-${entry.timeSec}`} className="whitespace-nowrap">
              {formatTimeSec(entry.timeSec)} {String.fromCharCode(8594)} {entry.bpm.toFixed(1)}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-ink-500 dark:text-ink-400">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums text-ink-900 dark:text-ink-50">{value}</dd>
    </div>
  );
}

function MidiIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="9" width="18" height="9" rx="2.5" />
      <circle cx="7.5" cy="13.5" r="1" fill="currentColor" />
      <circle cx="12" cy="13.5" r="1" fill="currentColor" />
      <circle cx="16.5" cy="13.5" r="1" fill="currentColor" />
      <path d="M7 9 V6" />
      <path d="M17 9 V6" />
    </svg>
  );
}

function UploadIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="32"
      height="32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-500 dark:text-ink-400"
    >
      <path d="M12 4 V16" />
      <path d="M7 9 L12 4 L17 9" />
      <path d="M4 20 H20" />
    </svg>
  );
}
