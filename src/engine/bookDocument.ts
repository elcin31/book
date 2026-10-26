import DOMPurify from 'dompurify';
export const XHTML_NS = 'http://www.w3.org/1999/xhtml';
export function decodeXml(bytes: Uint8Array): string {
  const header = new TextDecoder().decode(bytes.subarray(0, 256));
  const encoding =
    bytes[0] === 255 && bytes[1] === 254
      ? 'utf-16le'
      : bytes[0] === 254 && bytes[1] === 255
        ? 'utf-16be'
        : (header.match(/encoding\s*=\s*["']([^"']+)/i)?.[1] ?? 'utf-8');
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Не удалось прочитать XML-кодировку книги.');
  }
}
function withoutDoctype(source: string) {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source))
    throw new Error('DTD и внешние сущности в книге запрещены.');
  // An external XHTML/NCX doctype is a declaration, never fetched by BOOK.
  return source.replace(/<!DOCTYPE[^>]*>/gi, '');
}
export function parseBookXml(source: string): XMLDocument {
  const doc = new DOMParser().parseFromString(withoutDoctype(source), 'application/xml');
  if (
    doc.getElementsByTagNameNS('*', 'parsererror').length ||
    doc.documentElement.localName === 'parsererror'
  )
    throw new Error('В книге повреждена структура XML.');
  return doc;
}
export function bookPath(base: string, relative: string): string {
  const ref = relative.trim();
  if (!ref || /^[a-z][a-z\d+.-]*:|^\/\//i.test(ref) || ref.includes('\\'))
    throw new Error('Недопустимая внешняя ссылка в EPUB.');
  const url = new URL(ref, 'https://book.invalid/' + base);
  if (url.origin !== 'https://book.invalid') throw new Error('Внешние разделы EPUB запрещены.');
  try {
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error('Некорректный путь раздела EPUB.');
  }
}
export function relativeBookPath(base: string, path: string): string {
  const from = base.split('/');
  from.pop();
  const to = path.split('/');
  while (from.length && to[0] === from[0]) {
    from.shift();
    to.shift();
  }
  return '../'.repeat(from.length) + to.map(encodeURIComponent).join('/');
}
export function rasterData(bytes: Uint8Array, name: string): string | undefined {
  const mime = /\.png$/i.test(name)
    ? 'image/png'
    : /\.jpe?g$/i.test(name)
      ? 'image/jpeg'
      : /\.gif$/i.test(name)
        ? 'image/gif'
        : /\.webp$/i.test(name)
          ? 'image/webp'
          : '';
  if (!mime) return;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
function dataUri(mime: string, source: string) {
  const bytes = new TextEncoder().encode(source);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export type ImageResolver = (href: string) => string | undefined;
export function sanitizeSvg(source: string, resolve?: ImageResolver): string {
  const clean = DOMPurify.sanitize(withoutDoctype(source), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      'script',
      'style',
      'foreignObject',
      'animate',
      'animateMotion',
      'animateTransform',
      'set',
      'a',
      'feImage',
    ],
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
  });
  const doc = parseBookXml(clean);
  if (doc.documentElement.localName !== 'svg') throw new Error('Повреждена SVG-иллюстрация.');
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (
        /^on/i.test(attr.name) ||
        /(?:javascript:|^\s*(?:https?:|\/\/)|url\(\s*['"]?(?!#))/i.test(attr.value)
      ) {
        el.removeAttributeNode(attr);
        continue;
      }
      if (attr.localName === 'href') {
        if (attr.value.startsWith('#')) continue;
        const image =
          el.localName === 'image'
            ? (resolve?.(attr.value) ??
              (/^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(attr.value)
                ? attr.value
                : undefined))
            : undefined;
        el.removeAttributeNode(attr);
        if (image) el.setAttribute('href', image);
      }
    }
  });
  doc.querySelectorAll('image').forEach((el) => {
    if (!el.getAttribute('href')) el.remove();
  });
  return new XMLSerializer().serializeToString(doc);
}
function canonicalMarkup(source: string) {
  source = withoutDoctype(source);
  const parsed = new DOMParser().parseFromString(source, 'application/xml');
  if (parsed.getElementsByTagNameNS('*', 'parsererror').length) return source; // HTML5/EPUB2 HTML is normalized below.
  let converted = false;
  for (const el of Array.from(parsed.getElementsByTagNameNS(XHTML_NS, '*'))) {
    if (!el.prefix) continue;
    converted = true;
    const replacement = parsed.createElementNS(XHTML_NS, el.localName);
    for (const attr of Array.from(el.attributes))
      if (!attr.name.startsWith('xmlns')) replacement.setAttribute(attr.name, attr.value);
    while (el.firstChild) replacement.append(el.firstChild);
    el.replaceWith(replacement);
  }
  if (!converted) return source;
  parsed.querySelectorAll('iframe,script,object,embed').forEach((el) => el.remove());
  return new XMLSerializer().serializeToString(parsed);
}
export function sanitizeChapter(source: string, resolve?: ImageResolver): string {
  const original = new DOMParser().parseFromString(canonicalMarkup(source), 'text/html');
  const generated = new Set<string>();
  original.querySelectorAll('svg').forEach((svg) => {
    const images = svg.querySelectorAll('image');
    const onlyImage =
      images.length === 1 &&
      !svg.textContent?.trim() &&
      !svg.querySelector('path,rect,circle,ellipse,polygon,polyline,line,use');
    const img = original.createElement('img');
    if (onlyImage) {
      img.src = images[0].getAttribute('href') ?? images[0].getAttribute('xlink:href') ?? '';
    } else {
      const uri = dataUri(
        'image/svg+xml',
        sanitizeSvg(new XMLSerializer().serializeToString(svg), resolve),
      );
      generated.add(uri);
      img.src = uri;
    }
    const viewBox = svg
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/);
    for (const [name, index] of [
      ['width', 2],
      ['height', 3],
    ] as const) {
      const value = svg.getAttribute(name) ?? viewBox?.[index];
      if (value && /^\d+(\.\d+)?$/.test(value)) img.setAttribute(name, value);
    }
    img.alt = 'Иллюстрация';
    svg.replaceWith(img);
  });
  const clean = DOMPurify.sanitize(original.documentElement.outerHTML, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'video',
      'audio',
      'source',
      'link',
      'base',
      'style',
      'svg',
      'math',
    ],
    FORBID_ATTR: [
      'style',
      'srcset',
      'target',
      'xlink:href',
      'color',
      'bgcolor',
      'background',
      'face',
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['epub:type', 'xmlns:epub', 'xml:lang'],
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('meta').forEach((el) => el.remove());
  doc.querySelectorAll('[src],[href]').forEach((el) => {
    for (const attr of ['src', 'href']) {
      const value = el.getAttribute(attr)?.trim();
      if (
        value &&
        (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || value.includes('\\')) &&
        !(
          attr === 'src' &&
          (/^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=\s]+$/i.test(value) ||
            generated.has(value))
        )
      )
        el.removeAttribute(attr);
    }
  });
  // HTML parsers represent a literal xmlns as an ordinary attribute. Remove it
  // before XMLSerializer supplies the real namespace (notably jsdom/WebKit variants).
  doc.querySelectorAll('*').forEach((el) => {
    if (el.namespaceURI === XHTML_NS) el.removeAttribute('xmlns');
  });
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content =
    "default-src 'none'; script-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; base-uri 'none'; form-action 'none'";
  doc.head.prepend(csp);
  const result = new XMLSerializer().serializeToString(doc);
  parseBookXml(result);
  return result;
}
