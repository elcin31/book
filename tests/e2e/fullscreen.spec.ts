import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const title = 'Проверка полного экрана';
const paragraphs = Array.from(
  { length: 220 },
  (_, i) =>
    `<p id="paragraph-${i}">Абзац ${i + 1}. Читатель открывает новую страницу и продолжает историю. Летний вечер постепенно сменяется тишиной, а знакомые слова складываются в длинное путешествие.</p>`,
).join('');
function fixture(format: 'EPUB' | 'FB2', language = 'ru') {
  if (format === 'FB2')
    return Buffer.from(
      `<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>${title}</book-title><author><first-name>Автор</first-name></author><lang>ru</lang></title-info></description><body><section><title><p>Первая глава</p></title>${paragraphs}</section></body></FictionBook>`,
    );
  const files = unzipSync(new Uint8Array(readFileSync('public/books/white-nights.epub')));
  files['OEBPS/content.opf'] = strToU8(
    strFromU8(files['OEBPS/content.opf'])
      .replace(/<dc:title>.*?<\/dc:title>/, `<dc:title>${title}</dc:title>`)
      .replace('<dc:language>ru</dc:language>', `<dc:language>${language}</dc:language>`),
  );
  files['OEBPS/c0.xhtml'] = strToU8(
    `<html xmlns="http://www.w3.org/1999/xhtml" lang="${language}"><head><title>Первая глава</title></head><body><h1>Первая глава</h1>${paragraphs}</body></html>`,
  );
  return Buffer.from(zipSync(files));
}
async function openBook(page: Page, format: 'EPUB' | 'FB2', language = 'ru') {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Читать «Белые ночи»' })).toBeVisible();
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: `fullscreen.${format.toLowerCase()}`,
    mimeType: 'application/octet-stream',
    buffer: fixture(format, language),
  });
  await page.getByRole('button', { name: `Читать «${title}»` }).click();
  await expect(page.locator('.reader iframe')).toBeVisible();
  await settled(page);
}
async function cfi(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith('book-position:'));
    return key ? (JSON.parse(localStorage.getItem(key)!).cfi as string) : '';
  });
}
async function centerTap(page: Page) {
  const box = await page.locator('.reader-stage').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}
async function controls(page: Page, visible: boolean) {
  if (
    (await page.locator('.reader').evaluate((el) => !el.classList.contains('chrome-hidden'))) !==
    visible
  )
    await centerTap(page);
  await expect(page.locator('.reader-header')).toHaveAttribute('aria-hidden', String(!visible));
}
async function settled(page: Page) {
  await expect(page.locator('.reader-mount')).toHaveAttribute('data-layout-state', 'ready');
  await expect
    .poll(() =>
      page.locator('.reader-stage').evaluate((el) => {
        const container = el.querySelector('.epub-container') as HTMLElement | null;
        return container ? Math.abs(container.clientHeight - Math.floor(el.clientHeight)) : 1000;
      }),
    )
    .toBeLessThan(1);
  await expect(page.locator('.reader-mount')).toHaveAttribute('data-layout-state', 'ready');
}
async function shape(page: Page) {
  return page.locator('.reader-stage').evaluate((el) => {
    const box = el.getBoundingClientRect(),
      root = el.closest('.reader')!,
      style = getComputedStyle(root);
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      right: box.right,
      bottom: box.bottom,
      viewport: innerHeight,
      topSafe: parseFloat(style.getPropertyValue('--reader-safe-top')) || 0,
      bottomSafe: parseFloat(style.getPropertyValue('--reader-safe-bottom')) || 0,
    };
  });
}
async function lines(page: Page) {
  return page.locator('.reader-stage').evaluate((el) => {
    const stage = el.getBoundingClientRect(),
      iframe = el.querySelector('iframe')!,
      frameBox = iframe.getBoundingClientRect();
    const doc = iframe.contentDocument!,
      walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const visible: { top: number; bottom: number }[] = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        const left = frameBox.left + rect.left,
          right = frameBox.left + rect.right;
        const top = frameBox.top + rect.top,
          bottom = frameBox.top + rect.bottom;
        if (
          rect.width > 0 &&
          left < stage.right - 2 &&
          right > stage.left + 2 &&
          top < stage.bottom - 2 &&
          bottom > stage.top + 2
        )
          visible.push({ top, bottom });
      }
    }
    return {
      count: visible.length,
      top: Math.min(...visible.map((r) => r.top)),
      bottom: Math.max(...visible.map((r) => r.bottom)),
      clipped: visible.filter((r) => r.top < stage.top - 1 || r.bottom > stage.bottom + 1),
    };
  });
}
async function textAnchor(page: Page) {
  return page.locator('.reader-stage').evaluate((el) => {
    const stage = el.getBoundingClientRect(),
      iframe = el.querySelector('iframe')!,
      frame = iframe.getBoundingClientRect(),
      doc = iframe.contentDocument!;
    const paras = Array.from(doc.querySelectorAll('p'));
    for (let index = 0; index < paras.length; index++) {
      const p = paras[index];
      if (
        !Array.from(p.getClientRects()).some(
          (r) =>
            r.right + frame.x > stage.left + 1 &&
            r.left + frame.x < stage.right - 1 &&
            r.bottom + frame.y > stage.top + 1 &&
            r.top + frame.y < stage.bottom - 1,
        )
      )
        continue;
      const node = p.firstChild!;
      for (let offset = 0; offset < (node.textContent?.length ?? 0); offset++) {
        const range = doc.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const r = range.getBoundingClientRect();
        if (
          r.width &&
          r.left + frame.x >= stage.left &&
          r.right + frame.x <= stage.right &&
          r.top + frame.y >= stage.top &&
          r.bottom + frame.y <= stage.bottom
        )
          return { index, offset };
      }
    }
    throw new Error('No visible paragraph anchor');
  });
}
async function anchorVisible(page: Page, anchor: { index: number; offset: number }) {
  return page.locator('.reader-stage').evaluate((el, anchor) => {
    const stage = el.getBoundingClientRect(),
      iframe = el.querySelector('iframe')!,
      frame = iframe.getBoundingClientRect(),
      doc = iframe.contentDocument!;
    const node = doc.querySelectorAll('p')[anchor.index].firstChild!;
    const range = doc.createRange();
    range.setStart(node, anchor.offset);
    range.setEnd(node, anchor.offset + 1);
    const rect = range.getBoundingClientRect();
    return (
      rect.left + frame.x >= stage.left - 1 &&
      rect.right + frame.x <= stage.right + 1 &&
      rect.top + frame.y >= stage.top - 1 &&
      rect.bottom + frame.y <= stage.bottom + 1
    );
  }, anchor);
}
async function next(page: Page) {
  const before = await cfi(page),
    box = await page.locator('.reader-stage').boundingBox();
  await page.mouse.click(box!.x + box!.width - 8, box!.y + box!.height / 2);
  await expect.poll(() => cfi(page)).not.toBe(before);
}
async function appearance(page: Page) {
  await controls(page, true);
  await page.getByRole('button', { name: 'Настройки чтения', exact: true }).click();
}
async function closeAppearance(page: Page) {
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await controls(page, false);
  await settled(page);
}

