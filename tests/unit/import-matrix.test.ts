import { File as NodeFile } from 'node:buffer';
import { beforeEach, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import { prepareBook, importBook } from '../../src/engine/importer';
import { loadReadableBook, restoreBook } from '../../src/lib/bookRecovery';
import { db } from '../../src/lib/db';
import { epubFixture, fb2Fixture, txtFixture, BOOK_TEXT, type FixtureBook } from '../support/books';
vi.mock('../../src/lib/archive', () => ({
  unpack: async (data: ArrayBuffer) => unzipSync(new Uint8Array(data)),
}));
function file(f: FixtureBook) {
  return new NodeFile([f.bytes.slice().buffer], f.name) as unknown as File;
}
beforeEach(async () => {
  await Promise.all([db.books.clear(), db.files.clear(), db.annotations.clear()]);
  localStorage.clear();
});
for (const kind of [
  'epub2',
  'epub3',
  'prefixed',
  'svg-cover',
  'vector-cover',
  'direct-svg',
  'epub2-direct-svg',
  'escaped-path',
  'blank',
  'title',
])
  it(`validates independent ${kind}`, async () => {
    const prepared = await prepareBook(file(epubFixture(kind)));
    expect(prepared.inspection.sections.some((s) => s.kind === 'text')).toBe(true);
    expect(prepared.inspection.sections[0].kind).toBe(
      kind === 'blank'
        ? 'empty'
        : ['svg-cover', 'vector-cover', 'direct-svg', 'epub2-direct-svg'].includes(kind)
          ? 'image'
          : 'text',
    );
    const files = unzipSync(new Uint8Array(prepared.data));
    if (kind === 'epub2-direct-svg')
      expect(strFromU8(files['OPS/toc.ncx'])).toContain('Text/cover.svg.book.xhtml');
    const section = prepared.inspection.sections.find((s) => s.textLength > 100)!;
    expect(strFromU8(files[section.path])).toContain(BOOK_TEXT);
  });
for (const f of [
  fb2Fixture(),
  fb2Fixture(true),
  fb2Fixture(false, 'windows-1251'),
  txtFixture(),
  txtFixture('windows-1251'),
])
  it(`roundtrips ${f.name}`, async () => {
    const { book } = await importBook(file(f));
    const stored = await loadReadableBook(book.id);
    expect(stored.original).toEqual(f.bytes.slice().buffer);
    expect(stored.inspection?.sections.some((s) => s.kind === 'text')).toBe(true);
  });
it('rejects an empty or damaged spine before persistence', async () => {
  for (const kind of ['empty', 'broken-spine'])
    await expect(importBook(file(epubFixture(kind)))).rejects.toThrow();
  expect(await db.books.count()).toBe(0);
});
it('repairs only the opened normalized file, preserving metadata, IDs, original, notes and CFI', async () => {
  const f = epubFixture('svg-cover');
  const { book } = await importBook(file(f));
  const position = {
    cfi: 'epubcfi(/6/4!/4/4/1:10)',
    percent: 0.4,
    chapter: 'Personal chapter',
    updatedAt: 123,
  };
  await db.books.update(book.id, {
    favorite: true,
    title: 'Моё название',
    collectionIds: ['personal'],
    position,
    status: 'reading',
  });
  await db.annotations.add({
    id: 'note',
    bookId: book.id,
    cfi: position.cfi,
    text: 'private',
    note: 'private note',
    kind: 'highlight',
    color: '#e4c85e',
    chapter: 'private',
    createdAt: 1,
  });
  localStorage.setItem(`book-position:${book.id}`, JSON.stringify(position));
  await db.files.put({ ...(await db.files.get(book.id)!), data: new ArrayBuffer(3) });
  const repaired = await loadReadableBook(book.id);
  expect(repaired.inspection?.sections[0].kind).toBe('image');
  expect(await db.books.get(book.id)).toMatchObject({
    id: book.id,
    title: 'Моё название',
    favorite: true,
    collectionIds: ['personal'],
    position,
  });
  expect(await db.annotations.count()).toBe(1);
  expect(JSON.parse(localStorage.getItem(`book-position:${book.id}`)!)).toEqual(position);
  expect(repaired.original).toEqual(f.bytes.slice().buffer);
});
it('same SHA re-import replaces broken data without duplicating a book', async () => {
  const f = epubFixture('epub2');
  const { book } = await importBook(file(f));
  await db.files.update(book.id, { data: new ArrayBuffer(4) });
  const duplicate = await importBook(file(f));
  expect(duplicate.duplicate).toBe(true);
  expect(duplicate.book.id).toBe(book.id);
  expect(await db.books.count()).toBe(1);
  expect((await loadReadableBook(book.id)).data.byteLength).toBeGreaterThan(1000);
});
it('failed recovery leaves the existing record intact', async () => {
  const { book } = await importBook(file(txtFixture()));
  const original = await db.files.get(book.id);
  await db.files.update(book.id, { original: new ArrayBuffer(4), data: new ArrayBuffer(3) });
  await expect(restoreBook(book.id)).rejects.toThrow();
  expect((await db.files.get(book.id))?.data.byteLength).toBe(3);
  expect(await db.books.count()).toBe(1);
  expect(original?.original.byteLength).toBeGreaterThan(1000);
});
it('retains no active SVG content or external references', async () => {
  const f = epubFixture('vector-cover');
  const files = unzipSync(f.bytes);
  files['OPS/Text/cover.xhtml'] = strToU8(
    strFromU8(files['OPS/Text/cover.xhtml']).replace(
      '</svg>',
      '<script>parent.attack=true</script><foreignObject><div>unsafe</div></foreignObject><image href="https://tracker.invalid/x"/></svg>',
    ),
  );
  const prepared = await prepareBook(file({ ...f, bytes: zipSync(files) }));
  const normalized = unzipSync(new Uint8Array(prepared.data));
  const html = strFromU8(normalized['OPS/Text/cover.xhtml']);
  expect(html).not.toContain('tracker.invalid');
  expect(html).not.toContain('<script');
  const encoded = html.match(/src="data:image\/svg\+xml;base64,([^"]+)"/)?.[1];
  expect(encoded).toBeTruthy();
  const svg = Buffer.from(encoded!, 'base64').toString('utf8');
  expect(svg).not.toMatch(/script|foreignObject|tracker\.invalid|onload=/);
});
it('rejects an incomplete File API read before persisting anything', async () => {
  const incomplete = file(epubFixture());
  vi.spyOn(incomplete, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(1));
  await expect(importBook(incomplete)).rejects.toThrow('не загружен полностью');
  expect(await db.books.count()).toBe(0);
});
