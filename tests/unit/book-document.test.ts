import { expect, it } from 'vitest';
import { sanitizeChapter } from '../../src/engine/importer';
it('preserves text in prefixed XHTML', () => {
  const html = sanitizeChapter(
    '<x:html xmlns:x="http://www.w3.org/1999/xhtml"><x:head><x:title>Title</x:title></x:head><x:body><x:p>VISIBLE PREFIXED TEXT</x:p></x:body></x:html>',
  );
  expect(html).toContain('VISIBLE PREFIXED TEXT');
});
it('preserves a raster image wrapped in SVG', () => {
  const html = sanitizeChapter(
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 600"><image width="400" height="600" xlink:href="cover.jpg"/></svg></body></html>',
  );
  expect(html).toContain('cover.jpg');
});