for (const width of [375, 390, 402])
  for (const format of ['EPUB', 'FB2'] as const) {
    test(`${format}: immersive geometry, font sizes and CFI at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 874 });
      await openBook(page, format);
      await expect(page.locator('.reader')).toHaveClass(/chrome-hidden/);
      const initial = await shape(page);
      expect(initial.y).toBe(12);
      expect(initial.height).toBe(836);
      const iframe = await page.locator('.reader iframe').elementHandle();
      const initialCfi = await cfi(page);
      for (let i = 0; i < 3; i++) {
        await controls(page, true);
        expect(await shape(page)).toEqual(initial);
        await controls(page, false);
        expect(await shape(page)).toEqual(initial);
      }
      expect(await iframe!.evaluate((el) => el === document.querySelector('.reader iframe'))).toBe(
        true,
      );
      expect(await cfi(page)).toBe(initialCfi);
      for (let i = 0; i < 3; i++) {
        await next(page);
        const result = await lines(page);
        expect(result.count).toBeGreaterThan(8);
        expect(result.clipped).toEqual([]);
      }
      const saved = await cfi(page),
        anchor = await textAnchor(page);
      for (const size of [14, 36]) {
        await appearance(page);
        await page.getByRole('slider', { name: 'Размер текста', exact: true }).fill(String(size));
        await expect
          .poll(() =>
            page
              .frameLocator('.reader iframe')
              .first()
              .locator('body')
              .evaluate((el) => getComputedStyle(el).fontSize),
          )
          .toBe(`${size}px`);
        await closeAppearance(page);
        expect(await cfi(page)).toBe(saved);
        expect(await anchorVisible(page, anchor)).toBe(true);
        expect((await lines(page)).clipped).toEqual([]);
      }
      await page.setViewportSize({ width: 874, height: width });
      await settled(page);
      expect(await cfi(page)).toBe(saved);
      expect(await anchorVisible(page, anchor)).toBe(true);
      expect((await lines(page)).clipped).toEqual([]);
      await appearance(page);
      await page.getByRole('button', { name: 'Свиток', exact: true }).click();
      await page.getByRole('slider', { name: 'Вертикальные поля', exact: true }).fill('20');
      await closeAppearance(page);
      expect(await cfi(page)).toBe(saved);
      expect(await anchorVisible(page, anchor)).toBe(true);
      const container = page.locator('.reader .epub-container');
      const beforeScroll = await container.evaluate((el) => el.scrollTop);
      const box = await page.locator('.reader-stage').boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.wheel(0, 450);
      await expect
        .poll(() => container.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(beforeScroll);
      await expect.poll(() => cfi(page)).not.toBe(saved);
      const scrolled = await cfi(page);
      await page.setViewportSize({ width, height: 874 });
      await settled(page);
      expect(await cfi(page)).toBe(scrolled);
    });
  }

test('standalone flags and simulated iPhone safe areas leave system indicators clear', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      new Proxy(original(query), {
        get(target, key) {
          if (key === 'matches' && query === '(display-mode: standalone)') return true;
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
  });
  await page.goto('/');
  await page.addStyleTag({
    content: '.reader { --reader-safe-top: 62px; --reader-safe-bottom: 34px; }',
  });
  await expect(page.getByRole('button', { name: 'Читать «Белые ночи»' })).toBeVisible();
  await page.getByRole('button', { name: 'Читать «Белые ночи»' }).click();
  await expect(page.locator('.reader iframe')).toBeVisible();
  await settled(page);
  expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true);
  expect((await shape(page)).height).toBe(740);
  expect((await shape(page)).y).toBe(74);
  const result = await lines(page);
  expect(result.top).toBeGreaterThanOrEqual(74);
  expect(result.clipped).toEqual([]);
  await controls(page, true);
  expect(
    (await page.getByRole('button', { name: 'Вернуться в библиотеку' }).boundingBox())!.y,
  ).toBeGreaterThanOrEqual(62);
  const footer = await page.locator('.reader-page-controls').boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(840);
  await page.addStyleTag({
    content:
      '.reader { --reader-safe-top: 0px; --reader-safe-bottom: 21px; --reader-safe-left: 62px; --reader-safe-right: 62px; }',
  });
  await page.setViewportSize({ width: 874, height: 402 });
  await settled(page);
  const landscape = await shape(page);
  expect(landscape.x).toBe(78);
  expect(landscape.right).toBe(796);
  await controls(page, false);
  expect((await lines(page)).clipped).toEqual([]);
});

test('presets, custom fields and progress preserve old settings and the book structure', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'book-preferences',
      JSON.stringify({
        version: 1,
        state: {
          reader: {
            theme: 'sepia',
            font: 'classic',
            fontSize: 27,
            lineHeight: 1.7,
            margins: 38,
            letterSpacing: 0.2,
            paragraphSpacing: 0.8,
            align: 'justify',
            flow: 'paginated',
            bold: false,
            brightness: 80,
            keepAwake: false,
          },
          goal: 30,
          appTheme: 'light',
        },
      }),
    ),
  );
  await openBook(page, 'EPUB', 'en');
  const body = page.frameLocator('.reader iframe').first().locator('body');
  expect(await body.evaluate((el) => getComputedStyle(el).fontSize)).toBe('27px');
  expect(await body.evaluate((el) => el.ownerDocument.documentElement.lang)).toBe('en');
  expect(await body.locator('p').count()).toBe(220);
  await appearance(page);
  await expect(page.getByRole('slider', { name: 'Горизонтальные поля' })).toHaveValue('38');
  await page.getByRole('button', { name: 'Узкие 14 px', exact: true }).click();
  await page.getByRole('slider', { name: 'Вертикальные поля' }).fill('6');
  await page.getByRole('slider', { name: 'Отступ первой строки' }).fill('0.5');
  await page.getByRole('button', { name: 'По левому краю', exact: true }).click();
  await page.getByRole('switch', { name: /Прогресс без панелей/ }).click();
  await closeAppearance(page);
  expect((await shape(page)).x).toBe(14);
  expect((await shape(page)).height).toBe(862);
  await expect(page.locator('.reader-mini-progress')).toHaveCount(0);
  expect(await body.locator('p').count()).toBe(220);
  expect(await body.locator('p').first().getAttribute('id')).toBe('paragraph-0');
  expect(await body.evaluate((el) => getComputedStyle(el).fontSize)).toBe('27px');
  await expect
    .poll(() =>
      body
        .locator('p')
        .first()
        .evaluate((el) => getComputedStyle(el).textIndent),
    )
    .toBe('13.5px');
  await appearance(page);
  await page.getByRole('button', { name: 'Широкие 36 px', exact: true }).click();
  await closeAppearance(page);
  expect((await shape(page)).x).toBe(36);
  await appearance(page);
  await page.getByRole('button', { name: 'Пользовательские', exact: false }).click();
  await page.getByRole('slider', { name: 'Горизонтальные поля' }).fill('18');
  await closeAppearance(page);
  expect((await shape(page)).x).toBe(18);
});
