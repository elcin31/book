import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
const fixture = Buffer.from(
  `<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Проверка FB2</book-title><author><first-name>Тестовый</first-name><last-name>Автор</last-name></author></title-info></description><body><section><title><p>Первая глава</p></title>${Array.from({ length: 100 }, (_, i) => `<p>Абзац ${i + 1}. Это настоящая тестовая история. Мы проверяем чтение, сохранение позиции и отображение текста на странице.</p>`).join('')}</section><section><title><p>Вторая глава</p></title><p>Продолжение книги. Последние строки истории.</p></section></body></FictionBook>`,
);
async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Читать «Белые ночи»' })).toBeVisible();
}
async function showControls(page: import('@playwright/test').Page) {
  if (await page.locator('.reader').evaluate((el) => el.classList.contains('chrome-hidden'))) {
    const stage = page.locator('.reader-stage');
    const size = await stage.boundingBox();
    await stage.click({ position: { x: size!.width / 2, y: size!.height / 2 } });
  }
  await expect(page.locator('.reader-header')).toBeVisible();
}
async function openSample(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Читать «Белые ночи»' }).click();
  await expect(page.locator('.reader iframe')).toBeVisible();
  await expect(page.locator('.reader-mount')).toHaveAttribute('data-layout-state', 'ready');
  await expect(page.locator('.reader-status')).toHaveCount(0);
  await showControls(page);
}
async function position(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('book-position:'));
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
}
test('real EPUB: text, page turn, settings, bookmark, search, exact CFI restore, offline cold start', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await openSample(page);
  const frame = page.frameLocator('.reader iframe').first();
  await expect(frame.locator('body')).toContainText('Иль был он создан');
  await expect.poll(async () => (await position(page))?.cfi).toBeTruthy();
  const first = await position(page);
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  await expect.poll(async () => (await position(page))?.cfi).not.toBe(first.cfi);
  const next = await position(page);
  await page.getByRole('button', { name: 'Добавить закладку', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Закладка сохранена');
  await page.getByRole('button', { name: 'Настройки чтения' }).click();
  await page.getByRole('button', { name: 'Сепия', exact: true }).click();
  await page.getByRole('slider', { name: 'Размер текста', exact: true }).fill('24');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.reader')).toHaveClass(/reader-sepia/);
  await expect
    .poll(() => frame.locator('body').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe('24px');
  await page.getByRole('button', { name: 'Поиск в книге', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Текст для поиска' }).fill('мечтатель');
  await page.getByRole('button', { name: 'Найти', exact: true }).click();
  await expect(page.locator('.search-results button').first()).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  // Save the position after typography reflow, then reopen and compare its CFI.
  const beforeNext = await position(page);
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  await expect.poll(async () => (await position(page))?.cfi).not.toBe(beforeNext.cfi);
  const saved = await position(page);
  await page.getByRole('button', { name: 'Вернуться в библиотеку' }).click();
  await openSample(page);
  await expect.poll(async () => (await position(page))?.cfi).toBe(saved.cfi);
  await page.getByRole('button', { name: 'Закладки и заметки', exact: true }).click();
  await expect(page.locator('.annotation')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Вернуться в библиотеку' }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Читать «Белые ночи»' })).toBeVisible();
  await openSample(page);
  await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
    'Была чудная ночь',
  );
  await context.setOffline(false);
  expect(next.cfi).not.toBe(first.cfi);
  expect(errors).toEqual([]);
});
test('real FB2 import, duplicate handling, chapter navigation and malicious file feedback', async ({
  page,
}) => {
  await ready(page);
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'story.fb2', mimeType: 'application/xml', buffer: fixture });
  await expect(page.getByRole('button', { name: 'Читать «Проверка FB2»' })).toBeVisible();
  await page.getByRole('button', { name: 'Читать «Проверка FB2»' }).click();
  await expect(page.locator('.reader iframe')).toBeVisible();
  await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
    'Абзац 1.',
  );
  await showControls(page);
  await page.getByRole('button', { name: 'Оглавление', exact: true }).click();
  await page.getByRole('button', { name: 'Вторая глава', exact: true }).click();
  await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
    'Последние строки истории.',
  );
  await page.getByRole('button', { name: 'Вернуться в библиотеку' }).click();
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'copy.fb2', mimeType: 'application/xml', buffer: fixture });
  await expect(page.getByRole('status')).toContainText('Уже в библиотеке: 1');
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'bad.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from('bad zip'),
  });
  await expect(page.getByRole('dialog')).toContainText('Не все книги удалось добавить');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Читать «Проверка FB2»' })).toHaveCount(1);
});
test('collections, favorite, backup download and restoration in a fresh browser context', async ({
  page,
  browser,
}) => {
  await ready(page);
  await page.getByRole('button', { name: 'Создать коллекцию', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Летние истории');
  await page.getByRole('button', { name: 'Создать коллекцию', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: /Летние истории/ })).toBeVisible();
  await page
    .locator('.filter-tabs')
    .getByRole('button', { name: 'Все книги', exact: true })
    .click();
  await page.getByRole('button', { name: 'Действия с книгой «Белые ночи»' }).click();
  await page.getByRole('button', { name: 'В избранное', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Летние истории', exact: true }).check();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page
    .locator('.filter-tabs')
    .getByRole('button', { name: 'Избранное', exact: true })
    .click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.locator('.bottom-nav').getByRole('button', { name: 'Настройки', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить резервную копию' }).click();
  const backup = await download;
  const path = await backup.path();
  expect(path).toBeTruthy();
  const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const fresh = await context.newPage();
  await ready(fresh);
  await fresh
    .locator('.bottom-nav')
    .getByRole('button', { name: 'Настройки', exact: true })
    .click();
  await fresh.locator('input[type=file][accept=".book"]').setInputFiles({
    name: 'backup.book',
    mimeType: 'application/zip',
    buffer: readFileSync(path!),
  });
  await expect(fresh.getByRole('status')).toContainText('Копия восстановлена');
  await fresh
    .locator('.bottom-nav')
    .getByRole('button', { name: 'Библиотека', exact: true })
    .click();
  await expect(fresh.getByRole('button', { name: 'Летние истории', exact: true })).toBeVisible();
  await fresh
    .locator('.filter-tabs')
    .getByRole('button', { name: 'Избранное', exact: true })
    .click();
  await expect(fresh.locator('.book-card')).toHaveCount(1);
  await expect(fresh.locator('.book-card')).toContainText('Белые ночи');
  await context.close();
});
for (const width of [320, 375, 390, 402, 430, 1440])
  test(`responsive library at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 874 });
    await ready(page);
    await expect(page.getByRole('heading', { name: /Библиотека/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `test-results/library-${width}-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
test('highlight with note, tap zones, scrolling mode and rotation', async ({ page }) => {
  await ready(page);
  await openSample(page);
  await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
  const body = page.frameLocator('.reader iframe').first().locator('body');
  await expect(body).toContainText('Была чудная ночь');
  await page.locator('.reader iframe').first().focus();
  await page
    .frameLocator('.reader iframe')
    .first()
    .locator('p')
    .first()
    .evaluate((el) => {
      const doc = el.ownerDocument;
      const node = el.firstChild!;
      const range = doc.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 25);
      const selection = doc.defaultView!.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      doc.dispatchEvent(new Event('selectionchange'));
    });
  await expect(page.getByRole('dialog', { name: 'Между строк', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: /Ваша заметка/ }).fill('Очень тёплая первая строка');
  await page.getByRole('button', { name: 'Сохранить заметку', exact: true }).click();
  await page.getByRole('button', { name: 'Закладки и заметки', exact: true }).click();
  await expect(page.locator('.annotation')).toContainText('Очень тёплая первая строка');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const stage = await page.locator('.reader-stage').boundingBox();
  for (let i = 0; i < 2; i++) {
    const previous = await position(page);
    await page.mouse.click(stage!.x + stage!.width - 16, stage!.y + stage!.height * 0.6);
    await expect.poll(async () => (await position(page))?.cfi).not.toBe(previous.cfi);
  }
  await page.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
  await page.getByRole('button', { name: 'Свиток', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.locator('.reader iframe')).toBeVisible();
  await page.setViewportSize({ width: 874, height: 402 });
  await expect(page.locator('.reader iframe')).toBeVisible();
  expect(await page.locator('.reader-stage').evaluate((el) => el.clientHeight)).toBeGreaterThan(
    150,
  );
  await page.getByRole('button', { name: 'Вернуться в библиотеку' }).click();
  await page.setViewportSize({ width: 402, height: 874 });
  await page
    .locator('.bottom-nav')
    .getByRole('button', { name: 'Между строк', exact: true })
    .click();
  await expect(page.locator('.note-card')).toContainText('Очень тёплая первая строка');
});

test('untrusted EPUB scripts and remote resources stay blocked', async ({ page }) => {
  await ready(page);
  const files = unzipSync(new Uint8Array(readFileSync('public/books/white-nights.epub')));
  files['OEBPS/content.opf'] = strToU8(
    strFromU8(files['OEBPS/content.opf']).replace(
      '<dc:title>Белые ночи</dc:title>',
      '<dc:title>Проверка безопасности</dc:title>',
    ),
  );
  files['OEBPS/c0.xhtml'] = strToU8(
    strFromU8(files['OEBPS/c0.xhtml']).replace(
      '</body>',
      `<script>parent.__bookAttack = true</script><img src="https://tracker.invalid/pixel" onerror="parent.__bookAttack=true"/></body>`,
    ),
  );
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('tracker.invalid')) remoteRequests.push(request.url());
  });
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'unsafe.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(zipSync(files)),
  });
  await page.getByRole('button', { name: 'Читать «Проверка безопасности»' }).click();
  await expect(page.locator('.reader iframe')).toBeVisible();
  const frame = page.frameLocator('.reader iframe').first();
  await expect(frame.locator('body')).toContainText('Иль был он создан');
  await expect(frame.locator('script')).toHaveCount(0);
  // Independently verify the chapter CSP even after sanitization has completed.
  await page.evaluate(() => {
    const doc = document.querySelector('iframe')!.contentDocument!;
    const script = doc.createElement('script');
    script.textContent = 'parent.__bookAttack = true';
    doc.body.append(script);
  });
  expect(
    await page.evaluate(() =>
      Boolean((window as unknown as { __bookAttack?: boolean }).__bookAttack),
    ),
  ).toBe(false);
  expect(remoteRequests).toEqual([]);
});
