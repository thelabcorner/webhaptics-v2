import type { Vibration } from 'web-haptics';
import type { GeneratorSource, PatternAnalysis } from './stateSpace';

const DB_NAME = 'webhaptics-state-space';
const DB_VERSION = 1;
const STORE = 'specimens';

export interface StoredSpecimen {
  id: string;
  label: string;
  pattern: Vibration[];
  source: GeneratorSource;
  analysis: PatternAnalysis;
  rawAddress: string;
  pwmAddress: string;
  rawSpace: string;
  pwmSpace: string;
  firstSeenAt: number;
  lastPlayedAt: number;
  plays: number;
  favorite: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('lastPlayedAt', 'lastPlayedAt');
      store.createIndex('favorite', 'favorite');
      store.createIndex('bucketId', 'analysis.bucketId');
    };
    request.onsuccess = () => resolve(request.result);
  });

  return dbPromise;
}

export async function upsertSpecimen(
  specimen: Omit<StoredSpecimen, 'firstSeenAt' | 'lastPlayedAt' | 'plays' | 'favorite'>,
): Promise<StoredSpecimen> {
  const db = await openDatabase();
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getRequest = store.get(specimen.id);
    let next: StoredSpecimen | null = null;

    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const previous = getRequest.result as StoredSpecimen | undefined;
      next = {
        ...specimen,
        firstSeenAt: previous?.firstSeenAt ?? now,
        lastPlayedAt: now,
        plays: (previous?.plays ?? 0) + 1,
        favorite: previous?.favorite ?? false,
      };
      store.put(next);
    };

    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => {
      if (next) resolve(next);
      else reject(new Error('IndexedDB transaction completed without a specimen.'));
    };
  });
}

export async function listSpecimens(): Promise<StoredSpecimen[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const items = (request.result as StoredSpecimen[]).sort(
        (a, b) => b.lastPlayedAt - a.lastPlayedAt,
      );
      resolve(items);
    };
  });
}

export async function setFavorite(id: string, favorite: boolean): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const specimen = request.result as StoredSpecimen | undefined;
      if (!specimen) return;
      store.put({ ...specimen, favorite });
    };
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

export async function clearSpecimens(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve();
  });
}

export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
