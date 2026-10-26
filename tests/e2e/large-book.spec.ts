import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { epubFixture, BOOK_TEXT } from '../support/books';

test('large independent EPUB opens and reopens with bounded time', async ({
  page,
  browserName,
}, info) => {
  test.setTimeout(120000);
  const files = unzipSync(epubFixture('epub3', 300).bytes);
  // A real raster resource, 12 MiB of incompressible RGB pixels. No ZIP bomb,
  // huge single DOM, copyrighted content or dependency on the demo library.
  files['OPS/Images/large.png'] = await sharp(randomBytes(2048 * 2048 * 3), {
    raw: { width: 2048, height: 2048, channels: 3 },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  files['OPS/package.opf'] = strToU8(
    strFromU8(files['OPS/package.opf']).replace(
      '</manifest>',
      '<item id="large" href="Images/large.png" media-type="image/png"/></manifest>',
    ),
  );
  const bytes = zipSync(files, { level: 0 });
  await page.goto('/');
  await expect(page.locator('.book-card')).toHaveCount(3);
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : undefined;
  let peakJsBytes = 0,
    peakBackingBytes = 0;
  const sample = async () => {
    if (!cdp) return;
    const memory = await cdp.send('Runtime.getHeapUsage');
    peakJsBytes = Math.max(peakJsBytes, memory.usedSize);
    peakBackingBytes = Math.max(peakBackingBytes, memory.backingStorageSize ?? 0);
  };
  await sample();
  const timer = setInterval(() => void sample().catch(() => {}), 200);
  const started = Date.now();
  try {
    await page.locator('input[type=file][multiple]').setInputFiles({
      name: 'large-independent.epub',
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(bytes),
    });
    await expect(page.locator('.book-card')).toHaveCount(4, { timeout: 60000 });
    const imported = Date.now();
    await page.locator('.book-card').first().locator('.book-open').click();
    await expect(page.locator('.reader-mount')).toHaveAttribute('data-layout-state', 'ready', {
      timeout: 60000,
    });
    await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
      BOOK_TEXT,
    );
    await expect(page.locator('.reader-status')).toHaveCount(0);
    const opened = Date.now();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator('.book-card').first().locator('.book-open').click();
    await expect(page.locator('.reader-mount')).toHaveAttribute('data-layout-state', 'ready', {
      timeout: 60000,
    });
    await expect(page.frameLocator('.reader iframe').first().locator('body')).toContainText(
      BOOK_TEXT,
    );
    await sample();
    const measurements = {
      browserName,
      fileBytes: bytes.byteLength,
      importMs: imported - started,
      openMs: opened - imported,
      reopenIncludingReloadMs: Date.now() - opened,
      sampledRendererJsHeapBytes: cdp ? peakJsBytes : null,
      sampledRendererBackingStorageBytes: cdp ? peakBackingBytes : null,
      note: '200 ms samples; excludes workers, native/WebKit allocations and GPU; not a device peak',
    };
    console.log('LARGE_BOOK', JSON.stringify(measurements));
    await info.attach('large-book-metrics', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
    expect(opened - started).toBeLessThan(60000);
  } finally {
    clearInterval(timer);
    await cdp?.detach();
  }
});
