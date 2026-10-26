import { strToU8, zipSync } from 'fflate';
export const BOOK_TEXT =
  'Живой текст независимой книги. Читатель открывает страницу и видит настоящую историю.';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
export const raster = Uint8Array.from(Buffer.from(png, 'base64'));
const paragraph = (i: number) =>
  `<p id="p${i}">${BOOK_TEXT} Абзац ${i}. Это продолжение главы с несколькими строками для перелистывания.</p>`;
function cp1251(source: string) {
  return Uint8Array.from(
    Array.from(source, (c) =>
      c === 'ё'
        ? 184
        : c === 'Ё'
          ? 168
          : c.charCodeAt(0) >= 1040 && c.charCodeAt(0) <= 1103
            ? c.charCodeAt(0) - 848
            : c.charCodeAt(0),
    ),
  );
}
export interface FixtureBook {
  name: string;
  bytes: Uint8Array;
  text?: string;
  image?: boolean;
  blank?: boolean;
}
export function epubFixture(kind = 'epub3', count = 45): FixtureBook {
  const two = kind.startsWith('epub2');
  const direct = kind.endsWith('direct-svg');
  const prefixed = kind === 'prefixed';
  const cover = kind === 'svg-cover' || kind === 'vector-cover' || direct;
  const firstBlank = kind === 'blank';
  const front = cover || firstBlank || kind === 'title';
  const nested = 'OPS/Text/chapter.xhtml';
  const svg =
    kind === 'vector-cover'
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600"><rect width="400" height="600" fill="#34614a"/><text x="25" y="120" fill="white" font-size="30">BOOK COVER</text></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="600" viewBox="0 0 400 600"><image width="400" height="600" xlink:href="../Images/cover.png"/></svg>';
  let chapter = `<html xmlns="http://www.w3.org/1999/xhtml" lang="ru"><head><title>Глава</title><link rel="stylesheet" href="../Styles/publisher.css"/></head><body><h1>Первая глава</h1>${Array.from({ length: count }, (_, i) => paragraph(i)).join('')}<img src="../Images/cover.png" alt="Иллюстрация"/></body></html>`;
  if (prefixed)
    chapter = chapter
      .replace(/<(\/?)(html|head|title|body|h1|p|img|link)(\b)/g, '<$1x:$2$3')
      .replace('xmlns="http://www.w3.org/1999/xhtml"', 'xmlns:x="http://www.w3.org/1999/xhtml"');
  const opf = `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="${two ? '2.0' : '3.0'}" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture-${kind}</dc:identifier><dc:title>Independent ${kind}</dc:title><dc:creator>Test author</dc:creator><dc:language>ru</dc:language>${two ? '' : '<meta property="dcterms:modified">2026-10-26T00:00:00Z</meta>'}</metadata><manifest>${front ? `<item id="cover" href="Text/cover.${direct ? 'svg' : 'xhtml'}" media-type="${direct ? 'image/svg+xml' : 'application/xhtml+xml'}"/>` : ''}<item id="c1" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="Text/sub/second.xhtml" media-type="application/xhtml+xml"/><item id="img" href="Images/cover.png" media-type="image/png"/><item id="css" href="Styles/publisher.css" media-type="text/css"/>${two ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'}</manifest><spine${two ? ' toc="ncx"' : ''}>${front ? '<itemref idref="cover"/>' : ''}<itemref idref="c1"/><itemref idref="c2"/></spine></package>`;
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'OPS/package.opf': strToU8(opf),
    [nested]: strToU8(chapter),
    'OPS/Text/sub/second.xhtml': strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Вторая</title></head><body><h1>Вторая глава</h1><p>Конец независимой книги.</p></body></html>`,
    ),
    'OPS/Images/cover.png': raster,
    'OPS/Styles/publisher.css': strToU8(
      'body { color: white; background: black; } p { font-size: 22px; }',
    ),
  };
  if (two)
    files['OPS/toc.ncx'] = strToU8(
      `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>EPUB2</text></docTitle><navMap>${direct ? '<navPoint id="cover" playOrder="0"><navLabel><text>Обложка</text></navLabel><content src="Text/cover.svg"/></navPoint>' : ''}<navPoint id="c1" playOrder="1"><navLabel><text>Первая глава</text></navLabel><content src="Text/chapter.xhtml"/></navPoint></navMap></ncx>`,
    );
  else
    files['OPS/nav.xhtml'] = strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>TOC</title></head><body><nav epub:type="toc"><ol><li><a href="Text/chapter.xhtml">Первая глава</a><ol><li><a href="Text/sub/second.xhtml">Вторая глава</a></li></ol></li></ol></nav></body></html>',
    );
  if (front)
    files[`OPS/Text/cover.${direct ? 'svg' : 'xhtml'}`] = strToU8(
      direct
        ? svg
        : `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Обложка</title></head><body>${firstBlank ? '' : kind === 'title' ? '<h1>Титульная страница</h1><p>Издание независимой книги.</p>' : svg}</body></html>`,
    );
  if (kind === 'broken-spine') delete files[nested];
  if (kind === 'empty') {
    files[nested] = strToU8(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Empty</title></head><body/></html>',
    );
    delete files['OPS/Text/sub/second.xhtml'];
    files['OPS/package.opf'] = strToU8(
      opf
        .replace('<itemref idref="c2"/>', '')
        .replace(
          '<item id="c2" href="Text/sub/second.xhtml" media-type="application/xhtml+xml"/>',
          '',
        ),
    );
  }
  if (kind === 'escaped-path') {
    files['OPS/package one.opf'] = strToU8(
      new TextDecoder()
        .decode(files['OPS/package.opf'])
        .replaceAll('Text/chapter.xhtml', 'Text/chapter%20one.xhtml'),
    );
    delete files['OPS/package.opf'];
    files['META-INF/container.xml'] = strToU8(
      new TextDecoder()
        .decode(files['META-INF/container.xml'])
        .replace('OPS/package.opf', 'OPS/package%20one.opf'),
    );
    files['OPS/Text/chapter one.xhtml'] = files[nested];
    delete files[nested];
    files['OPS/nav.xhtml'] = strToU8(
      new TextDecoder()
        .decode(files['OPS/nav.xhtml'])
        .replaceAll('Text/chapter.xhtml', 'Text/chapter%20one.xhtml'),
    );
  }
  return {
    name: `${kind}.epub`,
    bytes: zipSync(files, { level: 6 }),
    text: BOOK_TEXT,
    image: cover,
    blank: firstBlank,
  };
}
export function fb2Fixture(zipped = false, encoding = 'utf-8'): FixtureBook {
  const source = `<?xml version="1.0" encoding="${encoding}"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Independent FB2 ${encoding}</book-title><author><first-name>Автор</first-name></author><lang>ru</lang></title-info></description><body><section><title><p>Первая глава</p></title>${Array.from({ length: 60 }, (_, i) => paragraph(i)).join('')}</section></body></FictionBook>`;
  const bytes = encoding === 'windows-1251' ? cp1251(source) : strToU8(source);
  return {
    name: zipped ? 'fixture.fb2.zip' : 'fixture.fb2',
    bytes: zipped ? zipSync({ 'nested/book.fb2': bytes }) : bytes,
    text: BOOK_TEXT,
  };
}
export function txtFixture(encoding = 'utf-8'): FixtureBook {
  const source = Array.from({ length: 90 }, (_, i) => `${BOOK_TEXT} Строка ${i}.`).join('\n\n');
  return {
    name: `Independent TXT ${encoding}.txt`,
    bytes: encoding === 'windows-1251' ? cp1251(source) : strToU8(source),
    text: BOOK_TEXT,
  };
}
