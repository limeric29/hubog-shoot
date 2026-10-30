'use client';

import type { Shot, Verdict } from '@/lib/types';
import { Icon } from './icon';
import styles from './shot-card.module.css';

export type ShotStatus = 'queued' | 'shooting' | 'checking' | 'redoing' | 'done' | 'failed';

export interface ShotState {
  status: ShotStatus;
  /** Final image, already cropped to shape with its headline drawn on. */
  image?: string;
  /** The generated image before cropping, kept so a new headline can be drawn without paying again. */
  raw?: string;
  /** True when the product's pixels are the seller's own photo, not generated. */
  real?: boolean;
  /** True when the real cutout was placed on a generated scene because the scenes kept changing the product. */
  composite?: boolean;
  /** Tries the product check turned down, with what was wrong. */
  rejected?: { image: string; note: string }[];
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

const PLATFORM = { shopee: 'Shopee', lazada: 'Lazada', tiktok: 'TikTok Shop', facebook: 'Facebook' } as const;

export function ShotCard({ shot, state, fileName, onRedo, onFix }: { shot: Shot; state: ShotState; fileName: string; onRedo: () => void; onFix?: () => void }) {
  const busy = state.status === 'queued' || state.status === 'shooting' || state.status === 'checking' || state.status === 'redoing';
  return (
    <article className={styles.card} aria-label={shot.title}>
      <div className={styles.photoMat} aria-busy={busy}>
        {state.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={state.image} alt={shot.title} className={styles.image} />
        ) : (
          <div className={styles.emptyPhoto}><Icon name="photo" width="34" height="34" /><span>{busy ? 'Finding your best angle' : 'Let’s try this photo again'}</span></div>
        )}
        {state.status === 'done' && (
          <span className={styles.photoLabel}>{state.composite ? 'Your real product, AI scene' : state.real ? 'Your real photo' : 'AI-made scene'}</span>
        )}
        {busy && state.image && <div className={styles.busyOverlay}>Taking another look…</div>}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardHeading}>
          <h3>{shot.title}</h3>
          <span className={styles.aspect}>{shot.aspect}</span>
        </div>
        <p className={styles.platform}>{PLATFORM[shot.platform]}</p>
        <p role="status" className={`${styles.status} ${state.status === 'done' ? styles.ready : state.status === 'failed' ? styles.failed : ''}`}>
          {state.status === 'done' ? <Icon name="check" width="14" height="14" /> : <span className={busy ? styles.workingDot : styles.statusDot} />}
          {state.status === 'done' ? (state.verdict?.pass || state.real ? 'Product checked' : 'Ready') : LABEL[state.status]}
        </p>
        {state.error && <p className={styles.error}>{state.error}</p>}
        {state.verdict?.seller_note && <p className={styles.note}>{state.verdict.seller_note}</p>}
        {!!state.rejected?.length && <details className={styles.rejected}>
          <summary>{state.rejected.length} rejected {state.rejected.length === 1 ? 'try' : 'tries'}</summary>
          {state.rejected.map((r, i) => (
            <div key={i} className={styles.rejectedTry}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r.image} alt={`Rejected try ${i + 1}`} width="44" height="44" />
              <p><strong>Try {i + 1}.</strong> {r.note}</p>
            </div>
          ))}
        </details>}
        {shot.caption && <p className={styles.caption}>{shot.caption}</p>}
        <div className={styles.actions}>
          {state.status === 'done' && state.image && <a href={state.image} download={`${fileName}-${shot.id}.jpg`} className={styles.download}><Icon name="download" width="15" height="15" />Download</a>}
          {onFix && state.status === 'done' && <button type="button" onClick={onFix} className={styles.secondary}>Fix cutout</button>}
          {(state.status === 'failed' || (!onFix && state.status === 'done')) && <button type="button" onClick={onRedo} className={styles.secondary}><Icon name="refresh" width="14" height="14" />{state.status === 'failed' ? 'Try again' : 'Reshoot'}</button>}
        </div>
      </div>
    </article>
  );
}
