import { File as NodeFile } from 'node:buffer';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';
import { convertFb2, createEpub, importBook, sanitizeChapter } from '../../src/engine/importer';
import { db, savePosition, readPosition, removeBook } from '../../src/lib/db';
vi.mock('../../src/lib/archive', () => ({
  unpack: async (data: ArrayBuffer) => unzipSync(new Uint8Array(data)),
}));
const fb2 = `<?xml version="1.0" encoding="UTF-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>Тестовая книга</book-title><author><first-name>Антон</first-name><last-name>Чехов</last-name></author><annotation><p>Описание</p></annotation></title-info></description><body><section><title><p>Глава первая</p></title><p>Это <emphasis>настоящий</emphasis> текст.</p><p>Вторая строка.</p></section><section><title><p>Глава вторая</p></title><p>Продолжение истории.</p></section></body></FictionBook>`;
function file(bytes: ArrayBuffer | string, name: string) {
  const array = typeof bytes === 'string' ? strToU8(bytes).slice().buffer : bytes;
  return new NodeFile([array], name) as unknown as File;
}
beforeEach(async () => {
  await Promise.all([
    db.books.clear(),
    db.files.clear(),
    db.annotations.clear(),
    db.collections.clear(),
  ]);
  localStorage.clear();
});
describe('FB2 adapter', () => {
  it('preserves title, author, chapters and inline emphasis in an actual EPUB', () => {
    const result = convertFb2(strToU8(fb2));
    expect(result.title).toBe('Тестовая книга');
    expect(result.author).toBe('Антон Чехов');
    const files = unzipSync(new Uint8Array(result.data));
    expect(strFromU8(files['OEBPS/content.opf'])).toContain('chapter-1.xhtml');
    expect(strFromU8(files['OEBPS/chapter-0.xhtml'])).toContain('<em>настоящий</em>');
    expect(strFromU8(files['OEBPS/nav.xhtml'])).toContain('Глава вторая');
  });
  it('rejects malformed XML and DTD entities', () => {
    expect(() => convertFb2(strToU8('<FictionBook>'))).toThrow();
    expect(() =>
      convertFb2(strToU8('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><FictionBook/>')),
    ).toThrow(/DTD/);
  });
});
describe('untrusted book content', () => {
  it('removes scripts, handlers, active embeds, remote images, remote links and CSS', () => {
    const clean = sanitizeChapter(
      '<html><head><style>@import "https://tracker.test"</style></head><body><script>alert(1)</script><p onclick="alert(2)">Текст</p><img src="https://tracker.test/pixel" onerror="alert(3)"/><a href="javascript:alert(1)">x</a><iframe src="/secret"></iframe><a href="chapter2.xhtml#note">Глава</a></body></html>',
    );
    expect(clean).not.toMatch(/<script|onclick|onerror|tracker\.test|javascript:|<iframe|@import/);
    expect(clean).toContain('chapter2.xhtml#note');
    expect(clean).toContain('Content-Security-Policy');
  });
  it('keeps EPUB navigation semantics through sanitization', () => {
    const clean = sanitizeChapter(
      '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><a href="a.xhtml">Глава</a></nav></body></html>',
    );
    expect(clean).toContain('epub:type="toc"');
  });
  it('rejects unsupported and oversized files before storing any records', async () => {
    await expect(importBook(file('x', 'test.pdf'))).rejects.toThrow(/EPUB/);
    await expect(importBook({ name: 'huge.epub', size: 51 * 1024 * 1024 } as File)).rejects.toThrow(
      /50/,
    );
    expect(await db.books.count()).toBe(0);
  });
});
describe('library persistence', () => {
  it('imports original and normalized FB2 atomically and deduplicates by content', async () => {
    const first = await importBook(file(fb2, 'story.fb2'));
    const second = await importBook(file(fb2, 'renamed.fb2'));
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(await db.books.count()).toBe(1);
    expect((await db.files.get(first.book.id))?.data.byteLength).toBeGreaterThan(500);
  });
  it('normalizes genuine EPUB3 including its navigation', async () => {
    const epub = createEpub('Эпуб', 'Автор', [
      { title: 'Первая', html: '<p>Много настоящих слов.</p>' },
    ]);
    const result = await importBook(file(epub, 'real.epub'));
    expect(result.book.title).toBe('Эпуб');
    expect(result.book.format).toBe('EPUB');
    const bytes = (await db.files.get(result.book.id))!.data;
    const files = unzipSync(new Uint8Array(bytes));
    expect(strFromU8(files['OEBPS/nav.xhtml'])).toContain('epub:type="toc"');
  });
  it('restores the newest synchronous position journal, and deletes associated records', async () => {
    const { book } = await importBook(file(fb2, 'story.fb2'));
    await savePosition(book.id, {
      cfi: 'epubcfi(/6/2!/4/2:10)',
      percent: 0.34,
      chapter: 'Первая',
      updatedAt: 10,
    });
    localStorage.setItem(
      `book-position:${book.id}`,
      JSON.stringify({ cfi: 'newer-cfi', percent: 0.5, chapter: 'Вторая', updatedAt: 20 }),
    );
    expect(readPosition((await db.books.get(book.id))!)?.cfi).toBe('newer-cfi');
    await db.annotations.add({
      id: 'mark',
      bookId: book.id,
      cfi: 'cfi',
      text: 'x',
      note: '',
      color: '#fff',
      kind: 'bookmark',
      chapter: 'x',
      createdAt: 1,
    });
    await removeBook(book.id);
    expect(await db.files.count()).toBe(0);
    expect(await db.annotations.count()).toBe(0);
    expect(localStorage.getItem(`book-position:${book.id}`)).toBeNull();
  });
  it('rejects broken EPUB packages without leaving partial imports', async () => {
    const archive = zipSync({ 'bad.txt': strToU8('not epub') });
    await expect(importBook(file(archive.slice().buffer, 'broken.epub'))).rejects.toThrow(
      /container/,
    );
    expect(await db.books.count()).toBe(0);
  });
});
