import { test, expect, type Page } from '@playwright/test';
import { epubFixture, fb2Fixture, txtFixture, BOOK_TEXT, type FixtureBook } from '../support/books';
async function importFile(page: Page, f: FixtureBook) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Читать «Белые ночи»' })).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: f.name,
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(f.bytes),
  });
  await expect(page.locator('.book-card')).toHaveCount(4);
  await page.locator('.book-card').first().locator('.book-open').click();
  await expect(page.locator('.reader-mount')).toHaveAttribute('data-layout-state', 'ready');
}
async function controls(page: Page) {
  if (await page.locator('.reader').evaluate((el) => el.classList.contains('chrome-hidden'))) {
    const b = await page.locator('.reader-stage').boundingBox();
    await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
  }
}
async function visibleText(page: Page) {
  await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
    BOOK_TEXT,
  );
  await expect(page.locator('.reader-status')).toHaveCount(0);
  const count = await page.locator('.reader-stage').evaluate((el) => {
    const stage = el.getBoundingClientRect(),
      frame = el.querySelector('iframe')!,
      offset = frame.getBoundingClientRect(),
      doc = frame.contentDocument!,
      walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node,
      count = 0;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const p = node.parentElement!,
        s = doc.defaultView!.getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      if (
        Array.from(range.getClientRects()).some(
          (r) =>
            r.width > 0 &&
            r.height > 0 &&
            r.left + offset.x < stage.right &&
            r.right + offset.x > stage.left &&
            r.top + offset.y < stage.bottom &&
            r.bottom + offset.y > stage.top,
        )
      )
        count += node.textContent.length;
    }
    return count;
  });
  expect(count).toBeGreaterThan(10);
}
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await info.attach('reader-diagnostics', {
      body: await page
        .evaluate(() => sessionStorage.getItem('book-reader-diagnostics') ?? '[]')
        .catch(() => '[]'),
      contentType: 'application/json',
    });
});
const books = [
  epubFixture('epub2'),
  epubFixture('epub3'),
  epubFixture('prefixed'),
  epubFixture('svg-cover'),
  epubFixture('vector-cover'),
  epubFixture('direct-svg'),
  epubFixture('epub2-direct-svg'),
  epubFixture('escaped-path'),
  epubFixture('title'),
  epubFixture('blank'),
  fb2Fixture(),
  fb2Fixture(true),
  fb2Fixture(false, 'windows-1251'),
  txtFixture(),
  txtFixture('windows-1251'),
];
for (const [i, f] of books.entries())
  test(`independent ${i}: ${f.name} opens actual content and reopens from IndexedDB`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await importFile(page, f);
    if (f.image) {
      await expect(
        page.frameLocator('.reader iframe').first().locator('img').first(),
      ).toBeVisible();
      expect(
        await page
          .frameLocator('.reader iframe')
          .first()
          .locator('img')
          .first()
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
      // A cover CFI has no text Range. It must still reopen the same image page.
      const saved = await bookData(page);
      await page.keyboard.press('Escape');
      await page.reload();
      await page.locator('.book-card').first().locator('.book-open').click();
      await expect(page.locator('.reader-mount')).toHaveAttribute('data-layout-state', 'ready');
      await expect(page.locator('.reader-status')).toHaveCount(0);
      await expect(
        page.frameLocator('.reader iframe').first().locator('img').first(),
      ).toBeVisible();
      expect((await bookData(page)).cfi).toBe(saved.cfi);
      await controls(page);
      await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    }
    if (f.blank) {
      await expect(
        page.getByRole('heading', { name: 'На этой странице нет текста' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Перейти к тексту', exact: true }).click();
    }
    if (f.name === 'title.epub') {
      await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
        'Титульная страница',
      );
      await controls(page);
      await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    }
    await visibleText(page);
    if (f.name === 'epub2-direct-svg.epub') {
      await controls(page);
      await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
      await page.getByRole('button', { name: 'Обложка', exact: true }).click();
      await expect(page.frameLocator('.reader iframe').first().locator('img')).toBeVisible();
      await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
      await visibleText(page);
    }
    await controls(page);
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await visibleText(page);
    await page.getByRole('button', { name: 'Вернуться в библиотеку' }).click();
    await page.reload();
    await expect(page.locator('.book-card')).toHaveCount(4);
    await page.locator('.book-card').first().locator('.book-open').click();
    await visibleText(page);
    expect(errors).toEqual([]);
  });
test('corrupted and contentless EPUB never enter the library', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.book-card')).toHaveCount(3);
  for (const kind of ['empty', 'broken-spine']) {
    const f = epubFixture(kind);
    await page.locator('input[type=file][multiple]').setInputFiles({
      name: f.name,
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(f.bytes),
    });
    await expect(page.getByRole('dialog')).toContainText('Не все книги удалось добавить');
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  }
  await expect(page.locator('.book-card')).toHaveCount(3);
});
async function bookData(
  page: Page,
  mode: 'corrupt' | 'read' | 'invalid-cfi' | 'unrecoverable' = 'read',
) {
  return page.evaluate(async (mode) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('book-library');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise<{
      id: string;
      cfi?: string;
      title: string;
      favorite: boolean;
      notes: number;
      version?: number;
    }>((resolve, reject) => {
      const tx = database.transaction(
          ['books', 'files', 'annotations'],
          mode === 'read' ? 'readonly' : 'readwrite',
        ),
        bookStore = tx.objectStore('books'),
        fileStore = tx.objectStore('files');
      const books = bookStore.getAll();
      books.onsuccess = () => {
        const book = books.result.find((b) => !b.sample);
        const request = fileStore.get(book.id);
        request.onsuccess = () => {
          const f = request.result;
          if (mode === 'corrupt') {
            f.data = new ArrayBuffer(4);
            fileStore.put(f);
            book.favorite = true;
            book.title = 'Моя сохранённая книга';
            bookStore.put(book);
          }
          if (mode === 'unrecoverable') {
            f.data = new ArrayBuffer(4);
            f.original = new ArrayBuffer(4);
            fileStore.put(f);
          }
          if (mode === 'invalid-cfi') {
            book.position = {
              cfi: 'epubcfi(/6/99998!/4/4/1:9999)',
              percent: 0.57,
              chapter: 'Сохранённая глава',
              updatedAt: Date.now() + 1000,
            };
            bookStore.put(book);
            localStorage.setItem(`book-position:${book.id}`, JSON.stringify(book.position));
          }
          const count = tx.objectStore('annotations').count();
          count.onsuccess = () => {
            const value = {
              id: book.id,
              cfi: book.position?.cfi,
              title: book.title,
              favorite: book.favorite,
              notes: count.result,
              version: f.normalizerVersion,
            };
            tx.oncomplete = () => resolve(value);
          };
        };
      };
      tx.onerror = () => reject(tx.error);
    });
    database.close();
    return result;
  }, mode);
}
test('lazy repair preserves book ID, metadata, bookmarks and CFI after normalized corruption', async ({
  page,
}) => {
  await importFile(page, epubFixture('epub2'));
  await visibleText(page);
  await controls(page);
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  await visibleText(page);
  await page.getByRole('button', { name: 'Добавить закладку', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Закладка сохранена');
  await page.getByRole('button', { name: 'Вернуться в библиотеку' }).click();
  const before = await bookData(page, 'corrupt');
  await page.reload();
  await page.locator('.book-card').first().locator('.book-open').click();
  await visibleText(page);
  const after = await bookData(page);
  expect(after).toMatchObject({
    id: before.id,
    title: before.title,
    favorite: true,
    notes: before.notes,
    cfi: before.cfi,
    version: 2,
  });
  await controls(page);
  await page.getByRole('button', { name: 'Вернуться в библиотеку' }).click();
  await page.reload();
  await page.locator('.book-card').first().locator('.book-open').click();
  await visibleText(page);
});
test('unreadable retained data shows a format error and failed repair retains the book', async ({
  page,
}) => {
  await importFile(page, txtFixture());
  await visibleText(page);
  await page.keyboard.press('Escape');
  const before = await bookData(page, 'unrecoverable');
  await page.reload();
  await page.locator('.book-card').first().locator('.book-open').click();
  await expect(
    page.getByRole('heading', { name: 'Не удалось прочитать содержимое файла' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Восстановить книгу', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Не удалось прочитать содержимое файла' }),
  ).toBeVisible();
  expect((await bookData(page)).id).toBe(before.id);
  expect((await bookData(page)).cfi).toBe(before.cfi);
  await page.getByRole('button', { name: 'В библиотеку', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(4);
});
test('bad CFI is reported without overwriting the saved progress', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await importFile(page, txtFixture());
  await visibleText(page);
  await controls(page);
  await page.getByRole('button', { name: 'Вернуться в библиотеку' }).click();
  const before = await bookData(page, 'invalid-cfi');
  await page.reload();
  await page.locator('.book-card').first().locator('.book-open').click();
  await expect(
    page.getByRole('heading', { name: 'Не удалось восстановить место чтения' }),
  ).toBeVisible();
  expect((await bookData(page)).cfi).toBe(before.cfi);
  await expect(page.getByRole('button', { name: 'Повторить открытие' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Восстановить книгу' })).toBeVisible();
  await page.getByRole('button', { name: 'Перейти к тексту', exact: true }).click();
  await visibleText(page);
  expect(errors).toEqual([]);
});
test('zero-sized mount reports a visible error and retry recovers', async ({ page }) => {
  await page.goto('/');
  const style = await page.addStyleTag({
    content: '.reader-stage{height:0!important;bottom:auto!important}',
  });
  await expect(page.locator('.book-card')).toHaveCount(3);
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(txtFixture().bytes),
  });
  await expect(page.locator('.book-card')).toHaveCount(4);
  await page.locator('.book-card').first().locator('.book-open').click();
  await expect(page.getByText('Подготавливаем книгу…')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Книга загружена, но возникла ошибка отображения' }),
  ).toBeVisible({ timeout: 12000 });
  await style.evaluate((el) => el.remove());
  await page.getByRole('button', { name: 'Повторить открытие' }).click();
  await visibleText(page);
});
test('hidden iframe is detected, not counted as successfully rendered', async ({ page }) => {
  await page.goto('/');
  const style = await page.addStyleTag({ content: '.reader iframe{visibility:hidden!important}' });
  await expect(page.locator('.book-card')).toHaveCount(3);
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'hidden.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(txtFixture().bytes),
  });
  await expect(page.locator('.book-card')).toHaveCount(4);
  await page.locator('.book-card').first().locator('.book-open').click();
  await expect(
    page.getByRole('heading', { name: 'Книга загружена, но возникла ошибка отображения' }),
  ).toBeVisible();
  await page.getByText('Локальная диагностика').click();
  await expect(page.locator('.reader-diagnostics')).toContainText('hidden');
  expect(await page.locator('.reader-diagnostics').innerText()).not.toContain(BOOK_TEXT);
  await style.evaluate((el) => el.remove());
  await page.getByRole('button', { name: 'Повторить открытие' }).click();
  await visibleText(page);
});
