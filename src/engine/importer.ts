import DOMPurify from 'dompurify';
import { zipSync, strToU8 } from 'fflate';
import { unpack } from '../lib/archive';
import { db } from '../lib/db';
import type { BookRecord, BookFormat } from '../types';
import {
  sanitizeChapter,
  parseBookXml as xml,
  decodeXml,
  bookPath as resolvePath,
  relativeBookPath,
  sanitizeSvg,
  rasterData,
} from './bookDocument';
import { inspectEpub, inspectFiles, bufferHash, NORMALIZER_VERSION } from './inspection';
import { deadline } from './readerFailure';
export { sanitizeChapter } from './bookDocument';

export const MAX_FILE_SIZE = 50 * 1024 * 1024;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const text = (el: Document | Element, name: string) =>
  el.getElementsByTagNameNS('*', name)[0]?.textContent?.trim() ?? '';
function imageData(file: Uint8Array, name: string) {
  const mime = /\.png$/i.test(name)
    ? 'image/png'
    : /\.gif$/i.test(name)
      ? 'image/gif'
      : /\.webp$/i.test(name)
        ? 'image/webp'
        : /\.jpe?g$/i.test(name)
          ? 'image/jpeg'
          : '';
  if (!mime || file.length > 3 * 1024 * 1024) return undefined;
  let binary = '';
  for (let i = 0; i < file.length; i += 8192)
    binary += String.fromCharCode(...file.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export interface Chapter {
  title: string;
  html: string;
}
export function createEpub(
  title: string,
  author: string,
  chapters: Chapter[],
  images: Record<string, Uint8Array> = {},
  coverPath?: string,
) {
  const identifier = crypto.randomUUID();
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  };
  const items = chapters.map((c, i) => {
    files[`OEBPS/chapter-${i}.xhtml`] = strToU8(
      sanitizeChapter(
        `<html xmlns="http://www.w3.org/1999/xhtml" lang="ru"><head><title>${escape(c.title)}</title></head><body><h1>${escape(c.title)}</h1>${c.html}</body></html>`,
      ),
    );
    return `<item id="c${i}" href="chapter-${i}.xhtml" media-type="application/xhtml+xml"/>`;
  });
  const imageItems = Object.entries(images).map(([name, data], i) => {
    files[`OEBPS/${name}`] = data;
    const mime = /\.png$/i.test(name)
      ? 'image/png'
      : /\.gif$/i.test(name)
        ? 'image/gif'
        : /\.webp$/i.test(name)
          ? 'image/webp'
          : 'image/jpeg';
    return `<item id="img${i}" href="${escape(name)}" media-type="${mime}"${name === coverPath ? ' properties="cover-image"' : ''}/>`;
  });
  files['OEBPS/content.opf'] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:${identifier}</dc:identifier><dc:title>${escape(title)}</dc:title><dc:creator>${escape(author)}</dc:creator><dc:language>ru</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest>${items.join('')}${imageItems.join('')}<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`,
  );
  files['OEBPS/nav.xhtml'] = strToU8(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Оглавление</title></head><body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="chapter-${i}.xhtml">${escape(c.title)}</a></li>`).join('')}</ol></nav></body></html>`,
  );
  return zipSync(files, { level: 0 }).buffer as ArrayBuffer;
}
export function convertFb2(bytes: Uint8Array) {
  const doc = xml(decodeXml(bytes));
  if (doc.documentElement.localName !== 'FictionBook')
    throw new Error('Файл не является книгой FB2.');
  const info = doc.getElementsByTagNameNS('*', 'title-info')[0];
  const title = info ? text(info, 'book-title') : '';
  const authors = info
    ? Array.from(info.getElementsByTagNameNS('*', 'author'))
        .map((a) =>
          ['first-name', 'middle-name', 'last-name']
            .map((n) => text(a, n))
            .filter(Boolean)
            .join(' '),
        )
        .filter(Boolean)
        .join(', ')
    : '';
  const images: Record<string, Uint8Array> = {};
  const imagePaths: Record<string, string> = {};
  Array.from(doc.getElementsByTagNameNS('*', 'binary')).forEach((el, i) => {
    const mime = el.getAttribute('content-type') ?? '';
    if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) return;
    const raw = (el.textContent ?? '').replace(/\s/g, '');
    if (raw.length > 4 * 1024 * 1024) return;
    try {
      const name = `image-${i}.${mime.split('/')[1]}`;
      images[name] = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      imagePaths[el.getAttribute('id') ?? ''] = name;
    } catch {
      /* Skip malformed image, preserve text. */
    }
  });
  const render = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent ?? '');
    if (!(node instanceof Element)) return '';
    const inner = () => Array.from(node.childNodes).map(render).join('');
    const map: Record<string, string> = {
      section: 'section',
      title: 'h2',
      subtitle: 'h3',
      p: 'p',
      strong: 'strong',
      emphasis: 'em',
      strikethrough: 's',
      sup: 'sup',
      sub: 'sub',
      code: 'code',
      cite: 'blockquote',
      poem: 'blockquote',
      stanza: 'div',
      v: 'p',
      'text-author': 'p',
      epigraph: 'blockquote',
      a: 'a',
      table: 'table',
      tr: 'tr',
      td: 'td',
      th: 'th',
    };
    if (node.localName === 'empty-line') return '<br/>';
    if (node.localName === 'image') {
      const ref =
        node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
        node.getAttribute('href') ??
        '';
      const path = imagePaths[ref.replace(/^#/, '')];
      return path ? `<img src="${path}" alt="Иллюстрация"/>` : '';
    }
    const tag = map[node.localName];
    if (!tag) return inner();
    const id = node.getAttribute('id');
    const ref =
      node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? node.getAttribute('href');
    const attrs =
      (id ? ` id="${escape(id)}"` : '') +
      (tag === 'a' && ref?.startsWith('#') ? ` href="${escape(ref)}"` : '');
    return `<${tag}${attrs}>${inner()}</${tag}>`;
  };
  const chapters: Chapter[] = [];
  Array.from(doc.documentElement.children)
    .filter((el) => el.localName === 'body')
    .forEach((body) => {
      Array.from(body.children).forEach((section, i) => {
        const heading = Array.from(section.children)
          .find((el) => el.localName === 'title')
          ?.textContent?.trim();
        if (section.localName === 'section')
          chapters.push({
            title: heading || `Глава ${i + 1}`,
            html: Array.from(section.childNodes)
              .filter((n) => !(n instanceof Element && n.localName === 'title'))
              .map(render)
              .join(''),
          });
        else if (section.localName !== 'title' && section.textContent?.trim())
          chapters.push({
            title: body.getAttribute('name') === 'notes' ? 'Примечания' : 'Вступление',
            html: render(section),
          });
      });
    });
  if (!chapters.length) throw new Error('В FB2 не найден текст книги.');
  const targets = new Map<string, number>();
  chapters.forEach((chapter, i) => {
    for (const match of chapter.html.matchAll(/ id="([^"]+)"/g)) targets.set(match[1], i);
  });
  chapters.forEach((chapter) => {
    chapter.html = chapter.html.replace(/ href="#([^"]+)"/g, (match, id: string) => {
      const target = targets.get(id);
      return target === undefined ? match : ` href="chapter-${target}.xhtml#${id}"`;
    });
  });
  const coverRef = info
    ?.getElementsByTagNameNS('*', 'coverpage')[0]
    ?.getElementsByTagNameNS('*', 'image')[0]
    ?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    ?.replace(/^#/, '');
  const coverPath = coverRef ? imagePaths[coverRef] : undefined;
  return {
    title: title || 'Без названия',
    author: authors || 'Автор не указан',
    description: info ? text(info, 'annotation') : '',
    cover: coverPath ? imageData(images[coverPath], coverPath) : undefined,
    data: createEpub(title || 'Без названия', authors, chapters, images, coverPath),
  };
}
export async function normalizeEpub(data: ArrayBuffer) {
  const files = await unpack(data.slice(0));
  if (!files['META-INF/container.xml']) throw new Error('В EPUB отсутствует container.xml.');
  const container = xml(decodeXml(files['META-INF/container.xml']));
  const packageRef = container
    .getElementsByTagNameNS('*', 'rootfile')[0]
    ?.getAttribute('full-path');
  const packagePath = packageRef ? resolvePath('container.xml', packageRef) : '';
  if (!packagePath || !files[packagePath]) throw new Error('Не найдено описание EPUB.');
  const opf = xml(decodeXml(files[packagePath]));
  if (
    Array.from(opf.getElementsByTagNameNS('*', 'meta')).some(
      (el) =>
        el.getAttribute('property') === 'rendition:layout' &&
        el.textContent?.trim() === 'pre-paginated',
    )
  )
    throw new Error('EPUB с фиксированной вёрсткой не поддерживается. Выберите текстовое издание.');
  const items = Array.from(opf.getElementsByTagNameNS('*', 'item'));
  const ids = new Set(items.map((el) => el.getAttribute('id')));
  const spine = Array.from(opf.getElementsByTagNameNS('*', 'itemref'));
  if (!spine.length || spine.some((el) => !ids.has(el.getAttribute('idref') ?? '')))
    throw new Error('Оглавление страниц EPUB повреждено.');
  if (files['META-INF/encryption.xml']) {
    const encryption = xml(decodeXml(files['META-INF/encryption.xml']));
    const encrypted = Array.from(encryption.getElementsByTagNameNS('*', 'CipherReference')).map(
      (el) => el.getAttribute('URI') ?? '',
    );
    if (encrypted.some((path) => !/\.(woff2?|ttf|otf)$/i.test(path)))
      throw new Error('Книги с DRM-защитой не поддерживаются. Добавьте EPUB без DRM.');
    delete files['META-INF/encryption.xml'];
  }
  const coverId = Array.from(opf.getElementsByTagNameNS('*', 'meta'))
    .find((el) => el.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  const coverItem =
    items.find((el) => el.getAttribute('properties')?.split(/\s/).includes('cover-image')) ??
    items.find((el) => el.id === coverId);
  const coverPath = coverItem
    ? resolvePath(packagePath, coverItem.getAttribute('href') ?? '')
    : undefined;
  const resolveImage = (base: string) => (href: string) => {
    if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(href)) return href;
    try {
      const path = resolvePath(base, href);
      return files[path] ? rasterData(files[path], path) : undefined;
    } catch {
      return undefined;
    }
  };
  // Preserve static SVG assets as sanitized images, never executable documents.
  for (const [path, bytes] of Object.entries(files))
    if (/\.svg$/i.test(path))
      files[path] = strToU8(sanitizeSvg(decodeXml(bytes), resolveImage(path)));
  for (const item of items) {
    const href = item.getAttribute('href') ?? '';
    const path = resolvePath(packagePath, href);
    if (item.getAttribute('media-type') === 'image/svg+xml' && files[path] && !/\.svg$/i.test(path))
      files[path] = strToU8(sanitizeSvg(decodeXml(files[path]), resolveImage(path)));
  }
  const redirects = new Map<string, string>();
  for (const ref of spine) {
    const item = items.find((el) => el.getAttribute('id') === ref.getAttribute('idref'))!;
    const mime = item.getAttribute('media-type') ?? '',
      path = resolvePath(packagePath, item.getAttribute('href') ?? '');
    if (mime === 'image/svg+xml' || /^image\/(png|jpeg|gif|webp)$/.test(mime)) {
      if (!files[path]) throw new Error('В EPUB отсутствует иллюстрированный раздел.');
      const wrapped = path + '.book.xhtml';
      const image = relativeBookPath(wrapped, path);
      files[wrapped] = strToU8(
        `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Иллюстрация</title></head><body><img src="${escape(image)}" alt="Иллюстрация"/></body></html>`,
      );
      const asset = opf.createElementNS(opf.documentElement.namespaceURI, 'item');
      asset.setAttribute('id', (item.getAttribute('id') ?? 'page') + '-book-image');
      asset.setAttribute('href', relativeBookPath(packagePath, path));
      asset.setAttribute('media-type', mime);
      opf.getElementsByTagNameNS('*', 'manifest')[0].append(asset);
      redirects.set(path, wrapped);
      item.setAttribute('href', relativeBookPath(packagePath, wrapped));
      item.setAttribute('media-type', 'application/xhtml+xml');
    }
  }
  const chapterPaths = new Set(
    items
      .filter((item) =>
        ['application/xhtml+xml', 'text/html'].includes(item.getAttribute('media-type') ?? ''),
      )
      .map((item) => resolvePath(packagePath, item.getAttribute('href') ?? '')),
  );
  for (const [name, bytes] of Object.entries(files)) {
    if (chapterPaths.has(name) || /\.(xhtml|html|htm)$/i.test(name)) {
      const cleaned = sanitizeChapter(decodeXml(bytes), resolveImage(name));
      const doc = xml(cleaned);
      for (const a of Array.from(doc.querySelectorAll('[href]'))) {
        const href = a.getAttribute('href')!;
        try {
          const replacement = redirects.get(resolvePath(name, href));
          if (replacement)
            a.setAttribute(
              'href',
              relativeBookPath(name, replacement) +
                (href.includes('#') ? '#' + href.split('#')[1] : ''),
            );
        } catch {
          /* External navigation has already been removed. */
        }
      }
      files[name] = strToU8(new XMLSerializer().serializeToString(doc));
    }
    if (/\.css$/i.test(name)) files[name] = strToU8('/* BOOK controls typography. */');
    if (/\.(js|mjs)$/i.test(name)) delete files[name];
  }
  // EPUB.js decodes archived XML as UTF-8. Do not leave a declared CP1251/UTF16
  // NCX beside the now UTF-8 package and chapter documents.
  for (const item of items) {
    if (item.getAttribute('media-type') !== 'application/x-dtbncx+xml') continue;
    const path = resolvePath(packagePath, item.getAttribute('href') ?? '');
    if (files[path]) {
      const doc = xml(decodeXml(files[path]));
      for (const content of Array.from(doc.getElementsByTagNameNS('*', 'content'))) {
        const src = content.getAttribute('src');
        if (!src) continue;
        const replacement = redirects.get(resolvePath(path, src));
        if (replacement)
          content.setAttribute(
            'src',
            relativeBookPath(path, replacement) +
              (src.includes('#') ? '#' + src.split('#')[1] : ''),
          );
      }
      files[path] = strToU8(new XMLSerializer().serializeToString(doc));
    }
  }
  for (const item of items) {
    const path = resolvePath(packagePath, item.getAttribute('href') ?? '');
    if (
      ['application/xhtml+xml', 'text/html'].includes(item.getAttribute('media-type') ?? '') &&
      !files[path]
    )
      throw new Error('В EPUB отсутствует раздел.');
  }
  files[packagePath] = strToU8(new XMLSerializer().serializeToString(opf));
  inspectFiles(files);
  return {
    title: text(opf, 'title') || 'Без названия',
    author: text(opf, 'creator') || 'Автор не указан',
    description: DOMPurify.sanitize(text(opf, 'description'), { ALLOWED_TAGS: [] }),
    cover: coverPath && files[coverPath] ? imageData(files[coverPath], coverPath) : undefined,
    data: zipSync(files, { level: 0 }).buffer as ArrayBuffer,
  };
}
export async function prepareBook(file: File) {
  if (file.size > MAX_FILE_SIZE) throw new Error('Размер файла превышает 50 МБ.');
  if (!file.size) throw new Error('Файл пуст.');
  const raw = await deadline(file.arrayBuffer(), 30000, 'file-read');
  if (!raw.byteLength || raw.byteLength !== file.size)
    throw new Error(
      'Файл ещё не загружен полностью. Дождитесь загрузки из iCloud Drive и повторите выбор.',
    );
  const hash = await bufferHash(raw);
  const ext = file.name.split('.').pop()?.toLowerCase();
  let format: BookFormat;
  let parsed: {
    title: string;
    author: string;
    description: string;
    cover?: string;
    data: ArrayBuffer;
  };
  if (ext === 'epub') {
    format = 'EPUB';
    parsed = await normalizeEpub(raw);
  } else if (ext === 'fb2') {
    format = 'FB2';
    parsed = convertFb2(new Uint8Array(raw));
  } else if (ext === 'zip') {
    const files = await unpack(raw.slice(0));
    const entry = Object.keys(files).find((name) => /\.fb2$/i.test(name));
    if (!entry) throw new Error('В ZIP не найден FB2. Для EPUB выберите файл .epub.');
    format = 'FB2';
    parsed = convertFb2(files[entry]);
  } else if (ext === 'txt') {
    format = 'TXT';
    if (raw.byteLength > 16 * 1024 * 1024) throw new Error('Для TXT максимальный размер — 16 МБ.');
    let source = new TextDecoder('utf-8').decode(raw);
    if ((source.match(/\ufffd/g)?.length ?? 0) > source.length / 100)
      source = new TextDecoder('windows-1251').decode(raw);
    if (!source.trim()) throw new Error('В файле не найден текст.');
    const paragraphs = source.split(/\r?\n\s*\r?\n|\r?\n/).filter((p) => p.trim());
    const chapters: Chapter[] = [];
    for (let i = 0; i < paragraphs.length; i += 80)
      chapters.push({
        title: chapters.length ? `Часть ${chapters.length + 1}` : file.name.replace(/\.txt$/i, ''),
        html: paragraphs
          .slice(i, i + 80)
          .map((p) => `<p>${escape(p)}</p>`)
          .join(''),
      });
    parsed = {
      title: file.name.replace(/\.txt$/i, ''),
      author: 'Автор не указан',
      description: '',
      data: createEpub(file.name.replace(/\.txt$/i, ''), '', chapters),
    };
  } else throw new Error('Выберите EPUB, FB2, FB2.ZIP или TXT.');
  const inspection = await inspectEpub(parsed.data);
  return {
    ...parsed,
    format,
    original: raw,
    hash,
    inspection,
    normalizerVersion: NORMALIZER_VERSION,
    normalizedHash: await bufferHash(parsed.data),
  };
}
export async function importBook(
  file: File,
  sample = false,
): Promise<{ book: BookRecord; duplicate: boolean }> {
  const prepared = await prepareBook(file);
  const {
    data,
    format,
    original: raw,
    hash,
    inspection,
    normalizerVersion,
    normalizedHash,
    ...metadata
  } = prepared;
  const existing = await db.books.where('hash').equals(hash).first();
  if (existing) {
    // A re-import is also an explicit repair request; deduplication must not
    // keep a broken normalized copy forever. Never touch user metadata/IDs.
    await db.transaction('rw', [db.books, db.files], async () => {
      if (await db.books.get(existing.id))
        await db.files.put({
          id: existing.id,
          data,
          original: raw,
          originalType: file.type || 'application/octet-stream',
          inspection,
          normalizerVersion,
          normalizedHash,
        });
    });
    return { book: existing, duplicate: true };
  }
  const book: BookRecord = {
    ...metadata,
    id: crypto.randomUUID(),
    hash,
    format,
    addedAt: Date.now(),
    lastReadAt: 0,
    size: file.size,
    fileName: file.name,
    status: 'new',
    favorite: false,
    collectionIds: [],
    sample,
  };
  await db.transaction('rw', [db.books, db.files], async () => {
    await db.books.add(book);
    await db.files.add({
      id: book.id,
      data,
      inspection,
      normalizerVersion,
      normalizedHash,
      original: raw,
      originalType: file.type || 'application/octet-stream',
    });
  });
  return { book, duplicate: false };
}
