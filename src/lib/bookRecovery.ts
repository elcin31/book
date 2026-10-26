import { db } from './db';
import { inspectEpub, bufferHash, NORMALIZER_VERSION } from '../engine/inspection';
import { prepareBook } from '../engine/importer';
import { ReaderFailure } from '../engine/readerFailure';
import { recordReaderDiagnostic } from './readerDiagnostics';
import type { BookFile } from '../types';
const repairs = new Map<string, Promise<BookFile>>();
export function restoreBook(id: string): Promise<BookFile> {
  const running = repairs.get(id);
  if (running) return running;
  const operation = (async () => {
    const [book, file] = await Promise.all([db.books.get(id), db.files.get(id)]);
    if (!book || !file?.original?.byteLength)
      throw new ReaderFailure(
        'format',
        'original',
        'Исходный файл книги недоступен для восстановления.',
      );
    recordReaderDiagnostic('repair-start', { bytes: file.original.byteLength }, id);
    const prepared = await prepareBook(
      new File([file.original], book.fileName, { type: file.originalType }),
    );
    if (prepared.hash !== book.hash)
      throw new ReaderFailure(
        'format',
        'original-integrity',
        'Сохранённый оригинал не прошёл проверку целостности.',
      );
    const repaired = {
      ...file,
      data: prepared.data,
      normalizerVersion: NORMALIZER_VERSION,
      normalizedHash: prepared.normalizedHash,
      inspection: prepared.inspection,
    };
    await db.transaction('rw', [db.files, db.books], async () => {
      const current = await db.books.get(id);
      if (!current || current.hash !== book.hash || !(await db.files.get(id)))
        throw new Error('Книга больше недоступна.');
      // One file record replaces atomically. Book ID, user title/collections,
      // annotations, position, original bytes and the synchronous journal stay put.
      await db.files.put(repaired);
    });
    recordReaderDiagnostic(
      'repair-complete',
      { sections: prepared.inspection.sections.length, repaired: true },
      id,
    );
    return repaired;
  })()
    .catch((error) => {
      recordReaderDiagnostic(
        'repair-failed',
        { code: error instanceof ReaderFailure ? error.code : 'format' },
        id,
      );
      throw error instanceof ReaderFailure ? error : new ReaderFailure('format', 'repair');
    })
    .finally(() => repairs.delete(id));
  repairs.set(id, operation);
  return operation;
}
export async function loadReadableBook(id: string, onRepair?: () => void): Promise<BookFile> {
  const file = await db.files.get(id);
  if (!file) throw new ReaderFailure('format', 'indexeddb', 'Файл книги не найден на устройстве.');
  recordReaderDiagnostic('indexeddb-read', { bytes: file.data?.byteLength ?? 0 }, id);
  try {
    const hash = await bufferHash(file.data);
    if (
      file.normalizerVersion === NORMALIZER_VERSION &&
      file.normalizedHash === hash &&
      file.inspection
    )
      return file;
    const inspection = await inspectEpub(file.data);
    // Old import discarded SVGs; an empty leading page may be a lost cover.
    // Re-normalize only this opened book from its retained original, not the library.
    if (
      !file.normalizerVersion &&
      inspection.sections[0]?.kind === 'empty' &&
      file.original?.byteLength
    ) {
      onRepair?.();
      return restoreBook(id);
    }
    if (file.normalizedHash && hash !== file.normalizedHash)
      throw new Error('Normalized checksum mismatch');
    const validated = {
      ...file,
      inspection,
      normalizerVersion: NORMALIZER_VERSION,
      normalizedHash: hash,
    };
    await db.transaction('rw', db.files, async () => {
      const current = await db.files.get(id);
      if (current && current.normalizedHash === file.normalizedHash)
        await db.files.put({
          ...current,
          inspection,
          normalizerVersion: NORMALIZER_VERSION,
          normalizedHash: hash,
        });
    });
    return validated;
  } catch (error) {
    recordReaderDiagnostic(
      'normalized-invalid',
      { code: error instanceof ReaderFailure ? error.code : 'format' },
      id,
    );
    if (file.original?.byteLength) {
      onRepair?.();
      return restoreBook(id);
    }
    throw new ReaderFailure('format', 'normalized');
  }
}
