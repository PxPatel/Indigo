/**
 * IndexedDB cache for uploaded CSV files.
 * Stores raw ArrayBuffer + filename so files can be reconstructed across sessions.
 */

const DB_NAME = 'indigo';
const STORE = 'csv_files';
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedFiles(): Promise<File[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const records = req.result as { name: string; content: ArrayBuffer }[];
      resolve(records.map((r) => new File([r.content], r.name, { type: 'text/csv' })));
    };
    req.onerror = () => reject(req.error);
  });
}

/** Replace the entire cache with the given file set. */
export async function saveFilesToCache(files: File[]): Promise<void> {
  // Read all file contents before opening the transaction — arrayBuffer() is async
  const records = await Promise.all(
    files.map(async (f) => ({ name: f.name, content: await f.arrayBuffer() })),
  );
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    for (const r of records) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearCache(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
