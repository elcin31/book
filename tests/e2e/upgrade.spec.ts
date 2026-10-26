import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { epubFixture, BOOK_TEXT } from '../support/books';

// Build the tagged baseline into an ignored directory and set BOOK_LEGACY_DIST
// to exercise a real Workbox upgrade on the same origin. No application endpoint.
test('1.0.1 service worker upgrades reader and repairs retained original without data loss', async ({
  page,
  context,
}) => {
  test.skip(!process.env.BOOK_LEGACY_DIST, 'Requires a built 1.0.1 baseline; see docs/QA-1.0.2.md');
  test.setTimeout(120000);
  let upgraded = false;
  let revision = 0;
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.epub': 'application/epub+zip',
  };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url!, 'http://localhost').pathname;
    const root = resolve(upgraded ? 'dist' : process.env.BOOK_LEGACY_DIST!);
    let path = resolve(root, '.' + decodeURIComponent(pathname));
    if (!path.startsWith(root + '/') && path !== root) {
      res.writeHead(403).end();
      return;
    }
    if (pathname.endsWith('/')) path = resolve(path, 'index.html');
    try {
      let bytes = await readFile(path);
      if (pathname === '/sw.js' && revision)
        bytes = Buffer.concat([Buffer.from(`/* QA update ${revision} */\n`), bytes]);
      res
        .writeHead(200, {
          'Content-Type': types[extname(path)] ?? 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'Service-Worker-Allowed': '/',
        })
        .end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(origin);
    await expect(page.locator('.book-card')).toHaveCount(3);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((done) =>
          navigator.serviceWorker.addEventListener('controllerchange', () => done(), {
            once: true,
          }),
        );
    });
    // An existing installation starts with its worker already controlling.
    await page.reload();
    await expect(page.locator('.book-card')).toHaveCount(3);
    const f = epubFixture('svg-cover');
    await page.locator('input[type=file][multiple]').setInputFiles({
      name: f.name,
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(f.bytes),
    });
    await expect(page.locator('.book-card')).toHaveCount(4);
    await page.locator('.book-card').first().locator('.book-open').click();
    await expect(page.locator('.reader-mount')).toHaveAttribute('data-layout-state', 'ready');
    // Reproduce the baseline defect: original SVG cover was discarded.
    await expect(page.frameLocator('.reader iframe').first().locator('body')).toHaveText('');
    await page.keyboard.press('ArrowRight');
    await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
      BOOK_TEXT,
    );
    const box = await page.locator('.reader-stage').boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.getByRole('button', { name: 'Добавить закладку', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Закладка сохранена');
    await page.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
    await page.getByRole('slider', { name: 'Размер текста', exact: true }).fill('27');
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: 'Вернуться в библиотеку' }).click();
    const snapshot = async () =>
      page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((done) => {
          const r = indexedDB.open('book-library');
          r.onsuccess = () => done(r.result);
        });
        const tx = database.transaction(['books', 'annotations', 'files']);
        const get = <T>(request: IDBRequest<T>) =>
          new Promise<T>((done) => {
            request.onsuccess = () => done(request.result);
          });
        const books = await get(tx.objectStore('books').getAll());
        const book = books.find((b) => !b.sample);
        const [notes, file] = await Promise.all([
          get(tx.objectStore('annotations').getAll()),
          get(tx.objectStore('files').get(book.id)),
        ]);
        database.close();
        return {
          id: book.id,
          cfi: JSON.parse(localStorage.getItem(`book-position:${book.id}`)!).cfi,
          notes,
          count: books.length,
          original: file.original.byteLength,
          fontSize: JSON.parse(localStorage.getItem('book-preferences')!).state.reader.fontSize,
          version: file.normalizerVersion,
        };
      });
    const before = await snapshot();
    expect(before.fontSize).toBe(27);
    expect(before.notes).toHaveLength(1);
    upgraded = true;
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state,
        ),
      )
      .toBe('installed');
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.locator('[data-book-version]')).toHaveAttribute('data-book-version', '1.0.2');
    await page.locator('.book-card').first().locator('.book-open').click();
    await expect(page.locator('.reader')).toHaveAttribute('data-reader-version', '1.0.2');
    await expect(page.locator('.reader-mount')).toHaveAttribute('data-layout-state', 'ready');
    await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
      BOOK_TEXT,
    );
    await expect(page.locator('.reader-status')).toHaveCount(0);
    expect(await snapshot()).toEqual({ ...before, version: 2 });
    // Cold navigation through the new service worker, with no network.
    await page.keyboard.press('Escape');
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-book-version]')).toHaveAttribute('data-book-version', '1.0.2');
    await page.locator('.book-card').first().locator('.book-open').click();
    await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
      BOOK_TEXT,
    );
    await expect(page.locator('.reader-status')).toHaveCount(0);
    expect(await snapshot()).toEqual({ ...before, version: 2 });
    // A later worker must wait while the book is open. Its activation swaps the
    // whole shell only after the reader closes and the user applies the update.
    await context.setOffline(false);
    revision++;
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state,
        ),
      )
      .toBe('installed');
    await expect(page.getByRole('button', { name: 'Обновить', exact: true })).toHaveCount(0);
    await expect(page.locator('.reader')).toHaveAttribute('data-reader-version', '1.0.2');
    await page.keyboard.press('Escape');
    const reloaded = page.waitForEvent('domcontentloaded');
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await reloaded;
    await expect(page.locator('[data-book-version]')).toHaveAttribute('data-book-version', '1.0.2');
    expect(await snapshot()).toEqual({ ...before, version: 2 });
  } finally {
    await context.setOffline(false);
    await page.goto('about:blank');
    await new Promise<void>((done) => server.close(() => done()));
  }
});
