import { zipSync, strToU8, strFromU8 } from 'fflate';
import { db } from './db';
import { unpack } from './archive';
import { download } from './download';
import type { Annotation, BookRecord, Collection, ReadingDay } from '../types';
interface BackupManifest {
  version: 1;
  books: BookRecord[];
  annotations: Annotation[];
  collections: Collection[];
  days: ReadingDay[];
}
export async function exportBackup() {
  const [books, annotations, collections, days, files] = await db.transaction(
    'r',
    [db.books, db.annotations, db.collections, db.days, db.files],
    () =>
      Promise.all([
        db.books.toArray(),
        db.annotations.toArray(),
        db.collections.toArray(),
        db.days.toArray(),
        db.files.toArray(),
      ]),
  );
  const entries: Record<string, Uint8Array> = {
    'library.json': strToU8(JSON.stringify({ version: 1, books, annotations, collections, days })),
  };
  let total = entries['library.json'].byteLength;
  for (const file of files) {
    entries[`originals/${file.id}`] = new Uint8Array(file.original);
    total += file.original.byteLength;
  }
  if (total > 95 * 1024 * 1024)
    throw new Error(
      'Для общей копии лимит — 95 МБ. Сохраните оригиналы крупных книг отдельно через меню книги.',
    );
  const blob = new Blob([zipSync(entries, { level: 1 }).buffer as ArrayBuffer], {
    type: 'application/zip',
  });
  download(blob, `BOOK-${new Date().toISOString().slice(0, 10)}.book`);
}
const safeId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
export async function restoreBackup(file: File) {
  if (file.size > 100 * 1024 * 1024) throw new Error('Копия превышает 100 МБ.');
  const files = await unpack(await file.arrayBuffer(), 'backup');
  if (!files['library.json']) throw new Error('Это не резервная копия BOOK.');
  const manifest = JSON.parse(strFromU8(files['library.json'])) as BackupManifest;
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.books) ||
    !Array.isArray(manifest.annotations) ||
    !Array.isArray(manifest.collections) ||
    !Array.isArray(manifest.days)
  )
    throw new Error('Неверная структура резервной копии.');
  if (manifest.books.length > 2000 || manifest.annotations.length > 20000)
    throw new Error('В копии слишком много записей.');
  // Re-import original files through the same sanitizer; never trust archived HTML.
  const { importBook } = await import('../engine/importer');
  const idMap = new Map<string, string>();
  let count = 0;
  const collectionMap = new Map<string, string>();
  for (const c of manifest.collections) {
    if (!safeId(c.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60)
      continue;
    const existing =
      (await db.collections.get(c.id)) ??
      (await db.collections.where('name').equals(c.name).first());
    if (existing) collectionMap.set(c.id, existing.id);
    else {
      await db.collections.put({
        id: c.id,
        name: c.name,
        createdAt: Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
      });
      collectionMap.set(c.id, c.id);
    }
  }

  for (const b of manifest.books) {
    if (!safeId(b.id) || typeof b.fileName !== 'string' || !files[`originals/${b.id}`])
      throw new Error('В копии отсутствует оригинал книги.');
    const result = await importBook(
      new File([files[`originals/${b.id}`].slice().buffer], b.fileName),
    );
    idMap.set(b.id, result.book.id);
    const position =
      b.position && typeof b.position.cfi === 'string' && Number.isFinite(b.position.percent)
        ? { ...b.position, percent: Math.max(0, Math.min(1, b.position.percent)) }
        : undefined;
    const incomingIsNewer =
      (position?.updatedAt ?? b.lastReadAt ?? 0) >=
      (result.book.position?.updatedAt ?? result.book.lastReadAt ?? 0);
    await db.books.update(result.book.id, {
      favorite: b.favorite === true || result.book.favorite,
      collectionIds: Array.from(
        new Set([
          ...result.book.collectionIds,
          ...(Array.isArray(b.collectionIds)
            ? b.collectionIds
                .filter(safeId)
                .map((id) => collectionMap.get(id))
                .filter((id): id is string => Boolean(id))
            : []),
        ]),
      ),
      ...(incomingIsNewer
        ? {
            position: position ?? result.book.position,
            status: ['new', 'reading', 'finished'].includes(b.status)
              ? b.status
              : result.book.status,
            lastReadAt: Math.max(
              result.book.lastReadAt,
              Number.isFinite(b.lastReadAt) ? b.lastReadAt : 0,
            ),
          }
        : {}),
    });
    if (!result.duplicate) count++;
  }
  await db.transaction('rw', [db.annotations, db.collections, db.days], async () => {
    for (const a of manifest.annotations)
      if (
        safeId(a.id) &&
        idMap.has(a.bookId) &&
        typeof a.cfi === 'string' &&
        typeof a.text === 'string' &&
        typeof a.note === 'string' &&
        ['bookmark', 'highlight'].includes(a.kind)
      )
        await db.annotations.put({
          ...a,
          bookId: idMap.get(a.bookId)!,
          color: ['#e4c85e', '#a1bfa3', '#c7b1d5'].includes(a.color) ? a.color : '#e4c85e',
        });
    for (const day of manifest.days)
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
        Number.isFinite(day.seconds) &&
        day.seconds >= 0
      ) {
        const existing = await db.days.get(day.date);
        await db.days.put({
          date: day.date,
          seconds: Math.max(existing?.seconds ?? 0, day.seconds),
        });
      }
  });
  return count;
}
