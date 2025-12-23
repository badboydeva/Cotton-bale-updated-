import { Session, Bale } from '../types';

const DB_NAME = 'CottonLogDB';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject('IndexedDB error');

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
    };
  });
};

export const saveSession = async (session: Session): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SESSIONS], 'readwrite');
    const store = transaction.objectStore(STORE_SESSIONS);
    const request = store.put(session);

    request.onsuccess = () => resolve();
    request.onerror = () => reject('Error saving session');
  });
};

export const getAllSessions = async (): Promise<Session[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SESSIONS], 'readonly');
    const store = transaction.objectStore(STORE_SESSIONS);
    const request = store.getAll();

    request.onsuccess = () => {
      // Sort by date desc
      const sessions = request.result as Session[];
      resolve(sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    };
    request.onerror = () => reject('Error fetching sessions');
  });
};

export const deleteSession = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SESSIONS], 'readwrite');
    const store = transaction.objectStore(STORE_SESSIONS);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject();
  });
};
