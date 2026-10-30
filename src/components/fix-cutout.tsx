'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { paintMask, type Photo } from '@/lib/client/image';
import type { Mask } from '@/lib/types';

interface Tap {
  x: number;
  y: number;
  negative: boolean;
}

/** Tap the product to add to the cutout, or tap what doesn't belong to take it out. SAM 3.1 redraws after every tap. */
export function FixCutout({ photo, initial, onApply, onClose }: { photo: Photo; initial: Mask | null; onApply: (mask: Mask) => void; onClose: () => void }) {
  const [taps, setTaps] = useState<Tap[]>([]);
  const [mask, setMask] = useState<Mask | null>(initial);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const overlay = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (overlay.current) paintMask(overlay.current, mask);
  }, [mask]);

  async function tap(e: React.PointerEvent<HTMLDivElement>) {
    if (busy) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(photo.width - 1, Math.floor(((e.clientX - rect.left) * photo.width) / rect.width)));
    const y = Math.max(0, Math.min(photo.height - 1, Math.floor(((e.clientY - rect.top) * photo.height) / rect.height)));
    const next = [...taps, { x, y, negative: remove }];
    setTaps(next);
    setBusy(true);
    setError('');
    try {
      setMask(await api<Mask>('/api/segment', { image: photo.url, width: photo.width, height: photo.height, points: next }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the cutout.');
      setTaps(taps);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Fix the cutout">
      <div className="flex max-h-full w-full max-w-lg flex-col gap-3 overflow-auto rounded-t-2xl bg-[var(--card)] p-4 sm:rounded-2xl">
        <div>
          <h2 className="text-lg font-bold">Fix the cutout</h2>
          <p className="text-sm text-[var(--muted)]">Tap your product to add to the green area. Switch to Remove and tap anything that should not be there.</p>
        </div>
        <div className="relative touch-none select-none overflow-hidden rounded-xl border border-[var(--line)]" onPointerDown={tap} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.url} alt="Your product photo" className="absolute inset-0 h-full w-full" draggable={false} />
          <canvas ref={overlay} width={photo.width} height={photo.height} className="pointer-events-none absolute inset-0 h-full w-full" />
          {taps.map((t, i) => (
            <span
              key={i}
              className={`pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${t.negative ? 'bg-red-500' : 'bg-green-600'}`}
              style={{ left: `${(t.x / photo.width) * 100}%`, top: `${(t.y / photo.height) * 100}%` }}
            />
          ))}
          {busy && <div className="absolute inset-0 grid place-items-center bg-black/20 text-sm font-semibold text-white">Updating…</div>}
        </div>
        {error && <p className="text-sm text-[var(--warn)]">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => setRemove(false)} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${remove ? 'border-[var(--line)]' : 'border-green-700 bg-green-700 text-white'}`}>
            Add
          </button>
          <button type="button" onClick={() => setRemove(true)} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${remove ? 'border-red-600 bg-red-600 text-white' : 'border-[var(--line)]'}`}>
            Remove
          </button>
          <button
            type="button"
            onClick={() => {
              setTaps([]);
              setMask(initial);
            }}
            className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold"
          >
            Reset
          </button>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-[var(--line)] px-3 py-3 font-semibold">
            Cancel
          </button>
          <button type="button" disabled={!mask || busy} onClick={() => mask && onApply(mask)} className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-3 font-bold text-white disabled:opacity-50">
            Use this cutout
          </button>
        </div>
      </div>
    </div>
  );
}
