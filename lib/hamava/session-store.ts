import type { AudioClip, Cue } from './types';

export type SavedSession = {
  source: string;
  voiceKey: string;
  name: string;
  cues: Cue[];
  clips: { start: number; end: number; duration: number; blob: Blob }[];
};

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('hamava-web-1.0.3', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('outputs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('ذخیره‌سازی مرورگر در تب دیگری مسدود شده است.'));
  });
}

async function access<T>(key: string, write: boolean, value?: T): Promise<T | undefined> {
  const db = await database();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction('outputs', write ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('outputs');
      const request = write ? (value === undefined ? store.delete(key) : store.put(value, key)) : store.get(key);
      transaction.oncomplete = () => resolve(write ? value : request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('ذخیره‌سازی انجام نشد.'));
    });
  } finally { db.close(); }
}

export const fileIdentity = (file: Pick<File, 'name' | 'size' | 'lastModified'>) => `file:${file.name}:${file.size}:${file.lastModified}`;
export const loadSession = () => access<SavedSession>('session', false);
export const saveSession = (session: SavedSession) => access('session', true, session);
export const loadLiveAudio = () => access<Blob>('live-audio', false);
export const saveLiveAudio = (blob: Blob) => access('live-audio', true, blob);
export const loadVideo = () => access<Blob>('video', false);
export const saveVideo = (blob: Blob) => access('video', true, blob);
export async function clearArchive() { await access('session', true); await access('video', true); await access('live-audio', true); }
export function restoreClips(session: SavedSession): AudioClip[] {
  return session.clips.map(({ blob, ...clip }) => ({ ...clip, url: URL.createObjectURL(blob) }));
}
