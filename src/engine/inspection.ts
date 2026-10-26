import { unpack } from '../lib/archive';
import { bookPath, decodeXml, parseBookXml } from './bookDocument';
export const NORMALIZER_VERSION = 2;
export interface BookSection {
  href: string;
  path: string;
  kind: 'text' | 'image' | 'empty';
  textLength: number;
}
export interface BookInspection {
  packagePath: string;
  sections: BookSection[];
  firstTextHref?: string;
  firstContentHref: string;
}
export function inspectFiles(files: Record<string, Uint8Array>): BookInspection {
  if (!files['META-INF/container.xml']) throw new Error('В EPUB отсутствует container.xml.');
  const container = parseBookXml(decodeXml(files['META-INF/container.xml']));
  const packageRef = container
    .getElementsByTagNameNS('*', 'rootfile')[0]
    ?.getAttribute('full-path');
  const packagePath = packageRef ? bookPath('container.xml', packageRef) : '';
  if (!packagePath || !files[packagePath]) throw new Error('Не найдено описание EPUB.');
  const opf = parseBookXml(decodeXml(files[packagePath]));
  const manifest = new Map<string, Element>();
  for (const item of Array.from(opf.getElementsByTagNameNS('*', 'item'))) {
    const id = item.getAttribute('id');
    if (!id || manifest.has(id) || !item.getAttribute('href'))
      throw new Error('Повреждён manifest EPUB.');
    manifest.set(id, item);
  }
  const refs = Array.from(opf.getElementsByTagNameNS('*', 'itemref'));
  if (!refs.length) throw new Error('В EPUB нет разделов для чтения.');
  const sections: BookSection[] = [];
  for (const ref of refs) {
    const item = manifest.get(ref.getAttribute('idref') ?? '');
    if (!item) throw new Error('Повреждена последовательность разделов EPUB.');
    const href = item.getAttribute('href')!,
      path = bookPath(packagePath, href),
      mime = item.getAttribute('media-type');
    if (!files[path]) throw new Error('В EPUB отсутствует файл раздела.');
    if (!['application/xhtml+xml', 'text/html'].includes(mime ?? ''))
      throw new Error('Тип раздела EPUB не поддерживается.');
    const doc = parseBookXml(decodeXml(files[path]));
    const body = doc.getElementsByTagNameNS('*', 'body')[0];
    if (doc.documentElement.localName !== 'html' || !body)
      throw new Error('В разделе EPUB отсутствует корректный XHTML body.');
    const policy =
      Array.from(doc.getElementsByTagNameNS('*', 'meta'))
        .find((el) => el.getAttribute('http-equiv')?.toLowerCase() === 'content-security-policy')
        ?.getAttribute('content') ?? '';
    if (!policy.includes("script-src 'none'") || doc.querySelector('script,iframe,object,embed'))
      throw new Error('Раздел требует безопасной повторной обработки.');
    for (const el of Array.from(doc.querySelectorAll('*')))
      if (Array.from(el.attributes).some((attr) => /^on/i.test(attr.name)))
        throw new Error('Небезопасные обработчики в разделе.');
    const clone = body.cloneNode(true) as Element;
    clone.querySelectorAll('script,style,[hidden]').forEach((el) => el.remove());
    const text = (clone.textContent ?? '').replace(/[\s\u200b-\u200f\ufeff]/g, '');
    const images = Array.from(body.getElementsByTagNameNS('*', 'img')).some((img) => {
      const src = img.getAttribute('src');
      if (!src) return false;
      if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(src)) return true;
      try {
        return Boolean(files[bookPath(path, src)]);
      } catch {
        return false;
      }
    });
    if (ref.getAttribute('linear') !== 'no')
      sections.push({
        href,
        path,
        kind: text.length ? 'text' : images ? 'image' : 'empty',
        textLength: text.length,
      });
  }
  const firstContent = sections.find((s) => s.kind !== 'empty');
  if (!firstContent)
    throw new Error('В книге нет доступного текста или поддерживаемых иллюстраций.');
  // Navigation is optional in EPUB2, but a declared missing/invalid document can
  // leave EPUB.js book.ready pending forever. Validate before entering the engine.
  const nav = Array.from(manifest.values()).find((item) =>
    item.getAttribute('properties')?.split(/\s+/).includes('nav'),
  );
  const ncx = manifest.get(opf.getElementsByTagNameNS('*', 'spine')[0]?.getAttribute('toc') ?? '');
  for (const item of [nav, ncx])
    if (item) {
      const data = files[bookPath(packagePath, item.getAttribute('href')!)];
      if (!data) throw new Error('В EPUB отсутствует объявленное оглавление.');
      parseBookXml(decodeXml(data));
    }
  return {
    packagePath,
    sections,
    firstTextHref: sections.find((s) => s.kind === 'text')?.href,
    firstContentHref: firstContent.href,
  };
}
export async function inspectEpub(data: ArrayBuffer): Promise<BookInspection> {
  if (!(data instanceof ArrayBuffer) || !data.byteLength)
    throw new Error('Данные книги отсутствуют.');
  return inspectFiles(await unpack(data.slice(0)));
}
export async function bufferHash(data: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
