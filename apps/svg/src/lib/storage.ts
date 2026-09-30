// Saved documents live in the browser's IndexedDB (localStorage's ~5 MB cap is too small once
// reference images are embedded). A light "meta" store lets the list load without the images.
import type { ProjectFile } from "./types.js";
import { uid } from "./utils.js";

const DB_NAME = "svg";
/**
 * The database's own version, for its stores rather than the documents in them (those carry
 * `ProjectFile.version`). An upgrade keeps everything.
 */
const DB_VERSION = 1;
const META = "meta";
const DATA = "data";

export interface DocumentMeta {
  id: string;
  name: string;
  updated: number;
  /** Place in the Documents list, lowest first. Set by the person, not by recency. */
  order: number;
  /** Labels to find it by; absent when it has none. */
  tags?: string[];
}

interface DataRecord {
  id: string;
  data: ProjectFile;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("This browser has no IndexedDB storage."));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore(META, { keyPath: "id" });
          db.createObjectStore(DATA, { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // A newer version of the app in another tab needs this connection gone before it can upgrade.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("Could not open the document library."));
      };
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Storage transaction aborted (quota?)"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Saved documents, in the order the list shows them. */
export async function listDocuments(): Promise<DocumentMeta[]> {
  const db = await openDb();
  const all = await request<DocumentMeta[]>(db.transaction(META).objectStore(META).getAll());
  return all.sort((a, b) => a.order - b.order);
}

/** A new document's place: above everything already in the list. */
const topOrder = (all: readonly DocumentMeta[]) => Math.min(0, ...all.map((m) => m.order)) - 1;
/** A place below everything already in the list. */
const bottomOrder = (all: readonly DocumentMeta[]) => Math.max(0, ...all.map((m) => m.order)) + 1;

/** Saves a document. One that is new goes to the top of the list; one that exists keeps its place. */
export async function saveDocument(doc: {
  id: string;
  name: string;
  /** Given for a document coming in from a file; an autosave leaves the stored ones alone. */
  tags?: string[];
  data: ProjectFile;
  /** Where a new document goes: the top, as for anything made or imported, or the bottom. */
  place?: "top" | "bottom";
}): Promise<DocumentMeta> {
  const db = await openDb();
  const tx = db.transaction([META, DATA], "readwrite");
  const meta = tx.objectStore(META);
  const existing = await request<DocumentMeta | undefined>(meta.get(doc.id));
  const all = existing ? [] : await request<DocumentMeta[]>(meta.getAll());
  const record: DocumentMeta = {
    ...existing,
    id: doc.id,
    name: doc.name,
    updated: Date.now(),
    order: existing?.order ?? (doc.place === "bottom" ? bottomOrder(all) : topOrder(all)),
  };
  if (doc.tags?.length) record.tags = doc.tags;
  meta.put(record);
  tx.objectStore(DATA).put({ id: doc.id, data: doc.data });
  await done(tx);
  return record;
}

/** Names and positions for an imported library, preserving its input order above existing files. */
export function importedRecords(
  all: readonly DocumentMeta[],
  incoming: readonly { name: string; tags?: string[] }[],
  updated = Date.now()
): DocumentMeta[] {
  const names = new Set(all.map((doc) => doc.name));
  const order = topOrder(all) - incoming.length + 1;
  return incoming.map((doc, index) => {
    let name = doc.name;
    for (let n = 2; names.has(name); n++) name = `${doc.name} ${n}`;
    names.add(name);
    return {
      id: uid("doc"),
      name,
      updated,
      order: order + index,
      ...(doc.tags?.length ? { tags: [...doc.tags] } : {}),
    };
  });
}

/** Import atomically and return the refreshed library, with one metadata read and transaction. */
export async function importDocuments(
  incoming: readonly { name: string; tags?: string[]; data: ProjectFile }[]
): Promise<DocumentMeta[]> {
  if (!incoming.length) return [];
  const db = await openDb();
  const tx = db.transaction([META, DATA], "readwrite");
  const meta = tx.objectStore(META);
  const all = await request<DocumentMeta[]>(meta.getAll());
  const records = importedRecords(all, incoming);
  records.forEach((record, index) => {
    meta.put(record);
    tx.objectStore(DATA).put({ id: record.id, data: incoming[index]!.data });
  });
  await done(tx);
  return [...records, ...all.sort((a, b) => a.order - b.order)];
}

/**
 * Each document's place once the list is put in the order `ids` gives: those take 0 … n−1, and
 * any it does not name (one made in another tab, say) follow in the order they had.
 */
export function listOrder(
  all: readonly DocumentMeta[],
  ids: readonly string[]
): Map<string, number> {
  const named = new Set(ids);
  const rest = all.filter((m) => !named.has(m.id)).sort((a, b) => a.order - b.order);
  const known = new Set(all.map((m) => m.id));
  return new Map(
    [...ids.filter((id) => known.has(id)), ...rest.map((m) => m.id)].map((id, k) => [id, k])
  );
}

/** Puts the list in the given order (see `listOrder`). */
export async function reorderDocuments(ids: readonly string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META, "readwrite");
  const meta = tx.objectStore(META);
  const all = await request<DocumentMeta[]>(meta.getAll());
  const order = listOrder(all, ids);
  for (const m of all) meta.put({ ...m, order: order.get(m.id)! });
  await done(tx);
}

export async function loadDocument(id: string): Promise<ProjectFile | null> {
  const db = await openDb();
  const rec = await request<DataRecord | undefined>(db.transaction(DATA).objectStore(DATA).get(id));
  return rec ? rec.data : null;
}

/** Read a batch from one transaction, in request order; a missing document aborts the export. */
export async function loadDocuments(ids: readonly string[]): Promise<ProjectFile[]> {
  if (!ids.length) return [];
  const db = await openDb();
  const tx = db.transaction(DATA);
  const completed = done(tx);
  const store = tx.objectStore(DATA);
  const [records] = await Promise.all([
    Promise.all(ids.map((id) => request<DataRecord | undefined>(store.get(id)))),
    completed,
  ]);
  return records.map((record, index) => {
    if (!record) throw new Error(`Document ${ids[index]} is missing from the library.`);
    return record.data;
  });
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, DATA], "readwrite");
  tx.objectStore(META).delete(id);
  tx.objectStore(DATA).delete(id);
  await done(tx);
}

/** Renames a document, or replaces its tags (none takes the field away). */
export async function updateMeta(
  id: string,
  patch: { name: string } | { tags: readonly string[] }
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META, "readwrite");
  const store = tx.objectStore(META);
  const rec = await request<DocumentMeta | undefined>(store.get(id));
  if (rec) {
    const next: DocumentMeta = { ...rec, ...patch } as DocumentMeta;
    if ("tags" in patch && !patch.tags.length) delete next.tags;
    store.put(next);
  }
  await done(tx);
}

export async function duplicateDocument(id: string, newId: string, name: string): Promise<void> {
  const db = await openDb();
  const rec = await request<DataRecord | undefined>(db.transaction(DATA).objectStore(DATA).get(id));
  if (!rec) return;
  const tx = db.transaction([META, DATA], "readwrite");
  const meta = tx.objectStore(META);
  const all = await request<DocumentMeta[]>(meta.getAll());
  const tags = all.find((m) => m.id === id)?.tags;
  // A copy goes on top, like any new document, and keeps the original's tags.
  meta.put({
    id: newId,
    name,
    updated: Date.now(),
    order: topOrder(all),
    ...(tags?.length ? { tags: [...tags] } : {}),
  });
  tx.objectStore(DATA).put({ id: newId, data: rec.data });
  await done(tx);
}
