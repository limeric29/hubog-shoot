'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { api, transcribe } from '@/lib/client/api';
import { cutout, fitShot, loadPhoto, onWhite, placeOnScene, type Photo } from '@/lib/client/image';
import { Recorder } from '@/lib/client/voice';
import { dataUrlBytes, zip } from '@/lib/client/zip';
import type { Mask, Plan, Shot, Verdict } from '@/lib/types';
import { FixCutout } from './fix-cutout';
import { ShotCard, type ShotState } from './shot-card';
import { Icon } from './icon';
import { PackPreview } from './pack-preview';
import styles from './studio.module.css';

type Stage = 'brief' | 'planning' | 'results';
type Mic = 'idle' | 'recording' | 'transcribing';
type TurnstileId = string;

type Turnstile = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    action: string;
    size?: 'normal' | 'flexible' | 'compact';
    callback: (token: string) => void;
    'expired-callback'?: () => void;
    'error-callback'?: () => void;
  }) => TurnstileId;
  reset: (id: TurnstileId) => void;
  remove?: (id: TurnstileId) => void;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

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

export function Studio({ turnstileEnabled, turnstileSiteKey }: { turnstileEnabled: boolean; turnstileSiteKey: string }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
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
  const [copied, setCopied] = useState('');
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const turnstileId = useRef<TurnstileId | null>(null);
  const recorder = useRef(new Recorder());
  // The real cutout, ready once the main image is done. The fallback for a failed scene waits on it.
  const cutReady = useRef<Promise<HTMLCanvasElement | null>>(Promise.resolve(null));

  const hasPlanQuestion = Boolean(plan?.question);
  const showTurnstile = turnstileEnabled && (stage !== 'results' || hasPlanQuestion);

  useEffect(() => {
    if (!showTurnstile || !turnstileSiteKey || !turnstileReady || !turnstileContainer.current || !window.turnstile) return;
    turnstileId.current = window.turnstile.render(turnstileContainer.current, {
      sitekey: turnstileSiteKey,
      action: 'shoot',
      size: hasPlanQuestion ? 'compact' : 'normal',
      callback: (token) => {
        setTurnstileToken(token);
        setTurnstileError('');
      },
      'expired-callback': () => {
        setTurnstileToken('');
        setTurnstileError('Verification expired. Complete it again to continue.');
      },
      'error-callback': () => {
        setTurnstileToken('');
        setTurnstileError('Verification could not load. Refresh the page and try again.');
      },
    });

    return () => {
      if (turnstileId.current !== null) window.turnstile?.remove?.(turnstileId.current);
      turnstileId.current = null;
      setTurnstileToken('');
    };
  }, [showTurnstile, stage, hasPlanQuestion, turnstileReady, turnstileSiteKey]);

  const patch = (id: string, next: Partial<ShotState>) => setShots((all) => ({ ...all, [id]: { ...all[id], ...next } }));

  async function onFile(file?: File) {
    if (!file) return;
    setError('');
    setPhotoLoading(true);
    try {
      setPhoto(await loadPhoto(file));
    } catch (err) {
      setError(message(err));
    } finally {
      setPhotoLoading(false);
    }
  }

  function resetTurnstile() {
    const id = turnstileId.current;
    if (id !== null && window.turnstile) window.turnstile.reset(id);
    setTurnstileToken('');
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
    if (turnstileEnabled && !turnstileSiteKey) {
      setError('Photo verification is not available yet. Please try again later.');
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      setError('Complete the quick verification before making your photos.');
      return;
    }
    setError('');
    setStage('planning');
    try {
      const p = await api<Plan>('/api/plan', { photo: photo.url, brief, turnstileToken: turnstileEnabled ? turnstileToken : undefined });
      setPlan(p);
      setAnswer('');
      setCopied('');
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
    } finally {
      resetTurnstile();
    }
  }

  /** Re-plans with the seller's answer, keeping every image and redrawing headlines for free. */
  async function sendAnswer() {
    if (!photo || !plan || !answer.trim()) return;
    if (turnstileEnabled && !turnstileToken) {
      setError('Complete the quick verification before updating your listing.');
      return;
    }
    setUpdating(true);
    setError('');
    try {
      const next = await api<Plan>('/api/plan', { photo: photo.url, brief, answer, turnstileToken: turnstileEnabled ? turnstileToken : undefined });
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
      setCopied('');
      for (const s of merged.shots) {
        const raw = shots[s.id]?.raw;
        if (raw && s.headline) patch(s.id, { image: await fitShot(raw, s.aspect, s.headline) });
      }
      setAnswer('');
    } catch (err) {
      setError(message(err));
    } finally {
      setUpdating(false);
      resetTurnstile();
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setError('Could not copy the text. Select it and copy it manually.');
    }
  }

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
      'Images marked "AI-generated scene" use an AI-made background. The main photo and any "original product" image use pixels from your own photo.',
      'Made with Hubog Shoot.',
    ].join('\n');
    files.push({ name: 'listing.txt', data: new TextEncoder().encode(text) });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(zip(files));
    a.download = `${slug(plan.product.name)}-hubog-pack.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }

  const currentStep = stage === 'brief' ? 0 : stage === 'planning' || !settled ? 1 : 2;

  return (
    <div className={styles.app}>
      <a href="#studio" className={styles.skipLink}>Skip to studio</a>
      {turnstileEnabled && turnstileSiteKey && <Script id="turnstile" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setTurnstileReady(true)} onError={() => setTurnstileError('Verification could not load. Refresh the page and try again.')} />}
      <header className={styles.header}>
        <div className={styles.brand} role="img" aria-label="Hubog Shoot">
          {/* Keep the original Hubog lockup unchanged; Shoot is a separate descriptor. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/hubog-lockup-light-240.png" alt="" width="240" height="73" className={styles.brandLogo} />
          <span className={styles.shootDescriptor} aria-hidden="true">shoot<svg viewBox="0 0 72 34" preserveAspectRatio="none" aria-hidden="true"><path d="M1 9V2a1 1 0 0 1 1-1h7m54 0h7a1 1 0 0 1 1 1v7M1 25v7a1 1 0 0 0 1 1h7m54 0h7a1 1 0 0 0 1-1v-7" /></svg></span>
        </div>
        <ol className={styles.steps} aria-label="Your progress">
          {['Add a photo', 'Make photos', 'Download'].map((label, i) => (
            <li key={label} className={`${styles.step} ${i === currentStep ? styles.currentStep : ''} ${i < currentStep ? styles.completedStep : ''}`} aria-current={i === currentStep ? 'step' : undefined}>
              <span className={styles.stepMarker}>{i < currentStep ? <Icon name="check" width="13" height="13" /> : i + 1}</span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <span className={styles.headerNote}>Product photos for your shop.</span>
      </header>

      <main id="studio" className={styles.main}>
        <div className={styles.intro}>
          <h1>{stage === 'results' ? settled ? readyCount > 0 ? 'Your photos are ready.' : 'The shoot is finished.' : 'Your shoot is underway.' : <>Start with a photo<br />of your product.</>}</h1>
          <p>{stage === 'results' ? 'Download each photo as it’s ready. Your listing text is here too.' : 'Make product photos, captions, and listing text for your shop.'}</p>
        </div>

        {error && <p role="alert" className={styles.error}>{error}</p>}

        {stage !== 'results' && (
          <div className={styles.workspace}>
            <section className={styles.briefPanel} aria-label="Set up your shoot" aria-busy={stage === 'planning'}>
              <div className={styles.fieldHeading}>
                <span className={styles.fieldNumber}>1</span>
                <h2>Product photo</h2>
                {photo && <span className={styles.added}><Icon name="check" width="14" height="14" /> Added</span>}
              </div>
              <label className={`${styles.upload} ${photo ? styles.uploadFilled : ''}`} aria-busy={photoLoading}>
                <input type="file" accept="image/*,.heic,.heif" className="sr-only" disabled={stage === 'planning' || photoLoading} aria-label={photo ? 'Change product photo' : 'Choose a product photo'} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
                {photo ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt="Your product" className={styles.uploadedPhoto} />
                    <span className={styles.changePhoto}>{photoLoading ? <span className={styles.spinner} /> : <Icon name="photo" width="16" height="16" />}{photoLoading ? 'Preparing photo…' : 'Change photo'}</span>
                  </>
                ) : (
                  <>
                    <span className={styles.uploadIcon}>{photoLoading ? <span className={styles.spinner} /> : <Icon name="upload" width="25" height="25" />}</span>
                    <strong>{photoLoading ? 'Preparing your photo…' : 'Take or choose a photo'}</strong>
                    <span className={styles.uploadHint}>Take a new photo or choose one from your phone.</span>
                    {!photoLoading && <span className={styles.choosePhoto}>Choose a photo</span>}
                    <span className={styles.fileTypes}>Use a clear photo showing the whole product. JPG, PNG, WebP, HEIC, or HEIF.</span>
                  </>
                )}
              </label>

              <div className={styles.fieldHeading}>
                <span className={styles.fieldNumber}>2</span>
                <h2><label htmlFor="product-brief">Product details</label></h2>
                <span className={styles.optional}>Optional</span>
              </div>
              <div className={styles.briefInput}>
                <textarea id="product-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} maxLength={1500} disabled={stage === 'planning'} placeholder="Homemade calamansi juice, 300ml, ₱120. Walang preservatives." aria-describedby="brief-help" />
                <button type="button" onClick={() => void toggleMic()} disabled={mic === 'transcribing' || stage === 'planning'} aria-label={mic === 'recording' ? 'Stop recording' : 'Speak instead of typing'} aria-pressed={mic === 'recording'} className={`${styles.micButton} ${mic === 'recording' ? styles.recording : ''}`}>
                  {mic === 'transcribing' ? <span className={styles.spinner} /> : <Icon name={mic === 'recording' ? 'stop' : 'mic'} width="18" height="18" />}
                </button>
              </div>
              <p id="brief-help" className={styles.helper} role="status">
                {mic === 'recording' ? 'Listening. Tap stop when you’re done.' : mic === 'transcribing' ? 'Transcribing…' : 'Add a few details or tap the mic. English, Filipino, or Taglish.'}
              </p>
              {showTurnstile && (
                <div className={styles.verification}>
                  {turnstileSiteKey ? <div ref={turnstileContainer} className={styles.turnstileWidget} /> : <p role="status">Photo verification is not available right now.</p>}
                  {turnstileError && <p role="alert">{turnstileError}</p>}
                  {!turnstileError && turnstileSiteKey && !turnstileToken && <p>Complete the security check to continue.</p>}
                </div>
              )}
              <button type="button" disabled={!photo || photoLoading || (turnstileEnabled && (!turnstileSiteKey || !turnstileToken)) || stage === 'planning' || mic !== 'idle'} onClick={() => void start()} className={styles.primaryButton}>
                {stage === 'planning' ? <span className={styles.spinner} /> : <Icon name="camera" />}
                {stage === 'planning' ? 'Planning your shoot…' : 'Make my photos'}
              </button>
              <p className={styles.actionNote} role="status">{stage === 'planning' ? 'Getting your photos ready…' : !turnstileEnabled || turnstileToken ? 'You’ll get a main photo, a few scenes, a close-up, and a promo.' : 'Complete the check before making your photos.'}</p>
            </section>
            <PackPreview />
          </div>
        )}

        {stage === 'results' && plan && photo && (
          <>
            <section className={styles.resultsSummary} aria-label="Your shoot">
              <div className={styles.productSummary}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="Your original product photo" width="72" height="72" />
                <div><p className={styles.summaryLabel}>Your product</p><h2>{plan.product.name}</h2>{plan.product.label_text && <p className={styles.labelText}>Label reads: {plan.product.label_text}</p>}</div>
              </div>
              <div className={styles.packAction}>
                <button type="button" disabled={!settled || readyCount === 0} onClick={downloadPack} className={styles.primaryButton}>
                  {settled ? <Icon name="download" /> : <span className={styles.spinner} />}
                  {settled ? `Download the pack (${readyCount} photos + listing)` : `Shooting your photos… ${readyCount} of ${plan.shots.length} ready`}
                </button>
                <p>{settled ? readyCount > 0 ? 'The ZIP includes your photos and listing text.' : 'No photos are ready yet. Try making a failed photo again below.' : 'We check each photo against your original.'}</p>
              </div>
            </section>

            <div className={styles.resultsLayout}>
              <section className={styles.gallery} aria-label="Your photos">
                <div className={styles.sectionHeading}><h2>Your photos</h2><span role="status">{readyCount} of {plan.shots.length} ready</span></div>
                <div className={styles.shotGrid}>
                  {plan.shots.map((shot) => (
                    <ShotCard
                      key={shot.id}
                      shot={shot}
                      state={shots[shot.id] ?? { status: 'queued' }}
                      fileName={slug(plan.product.name)}
                      onRedo={() => void (shot.kind === 'main' ? makeMain(photo, plan) : shootOne(photo, plan, shot, brief))}
                      onFix={shot.kind === 'main' ? () => setFixing(true) : undefined}
                    />
                  ))}
                </div>
              </section>

              <aside className={styles.listingSidebar} aria-label="Listing details">
                {plan.question && (
                  <section className={styles.questionPanel}>
                    <h2>One quick detail</h2>
                    <label htmlFor="seller-answer">{plan.question}</label>
                    <div className={styles.answerRow}>
                      <input id="seller-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={updating} placeholder="Your answer" />
                      <button type="button" disabled={updating || !answer.trim() || (turnstileEnabled && !turnstileToken)} onClick={() => void sendAnswer()} className={styles.smallPrimary}>{updating ? 'Updating…' : 'Update'}</button>
                    </div>
                    {showTurnstile && turnstileSiteKey && <div ref={turnstileContainer} className={`${styles.turnstileWidget} ${styles.compactTurnstile}`} />}
                    {turnstileError && <p role="alert">{turnstileError}</p>}
                    {turnstileEnabled && !turnstileError && !turnstileToken && <p>Complete the security check to continue.</p>}
                    <p>We’ll update your listing and the text on your photos.</p>
                  </section>
                )}
                <section className={styles.listingPanel}>
                  <div className={styles.listingHeading}><Icon name="copy" /><h2>Your listing</h2></div>
                  <p className={styles.listingHint}>Copy these into your shop listing.</p>
                  {[
                    ['Title', plan.listing.title],
                    ['Description', plan.listing.description],
                    ['Hashtags', plan.listing.hashtags.map((h) => `#${h}`).join(' ')],
                  ].map(([label, value]) => (
                    <div key={label} className={styles.listingField}>
                      <div className={styles.listingFieldHeading}><h3>{label}</h3><button type="button" onClick={() => void copy(value, label)} aria-label={`Copy ${label.toLowerCase()}`} className={styles.copyButton}><Icon name={copied === label ? 'check' : 'copy'} width="14" height="14" />{copied === label ? 'Copied' : 'Copy'}</button></div>
                      <p>{value}</p>
                    </div>
                  ))}
                  <span className="sr-only" role="status">{copied ? `${copied} copied to clipboard.` : ''}</span>
                </section>
                <button type="button" disabled={!settled} onClick={() => setStage('brief')} className={styles.startAgain}><Icon name="refresh" width="17" height="17" />Make photos for another product</button>
              </aside>
            </div>
          </>
        )}

        {fixing && photo && <FixCutout photo={photo} initial={mask} onClose={() => setFixing(false)} onApply={(m) => { setFixing(false); void applyMask(photo, m); }} />}
      </main>

      <footer className={styles.footer}>
        <p>A photo tool by Hubog for small sellers.</p>
        <p>We mark AI-generated scenes. The main product photo comes from your original photo.</p>
        <details><summary>How it works</summary><p>Add a product photo and a few details. Hubog Shoot makes product images and listing text for your shop.</p></details>
      </footer>
    </div>
  );
}
