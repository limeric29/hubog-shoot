import type { Photo } from './image';
import type { Mask, Plan, Verdict } from '../types';

const DB_NAME = 'hubog-shoot';
const DB_VERSION = 1;
const SHOOTS = 'shoots';
const INDEX = 'index';
const MAX_HISTORY = 10;

export interface SavedShotState {
  status: 'done' | 'failed';
  image?: string;
  real?: boolean;
  composite?: boolean;
  verdict?: Verdict;
  error?: string;
}

export interface SavedShoot {
  id: string;
  createdAt: number;
  updatedAt: number;
  brief: string;
  photo: Photo;
  plan: Plan;
  shots: Record<string, SavedShotState>;
  mask: Mask | null;
}

export interface ShootHistoryItem {
  id: string;
  createdAt: number;
  updatedAt: number;
  productName: string;
  photoUrl: string;
  readyCount: number;
  shotCount: number;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Browser storage is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHOOTS)) db.createObjectStore(SHOOTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(INDEX)) db.createObjectStore(INDEX, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
  });
}

export async function listShoots(): Promise<ShootHistoryItem[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(INDEX, 'readonly');
    const items = await requestResult(tx.objectStore(INDEX).getAll() as IDBRequest<ShootHistoryItem[]>);
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function getShoot(id: string): Promise<SavedShoot | undefined> {
  const db = await openDb();
  try {
    const tx = db.transaction(SHOOTS, 'readonly');
    return await requestResult(tx.objectStore(SHOOTS).get(id) as IDBRequest<SavedShoot | undefined>);
  } finally {
    db.close();
  }
}

export async function saveShoot(shoot: SavedShoot): Promise<void> {
  const db = await openDb();
  try {
    const existing = await requestResult(db.transaction(INDEX, 'readonly').objectStore(INDEX).getAll() as IDBRequest<ShootHistoryItem[]>);
    const oldest = existing
      .filter((item) => item.id !== shoot.id)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(MAX_HISTORY - 1);
    if (oldest.length) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([SHOOTS, INDEX], 'readwrite');
        for (const item of oldest) {
          tx.objectStore(SHOOTS).delete(item.id);
          tx.objectStore(INDEX).delete(item.id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Could not tidy old shoots.'));
        tx.onabort = () => reject(tx.error ?? new Error('Could not tidy old shoots.'));
      });
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SHOOTS, INDEX], 'readwrite');
      tx.objectStore(SHOOTS).put(shoot);
      tx.objectStore(INDEX).put({
        id: shoot.id,
        createdAt: shoot.createdAt,
        updatedAt: shoot.updatedAt,
        productName: shoot.plan.product.name,
        photoUrl: shoot.photo.url,
        readyCount: Object.values(shoot.shots).filter((shot) => shot.status === 'done' && shot.image).length,
        shotCount: shoot.plan.shots.length,
      } satisfies ShootHistoryItem);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save this shoot on this device.'));
      tx.onabort = () => reject(tx.error ?? new Error('Could not save this shoot on this device.'));
    });
  } finally {
    db.close();
  }
}

export async function deleteShoot(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SHOOTS, INDEX], 'readwrite');
      tx.objectStore(SHOOTS).delete(id);
      tx.objectStore(INDEX).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not delete this shoot.'));
      tx.onabort = () => reject(tx.error ?? new Error('Could not delete this shoot.'));
    });
  } finally {
    db.close();
  }
}
