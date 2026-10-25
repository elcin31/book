import Dexie, { type EntityTable } from 'dexie';
import type {
  BookRecord,
  BookFile,
  Annotation,
  Collection,
  ReadingDay,
  ReadingPosition,
} from '../types';
class BookDatabase extends Dexie {
  books!: EntityTable<BookRecord, 'id'>;
  files!: EntityTable<BookFile, 'id'>;
  annotations!: EntityTable<Annotation, 'id'>;
  collections!: EntityTable<Collection, 'id'>;
  days!: EntityTable<ReadingDay, 'date'>;
  constructor() {
    super('book-library');
    this.version(1).stores({
      books: 'id, &hash, addedAt, lastReadAt, status, *collectionIds',
      files: 'id',
      annotations: 'id, bookId, kind, createdAt',
      collections: 'id, &name, createdAt',
      days: 'date',
    });
  }
}
export const db = new BookDatabase();
export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export async function recordTime(seconds: number) {
  const date = localDate();
  await db.transaction('rw', db.days, async () => {
    const day = await db.days.get(date);
    await db.days.put({ date, seconds: (day?.seconds ?? 0) + seconds });
  });
}
export async function removeBook(id: string) {
  await db.transaction('rw', [db.books, db.files, db.annotations], async () => {
    await db.books.delete(id);
    await db.files.delete(id);
    await db.annotations.where('bookId').equals(id).delete();
  });
  localStorage.removeItem(`book-position:${id}`);
}
export function readPosition(book: BookRecord): ReadingPosition | undefined {
  try {
    const raw = localStorage.getItem(`book-position:${book.id}`);
    const p = raw ? (JSON.parse(raw) as ReadingPosition) : undefined;
    return p &&
      p.updatedAt > (book.position?.updatedAt ?? 0) &&
      typeof p.cfi === 'string' &&
      Number.isFinite(p.percent)
      ? p
      : book.position;
  } catch {
    return book.position;
  }
}
export function savePosition(id: string, position: ReadingPosition) {
  // Synchronous journal survives iOS pagehide; IndexedDB remains the durable source.
  try {
    localStorage.setItem(`book-position:${id}`, JSON.stringify(position));
  } catch {
    /* IndexedDB save below still runs. */
  }
  return db.books.update(id, {
    position,
    lastReadAt: position.updatedAt,
    status: position.percent >= 0.995 ? 'finished' : 'reading',
  });
}
