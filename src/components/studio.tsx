'use client';

import { useRef, useState } from 'react';
import { api, transcribe } from '@/lib/client/api';
import { cutout, fitShot, loadPhoto, onWhite, placeOnScene, type Photo } from '@/lib/client/image';
import { Recorder } from '@/lib/client/voice';
import { dataUrlBytes, zip } from '@/lib/client/zip';
import type { Mask, Plan, Shot, Verdict } from '@/lib/types';
import { FixCutout } from './fix-cutout';
import { ShotCard, type ShotState } from './shot-card';

type Stage = 'brief' | 'planning' | 'results';
type Mic = 'idle' | 'recording' | 'transcribing';

const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Please try again.');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'product';

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await fn(item);
    }),
  );
}

export function Studio() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [brief, setBrief] = useState('');
  const [stage, setStage] = useState<Stage>('brief');
  const [mic, setMic] = useState<Mic>('idle');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [shots, setShots] = useState<Record<string, ShotState>>({});
  const [mask, setMask] = useState<Mask | null>(null);
  const [fixing, setFixing] = useState(false);
  const [answer, setAnswer] = useState('');
  const [updating, setUpdating] = useState(false);
  const recorder = useRef(new Recorder());
  // The real cutout, ready once the main image is done. The fallback for a failed scene waits on it.
  const cutReady = useRef<Promise<HTMLCanvasElement | null>>(Promise.resolve(null));

  const patch = (id: string, next: Partial<ShotState>) => setShots((all) => ({ ...all, [id]: { ...all[id], ...next } }));

  async function onFile(file?: File) {
    if (!file) return;
    setError('');
    try {
      setPhoto(await loadPhoto(file));
    } catch (err) {
      setError(message(err));
    }
  }

  async function toggleMic() {
    setError('');
    try {
      if (mic === 'idle') {
        await recorder.current.start();
        setMic('recording');
      } else if (mic === 'recording') {
        setMic('transcribing');
        const text = await transcribe(await recorder.current.stop());
        setBrief((b) => (b.trim() ? `${b.trim()} ${text}` : text));
        setMic('idle');
      }
    } catch (err) {
      setMic('idle');
      setError(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Allow the microphone to talk, or type instead.' : message(err));
    }
  }

  /** Cuts the real product out of the photo and builds the white-background main image from it. */
  async function applyMask(p: Photo, m: Mask): Promise<HTMLCanvasElement> {
    const cut = await cutout(p, m);
    const url = onWhite(cut);
    setMask(m);
    patch('main', {
      status: 'done',
      image: url,
      real: true,
      verdict: { pass: true, problems: [], seller_note: 'This is your real product, cut out of your own photo.' },
    });
    return cut;
  }

  async function makeMain(p: Photo, pl: Plan) {
    patch('main', { status: 'shooting' });
    cutReady.current = (async () => {
      try {
        const m = await api<Mask>('/api/segment', { image: p.url, width: p.width, height: p.height, phrase: pl.product.sam_phrase });
        return await applyMask(p, m);
      } catch (err) {
        patch('main', { status: 'failed', error: message(err) });
        return null;
      }
    })();
    await cutReady.current;
  }

  /** Shoots one scene, checks it against the real photo, and reshoots once if the product changed. */
  async function shootOne(p: Photo, pl: Plan, shot: Shot, sellerWords: string) {
    let problems: string[] = [];
    const rejected: { image: string; note: string }[] = [];
    patch(shot.id, { rejected: [], composite: false });
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        patch(shot.id, { status: attempt === 1 ? 'shooting' : 'redoing', error: undefined });
        const { image } = await api<{ image: string }>('/api/shoot', { photo: p.url, product: pl.product, shot, problems });
        patch(shot.id, { status: 'checking' });
        const fitted = await fitShot(image, shot.aspect);
        const verdict = await api<Verdict>('/api/check', { photo: p.url, image: fitted, product: pl.product, language: sellerWords });
        if (verdict.pass) {
          patch(shot.id, { status: 'done', raw: image, image: await fitShot(image, shot.aspect, shot.headline), verdict, real: false });
          return;
        }
        problems = verdict.problems;
        rejected.push({ image: fitted, note: verdict.seller_note });
        patch(shot.id, { verdict, rejected: [...rejected] });
      }
      // Two tries changed the product. Keep the scene, drop the product, and place the real cutout in it.
      patch(shot.id, { status: 'redoing', verdict: undefined });
      const cut = await cutReady.current;
      if (!cut) throw new Error('This scene kept changing your product, and the cutout is not ready to use instead.');
      const { image: scene } = await api<{ image: string }>('/api/shoot', { empty: true, product: pl.product, shot });
      patch(shot.id, {
        status: 'done',
        image: await placeOnScene(scene, shot.aspect, cut, shot.headline, shot.kind === 'detail' ? 0.75 : 0.5),
        real: true,
        composite: true,
        verdict: { pass: true, problems: [], seller_note: 'The scene kept changing your product, so your real cutout was placed on it instead.' },
      });
    } catch (err) {
      patch(shot.id, { status: 'failed', error: message(err) });
    }
  }

  async function start() {
    if (!photo) return;
    setError('');
    setStage('planning');
    try {
      const p = await api<Plan>('/api/plan', { photo: photo.url, brief });
      setPlan(p);
      setAnswer('');
      setShots(Object.fromEntries(p.shots.map((s) => [s.id, { status: 'queued' } as ShotState])));
      setMask(null);
      setStage('results');
      void makeMain(photo, p);
      void pool(
        p.shots.filter((s) => s.kind !== 'main'),
        3,
        (s) => shootOne(photo, p, s, brief),
      );
    } catch (err) {
      setError(message(err));
      setStage('brief');
    }
  }

  /** Re-plans with the seller's answer, keeping every image and redrawing headlines for free. */
  async function sendAnswer() {
    if (!photo || !plan || !answer.trim()) return;
    setUpdating(true);
    setError('');
    try {
      const next = await api<Plan>('/api/plan', { photo: photo.url, brief, answer });
      const merged: Plan = {
        ...plan,
        question: '',
        listing: next.listing,
        shots: plan.shots.map((s) => {
          const n = next.shots.find((x) => x.id === s.id);
          return n ? { ...s, caption: n.caption, headline: n.headline } : s;
        }),
      };
      setPlan(merged);
      for (const s of merged.shots) {
        const raw = shots[s.id]?.raw;
        if (raw && s.headline) patch(s.id, { image: await fitShot(raw, s.aspect, s.headline) });
      }
      setAnswer('');
    } catch (err) {
      setError(message(err));
    } finally {
      setUpdating(false);
    }
  }

  const copy = (text: string) => void navigator.clipboard?.writeText(text);

  const settled = plan ? plan.shots.every((s) => ['done', 'failed'].includes(shots[s.id]?.status ?? '')) : false;
  const readyCount = plan ? plan.shots.filter((s) => shots[s.id]?.status === 'done').length : 0;

  /** One zip with every finished image, named by platform, and the listing text to paste. */
  function downloadPack() {
    if (!plan) return;
    const files = plan.shots.flatMap((s, i) => {
      const image = shots[s.id]?.image;
      return image ? [{ name: `${i + 1}-${s.platform}-${s.id}.jpg`, data: dataUrlBytes(image) }] : [];
    });
    const text = [
      plan.listing.title,
      '',
      plan.listing.description,
      '',
      plan.listing.hashtags.map((h) => `#${h}`).join(' '),
      '',
      'Captions',
      ...plan.shots.map((s) => `- ${s.title} (${s.platform}, ${s.aspect}): ${s.caption}`),
      '',
      'Images marked "AI-made scene" were generated by Muse Image. The main image and any "real product" image use pixels from your own photo.',
      'Made with Hubog Shoot.',
    ].join('\n');
    files.push({ name: 'listing.txt', data: new TextEncoder().encode(text) });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip(files));
    a.download = `${slug(plan.product.name)}-hubog-pack.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-16 pt-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Hubog Shoot</h1>
        <p className="mt-1 text-[var(--muted)]">One phone photo in, a listing pack out. Made for sellers on Shopee, Lazada, TikTok Shop and Facebook.</p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
          {error}
        </p>
      )}

      {stage !== 'results' && (
        <section className="flex flex-col gap-5">
          <div>
            <h2 className="mb-2 font-bold">1. Your product photo</h2>
            <label className="relative flex min-h-48 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-[var(--line)] bg-[var(--card)] p-4 text-center">
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="Your product" className="max-h-72 rounded-lg" />
              ) : (
                <span className="text-[var(--muted)]">
                  <strong className="block text-[var(--ink)]">Take or choose a photo</strong>
                  Any phone photo of the product works.
                </span>
              )}
            </label>
          </div>
          <div>
            <h2 className="mb-2 font-bold">2. Tell us about it</h2>
            <div className="relative">
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                maxLength={1500}
                placeholder="e.g. Homemade calamansi juice, 300ml, ₱120. Walang preservatives."
                className="w-full rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 pr-14"
              />
              <button
                type="button"
                onClick={() => void toggleMic()}
                disabled={mic === 'transcribing'}
                aria-label={mic === 'recording' ? 'Stop recording' : 'Speak instead of typing'}
                className={`absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-full text-lg text-white ${mic === 'recording' ? 'animate-pulse bg-red-600' : 'bg-[var(--ink)]'} disabled:opacity-50`}
              >
                {mic === 'transcribing' ? '…' : mic === 'recording' ? '■' : '🎙'}
              </button>
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {mic === 'recording' ? 'Listening. Tap the square when you are done.' : mic === 'transcribing' ? 'Writing down what you said…' : 'Type or tap the mic. English, Filipino or Taglish all work.'}
            </p>
          </div>
          <button
            type="button"
            disabled={!photo || stage === 'planning' || mic !== 'idle'}
            onClick={() => void start()}
            className="rounded-2xl bg-[var(--accent)] px-4 py-4 text-lg font-extrabold text-white disabled:opacity-50"
          >
            {stage === 'planning' ? 'Planning your shoot…' : 'Make my photos'}
          </button>
        </section>
      )}

      {stage === 'results' && plan && photo && (
        <>
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Your product</p>
            <h2 className="text-xl font-bold">{plan.product.name}</h2>
            {plan.product.label_text && <p className="text-sm text-[var(--muted)]">Label reads: {plan.product.label_text}</p>}
          </section>

          {plan.question && (
            <section className="rounded-2xl border border-[var(--accent)] bg-[var(--card)] p-4">
              <p className="font-semibold">{plan.question}</p>
              <div className="mt-2 flex gap-2">
                <input value={answer} onChange={(e) => setAnswer(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--line)] p-2" aria-label="Your answer" />
                <button type="button" disabled={updating || !answer.trim()} onClick={() => void sendAnswer()} className="rounded-lg bg-[var(--accent)] px-4 font-bold text-white disabled:opacity-50">
                  {updating ? '…' : 'Update'}
                </button>
              </div>
            </section>
          )}

          <button
            type="button"
            disabled={!settled || readyCount === 0}
            onClick={downloadPack}
            className="rounded-2xl bg-[var(--accent)] px-4 py-4 text-lg font-extrabold text-white disabled:opacity-50"
          >
            {settled ? `Download the pack (${readyCount} photos + listing)` : 'Shooting your photos…'}
          </button>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {plan.shots.map((shot) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                state={shots[shot.id] ?? { status: 'queued' }}
                fileName={slug(plan.product.name)}
                onRedo={() => void shootOne(photo, plan, shot, brief)}
                onFix={shot.kind === 'main' ? () => setFixing(true) : undefined}
              />
            ))}
          </section>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <h2 className="mb-2 text-lg font-bold">Your listing</h2>
            <div className="flex flex-col gap-3 text-sm">
              {[
                ['Title', plan.listing.title],
                ['Description', plan.listing.description],
                ['Hashtags', plan.listing.hashtags.map((h) => `#${h}`).join(' ')],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
                    <p>{value}</p>
                  </div>
                  <button type="button" onClick={() => copy(value)} className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-1 font-semibold">
                    Copy
                  </button>
                </div>
              ))}
            </div>
          </section>

          <button type="button" onClick={() => setStage('brief')} className="self-start rounded-lg border border-[var(--line)] px-4 py-2 font-semibold">
            Start with another product
          </button>
        </>
      )}

      {fixing && photo && (
        <FixCutout
          photo={photo}
          initial={mask}
          onClose={() => setFixing(false)}
          onApply={(m) => {
            setFixing(false);
            void applyMask(photo, m);
          }}
        />
      )}

      <footer className="mt-auto text-xs text-[var(--muted)]">
        Scenes marked AI-made are generated. Your real product photo is only ever cut out, never redrawn. Built for the Meta Global AI Developer Hackathon with Muse Spark, Muse Image, SAM 3.1 and Muse Voice Transcribe.
      </footer>
    </main>
  );
}
