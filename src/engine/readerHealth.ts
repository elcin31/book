import { ReaderFailure, deadline } from './readerFailure';
export interface ReaderHealth {
  kind: 'text' | 'image' | 'blank';
  textLength: number;
  images: number;
  width: number;
  height: number;
}
export async function waitForMount(element: HTMLElement, signal: AbortSignal) {
  if (element.clientWidth > 8 && element.clientHeight > 8) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      observer.disconnect();
      signal.removeEventListener('abort', abort);
    };
    const check = () => {
      if (element.clientWidth > 8 && element.clientHeight > 8) {
        cleanup();
        resolve();
      }
    };
    const abort = () => {
      cleanup();
      reject(new ReaderFailure('cancelled', 'mount'));
    };
    const observer = new ResizeObserver(check),
      timer = setTimeout(() => {
        cleanup();
        reject(
          new ReaderFailure(
            'viewport',
            'mount',
            'Область чтения имеет нулевой размер. Повторите открытие после поворота экрана.',
          ),
        );
      }, 7000);
    signal.addEventListener('abort', abort, { once: true });
    observer.observe(element);
    requestAnimationFrame(check);
  });
}
export async function checkReaderHealth(
  element: HTMLElement,
  signal: AbortSignal,
): Promise<ReaderHealth> {
  await deadline(
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ),
    8000,
    'paint',
    signal,
  );
  const bounds = element.getBoundingClientRect();
  if (bounds.width < 8 || bounds.height < 8) throw new ReaderFailure('viewport', 'viewport');
  const frames = Array.from(element.querySelectorAll('iframe')).filter((frame) => {
    const r = frame.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) throw new ReaderFailure('viewport', 'iframe-size');
    return (
      r.right > bounds.left &&
      r.left < bounds.right &&
      r.bottom > bounds.top &&
      r.top < bounds.bottom
    );
  });
  if (!frames.length) throw new ReaderFailure('document', 'iframe');
  let textLength = 0,
    images = 0,
    hasDocument = false;
  for (const frame of frames) {
    const doc = frame.contentDocument,
      win = frame.contentWindow,
      box = frame.getBoundingClientRect();
    if (!doc?.body || !win) continue;
    hasDocument = true;
    if (box.width < 1 || box.height < 1) throw new ReaderFailure('viewport', 'iframe-size');
    const frameStyle = getComputedStyle(frame);
    if (
      frameStyle.visibility === 'hidden' ||
      frameStyle.display === 'none' ||
      Number(frameStyle.opacity) === 0
    )
      throw new ReaderFailure('hidden', 'iframe-style');
    const visible = (r: DOMRect) =>
      r.width > 0 &&
      r.height > 0 &&
      r.right + box.left > bounds.left &&
      r.left + box.left < bounds.right &&
      r.bottom + box.top > bounds.top &&
      r.top + box.top < bounds.bottom;
    const candidates = Array.from(doc.images)
      .filter((img) => visible(img.getBoundingClientRect()))
      .slice(0, 6);
    await deadline(
      Promise.all(
        candidates.map(async (img) => {
          if (img.complete) return;
          try {
            await img.decode();
          } catch {
            /* Report the failed image below, without trusting its alt text. */
          }
        }),
      ),
      12000,
      'images',
      signal,
    );
    images += candidates.filter(
      (img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0,
    ).length;
    const readableNode = (node: Node) => {
      const value = node.textContent?.replace(/[\u200b-\u200f\ufeff]/g, '').trim();
      if (node.nodeType !== Node.TEXT_NODE || !value) return 0;
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript')) return 0;
      let hidden = false;
      for (let el: Element | null = parent; el; el = el.parentElement) {
        const style = win.getComputedStyle(el);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity) === 0
        ) {
          hidden = true;
          break;
        }
      }
      const style = win.getComputedStyle(parent),
        background = win.getComputedStyle(doc.body).backgroundColor;
      if (
        hidden ||
        style.color === 'transparent' ||
        /rgba\([^)]*,\s*0\)/.test(style.color) ||
        (background !== 'rgba(0, 0, 0, 0)' && style.color === background)
      )
        return 0;
      const range = doc.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects()).some(visible) ? value.length : 0;
    };
    // Hit-test the visible page first. A late page in a very long chapter should
    // not require walking every earlier text node on each turn.
    for (const y of [0.12, 0.35, 0.6, 0.85]) {
      for (const x of [0.2, 0.5, 0.8]) {
        const range = doc.caretRangeFromPoint?.(
          bounds.left - box.left + bounds.width * x,
          bounds.top - box.top + bounds.height * y,
        );
        const length = range && readableNode(range.startContainer);
        if (length)
          return {
            kind: 'text',
            textLength: length,
            images,
            width: bounds.width,
            height: bounds.height,
          };
      }
    }
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const value = node.textContent?.replace(/[\u200b-\u200f\ufeff]/g, '').trim();
      if (!value || node.parentElement?.closest('script,style,noscript')) continue;
      textLength += value.length;
      if (readableNode(node))
        return { kind: 'text', textLength, images, width: bounds.width, height: bounds.height };
    }
  }
  if (images)
    return { kind: 'image', textLength, images, width: bounds.width, height: bounds.height };
  if (!hasDocument) throw new ReaderFailure('document', 'iframe-document');
  if (textLength) throw new ReaderFailure('hidden', 'visible-text');
  // Empty XHTML is permitted in a valid spine. The UI must offer navigation.
  const allImages = frames.flatMap((frame) => Array.from(frame.contentDocument?.images ?? []));
  if (allImages.length)
    throw new ReaderFailure(
      'resource',
      'image-decode',
      'Не удалось отобразить изображение страницы. Можно восстановить книгу или перейти к тексту.',
    );
  return { kind: 'blank', textLength: 0, images: 0, width: bounds.width, height: bounds.height };
}
