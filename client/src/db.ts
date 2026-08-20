/**
 * The game's IndexedDB database.
 *
 * One module owns the schema. Opening the same database at different versions
 * from different modules throws a VersionError in whichever opens lower --
 * and because a failed load looks identical to "no save yet", that silently
 * regenerates the player's world instead of loading it.
 */

const DB_NAME = 'blockcraft';
/** Bump this, and add the store below, when a new store is needed. */
const DB_VERSION = 2;

export const WORLDS_STORE = 'worlds';
export const PACKS_STORE = 'packs';

let pending: Promise<IDBDatabase> | null = null;

export function openGameDb(): Promise<IDBDatabase> {
  if (pending) return pending;

  pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      // Every store the game has ever used is created here, so an upgrade
      // from any earlier version lands in the same shape.
      if (!db.objectStoreNames.contains(WORLDS_STORE)) {
        db.createObjectStore(WORLDS_STORE, { keyPath: 'slot' });
      }
      if (!db.objectStoreNames.contains(PACKS_STORE)) {
        db.createObjectStore(PACKS_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      pending = null; // let a later attempt retry
      reject(request.error);
    };
  });

  return pending;
}

/** Convenience wrapper for a single read. Resolves undefined on any failure. */
export async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  try {
    const db = await openGameDb();
    return await new Promise<T | undefined>((resolve) => {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

/** Convenience wrapper for a single write. Best effort. */
export async function dbPut(store: string, value: unknown): Promise<void> {
  try {
    const db = await openGameDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* storage may be unavailable; the game still runs */
  }
}

export async function dbDelete(store: string, key: string): Promise<void> {
  try {
    const db = await openGameDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* nothing to delete */
  }
}
