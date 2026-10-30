'use client';

import type { Shot, Verdict } from '@/lib/types';

export type ShotStatus = 'queued' | 'shooting' | 'checking' | 'redoing' | 'done' | 'failed';

export interface ShotState {
  status: ShotStatus;
  /** Final image, already cropped to shape with its headline drawn on. */
  image?: string;
  /** The generated image before cropping, kept so a new headline can be drawn without paying again. */
  raw?: string;
  /** True when the pixels are the seller's own photo, not generated. */
  real?: boolean;
  verdict?: Verdict;
  error?: string;
}

const LABEL: Record<ShotStatus, string> = {
  queued: 'Waiting',
  shooting: 'Shooting the scene',
  checking: 'Checking it is your product',
  redoing: 'Not quite right. Reshooting',
  done: 'Ready',
  failed: 'Could not match your product',
};

const ASPECT = { '1:1': '1 / 1', '4:5': '4 / 5', '9:16': '9 / 16' } as const;

export function ShotCard({ shot, state, fileName, onRedo, onFix }: { shot: Shot; state: ShotState; fileName: string; onRedo: () => void; onFix?: () => void }) {
  const busy = state.status === 'queued' || state.status === 'shooting' || state.status === 'checking' || state.status === 'redoing';
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3">
      <div className="relative overflow-hidden rounded-xl bg-[var(--line)]" style={{ aspectRatio: ASPECT[shot.aspect] }}>
        {state.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={state.image} alt={shot.title} className="h-full w-full object-cover" />
        ) : (
          <div className={`grid h-full w-full place-items-center p-4 text-center text-sm text-[var(--muted)] ${busy ? 'animate-pulse' : ''}`}>{state.error ?? LABEL[state.status]}</div>
        )}
        {state.status === 'done' && (
          <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-semibold text-white">{state.real ? 'Your real photo' : 'AI-made scene'}</span>
        )}
      </div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold leading-tight">{shot.title}</h3>
          <p className="text-xs uppercase tracking-wide text-[var(--muted)]">
            {shot.platform} · {shot.aspect}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${state.status === 'done' ? 'bg-green-100 text-green-900' : state.status === 'failed' ? 'bg-orange-100 text-orange-900' : 'bg-[var(--line)] text-[var(--muted)]'}`}>
          {state.status === 'done' ? (state.verdict?.pass || state.real ? '✓ Your product' : 'Ready') : LABEL[state.status]}
        </span>
      </div>
      {state.verdict?.seller_note && <p className="text-sm text-[var(--muted)]">{state.verdict.seller_note}</p>}
      {shot.caption && <p className="text-sm">{shot.caption}</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        {state.status === 'done' && state.image && (
          <a href={state.image} download={`${fileName}-${shot.id}.jpg`} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white">
            Download
          </a>
        )}
        {onFix && state.status === 'done' && (
          <button type="button" onClick={onFix} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold">
            Fix cutout
          </button>
        )}
        {!onFix && (state.status === 'done' || state.status === 'failed') && (
          <button type="button" onClick={onRedo} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold">
            {state.status === 'failed' ? 'Try again' : 'Reshoot'}
          </button>
        )}
      </div>
    </article>
  );
}
