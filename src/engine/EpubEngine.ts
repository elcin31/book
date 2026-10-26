import ePub, { type Book, type Rendition, type Contents } from 'epubjs';
import type { Location } from 'epubjs/types/rendition';
import type { NavItem } from 'epubjs/types/navigation';
import type { ReaderEngine, ReaderCallbacks } from './ReaderEngine';
import type { ReaderSettings, SearchMatch, TocItem } from '../types';
import type { BookInspection } from './inspection';
import { ReaderFailure, readerFailure, deadline } from './readerFailure';
import { checkReaderHealth, waitForMount } from './readerHealth';
import { recordReaderDiagnostic } from '../lib/readerDiagnostics';
export const readerColors = {
  paper: { background: '#faf9f5', text: '#2d302b' },
  sepia: { background: '#eee3cc', text: '#534632' },
  night: { background: '#242824', text: '#d5d8d0' },
  black: { background: '#080a09', text: '#bfc5be' },
};
const fonts = {
  literary: 'Georgia, "Times New Roman", serif',
  classic: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"Courier New", monospace',
};
const layoutSettings = [
  'font',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent',
  'align',
  'hyphenate',
  'bold',
  'flow',
] as const;
export class EpubEngine implements ReaderEngine {
  private element?: HTMLElement;
  private abort = new AbortController();
  private opening = true;
  private checking = false;
  private visibleKind?: 'text' | 'image' | 'blank';
  private resume = () => {
    if (
      document.visibilityState === 'visible' &&
      !this.destroyed &&
      !this.opening &&
      !this.reflowing
    )
      void this.verifyVisible().catch((error) => {
        const failure = readerFailure(error, 'resume');
        if (failure.code !== 'cancelled') this.callbacks.onError?.(failure.message, failure);
      });
  };
  private inspection?: BookInspection;
  private healthTimer?: ReturnType<typeof setTimeout>;
  private book?: Book;
  private rendition?: Rendition;
  private observer?: ResizeObserver;
  private destroyed = false;
  private settings?: ReaderSettings;
  private lastLocation?: Location;
  private locationsReady = false;
  private busy = false;
  private sectionCount = 1;
  private viewportWidth = 402;
  private viewportHeight = 0;
  private language = 'ru';
  private anchor?: string;
  private appliedSettings?: ReaderSettings;
  private layoutTimer?: ReturnType<typeof setTimeout>;
  private pendingLayout = false;
  private reflowing = false;
  private layoutPromise?: Promise<void>;
  private cancelLayoutWait?: () => void;
  private locationsTask?: Promise<unknown>;
  private contentMap = new WeakMap<Document, Contents>();
  private selectionTimer?: ReturnType<typeof setInterval>;
  private lastSelectionCfi = '';
  private pendingSelection?: { cfi: string; text: string; since: number };
  constructor(private callbacks: ReaderCallbacks) {}
  async open(
    data: ArrayBuffer,
    element: HTMLElement,
    settings: ReaderSettings,
    position?: string,
    inspection?: BookInspection,
  ): Promise<TocItem[]> {
    this.inspection = inspection;
    recordReaderDiagnostic('engine-start', {
      bytes: data.byteLength,
      hasPosition: Boolean(position),
    });
    try {
      return await deadline(
        this.openInternal(data, element, settings, position),
        90000,
        'open',
        this.abort.signal,
      );
    } catch (error) {
      const failure = readerFailure(error);
      recordReaderDiagnostic('engine-failed', { code: failure.code, kind: failure.stage });
      this.destroy();
      throw failure;
    }
  }
  private async openInternal(
    data: ArrayBuffer,
    element: HTMLElement,
    settings: ReaderSettings,
    position?: string,
  ): Promise<TocItem[]> {
    await waitForMount(element, this.abort.signal);
    this.element = element;
    this.settings = settings;
    this.appliedSettings = settings;
    this.anchor = position?.startsWith('epubcfi(') ? position : undefined;
    this.viewportWidth = Math.floor(element.clientWidth);
    this.viewportHeight = Math.floor(element.clientHeight);
    const book = ePub();
    this.book = book;
    await deadline(book.open(data, 'binary'), 60000, 'epub-open', this.abort.signal);
    recordReaderDiagnostic('epub-open');
    await deadline(book.ready, 30000, 'epub-ready', this.abort.signal);
    if (this.destroyed) return [];
    this.sectionCount = (await book.loaded.spine).length;
    this.language = (await book.loaded.metadata).language || 'ru';
    // An intentional empty XHTML page otherwise has zero column width in
    // EPUB.js. Keep its place in the spine, giving only the live DOM a layout
    // marker. It is whitespace, never treated as readable text or persisted.
    book.spine.hooks.content.register((doc: Document) => {
      if (doc.body && !doc.body.textContent?.trim() && !doc.body.querySelector('img,svg')) {
        const marker = doc.createElementNS('http://www.w3.org/1999/xhtml', 'p');
        marker.setAttribute('aria-hidden', 'true');
        marker.textContent = '\u00a0';
        doc.body.append(marker);
      }
    });
    const displayPosition = this.pageTarget(position);
    if (position?.startsWith('epubcfi(') && displayPosition === position) {
      try {
        const range = await deadline(book.getRange(position), 10000, 'cfi', this.abort.signal);
        if (!range?.startContainer) throw new Error('Invalid CFI');
      } catch (error) {
        if (this.abort.signal.aborted) throw readerFailure(error, 'cfi');
        throw new ReaderFailure('position', 'cfi');
      }
    }
    const options = {
      // Numeric sizes disable EPUB.js's additional window-resize observer.
      // Only the settled mount size below is a pagination boundary.
      width: this.viewportWidth,
      height: this.viewportHeight,
      gap: 0,
      spread: 'none',
      flow: settings.flow === 'paginated' ? 'paginated' : 'scrolled-doc',
      // WebKit blocks even parent-installed DOM listeners in a script-disabled
      // frame. Permission enables the trusted parent controller; every normalized
      // chapter has script-src 'none', and imported scripts/handlers are removed.
      allowScriptedContent: true,
      resizeOnOrientationChange: false,
    };
    const r = book.renderTo(element, options);
    this.rendition = r;
    r.hooks.content.register((contents: Contents) => this.setupContents(contents));
    r.on('relocated', (location: Location) => {
      this.lastLocation = location;
      if (!this.opening && !this.checking && !this.pendingLayout && !this.reflowing)
        this.emitLocation(location);
    });
    r.on('selected', (cfi: string, contents: Contents) => {
      const selected = contents.window.getSelection()?.toString().trim();
      if (selected) this.emitSelection(cfi, selected);
    });
    r.on('displayError', () => {
      recordReaderDiagnostic('section-error', { code: 'resource' });
      if (!this.opening)
        this.callbacks.onError?.(
          'Книга загружена, но возникла ошибка отображения',
          new ReaderFailure('resource', 'section'),
        );
    });
    r.on('displayed', () => {
      this.checking = true;
      clearTimeout(this.healthTimer);
      this.healthTimer = setTimeout(() => {
        if (!this.opening && !this.pendingLayout && !this.reflowing)
          void this.verifyVisible().catch((error) => {
            const failure = readerFailure(error);
            this.callbacks.onError?.(failure.message, failure);
          });
      }, 100);
    });
    this.applyTheme(settings);
    await this.displayChecked(displayPosition);
    await this.verifyVisible();
    if (this.destroyed) return [];
    this.opening = false;
    if (this.lastLocation) this.emitLocation(this.lastLocation);
    this.observer = new ResizeObserver(() => {
      if (this.destroyed) return;
      if (
        Math.floor(element.clientWidth) !== this.viewportWidth ||
        Math.floor(element.clientHeight) !== this.viewportHeight
      )
        this.queueLayout();
    });
    this.observer.observe(element);
    document.addEventListener('visibilitychange', this.resume);
    element.dataset.layoutState = 'ready';
    // WebKit can suppress selectionchange in a scriptless srcdoc frame. Read its
    // Selection from the parent realm without enabling scripts in the book.
    this.selectionTimer = setInterval(() => this.sampleSelection(), 250);
    // Locations are typography-independent CFIs. Generate after first paint.
    this.locationsTask = book.locations.generate(1000);
    void this.locationsTask
      .then(() => {
        if (this.destroyed) return;
        this.locationsReady = true;
        if (
          this.lastLocation &&
          !this.opening &&
          !this.checking &&
          !this.pendingLayout &&
          !this.reflowing
        )
          this.emitLocation(this.lastLocation);
      })
      .catch(() => recordReaderDiagnostic('location-index-unavailable', { code: 'index' }));
    const map = (items: NavItem[]): TocItem[] =>
      items.map((item) => ({
        id: item.id,
        label: item.label.trim(),
        href: item.href,
        children: map(item.subitems ?? []),
      }));
    return map(book.navigation.toc);
  }
  private async guardedDisplay(action: () => Promise<unknown>, stage = 'display') {
    const r = this.rendition!;
    this.checking = true;
    let failed: (error: unknown) => void = () => {};
    const eventError = new Promise<never>((_, reject) => {
      failed = () => reject(new ReaderFailure('resource', stage));
      r.on('displayError', failed);
    });
    try {
      await deadline(Promise.race([action(), eventError]), 30000, stage, this.abort.signal);
    } finally {
      r.off('displayError', failed);
    }
  }
  private displayChecked(target?: string) {
    return this.guardedDisplay(() => this.rendition!.display(this.pageTarget(target)));
  }
  private pageTarget(position?: string) {
    if (!position?.startsWith('epubcfi(')) return position;
    const section = this.book?.spine.get(position);
    const known = section && this.inspection?.sections.find((item) => item.href === section.href);
    if (!known || (known.kind !== 'image' && known.kind !== 'empty')) return position;
    // EPUB.js can map an image-only page to /4/1:0 without a text node.
    // Keep the saved locator and restore its exact nontext spine page for open,
    // bookmarks and reflow. No text position is replaced by a chapter boundary.
    recordReaderDiagnostic('nontext-position', { kind: known.kind });
    return section.href;
  }
  private async verifyVisible() {
    if (!this.element || this.destroyed) return;
    const health = await checkReaderHealth(this.element, this.abort.signal);
    this.visibleKind = health.kind;
    recordReaderDiagnostic('visible-content', health);
    this.checking = false;
    this.callbacks.onState?.(health);
    if (!this.opening && !this.pendingLayout && !this.reflowing && this.lastLocation)
      this.emitLocation(this.lastLocation);
  }
  async skipToText() {
    const target = this.inspection?.firstTextHref ?? this.inspection?.firstContentHref;
    if (!target) throw new ReaderFailure('no-content', 'skip-to-text');
    await this.goTo(target);
  }
  private emitLocation(loc: Location) {
    if (this.destroyed || !loc.start || this.visibleKind === 'blank') return;
    // A resized page may begin before the text the user was reading. Keep that
    // exact CFI until real navigation/scrolling, rather than overwriting it with
    // the new page boundary and accumulating backwards drift on every reflow.
    const cfi = this.anchor ?? loc.start.cfi;
    let percent = 0;
    if (this.locationsReady) percent = this.book!.locations.percentageFromCfi(cfi);
    else {
      const length = this.sectionCount;
      percent =
        (loc.start.index +
          ((loc.start.displayed?.page ?? 1) - 1) / (loc.start.displayed?.total || 1)) /
        (length || 1);
    }
    if (loc.atEnd) percent = 1;
    const nav = this.book?.navigation.get(loc.start.href);
    this.callbacks.onLocation({
      cfi,
      percent: Math.max(0, Math.min(1, Number.isFinite(percent) ? percent : 0)),
      chapter: nav?.label?.trim() ?? '',
      updatedAt: Date.now(),
      page: loc.start.displayed?.page ?? 1,
      totalPages: loc.start.displayed?.total ?? 1,
      atStart: loc.atStart,
      atEnd: loc.atEnd,
    });
  }
  private emitSelection(cfi: string, text: string) {
    if (this.destroyed || cfi === this.lastSelectionCfi) return;
    this.lastSelectionCfi = cfi;
    this.callbacks.onSelection({ cfi, text: text.slice(0, 4000) });
  }
  private sampleSelection() {
    if (this.destroyed || document.visibilityState !== 'visible') return;
    for (const frame of this.element?.querySelectorAll('iframe') ?? []) {
      try {
        const selection = frame.contentWindow?.getSelection();
        const text = selection?.toString().trim();
        const contents = frame.contentDocument && this.contentMap.get(frame.contentDocument);
        if (!text || !selection?.rangeCount || !contents) continue;
        const cfi = contents.cfiFromRange(selection.getRangeAt(0));
        if (this.pendingSelection?.cfi !== cfi)
          this.pendingSelection = { cfi, text, since: Date.now() };
        else if (Date.now() - this.pendingSelection.since >= 400) this.emitSelection(cfi, text);
        return;
      } catch {
        /* A page may be unloading between samples. */
      }
    }
    this.pendingSelection = undefined;
    this.lastSelectionCfi = '';
  }
  private setupContents(contents: Contents) {
    const doc = contents.document;
    this.contentMap.set(doc, contents);
    let lastSwipe = 0;
    const frame = contents.window.frameElement;
    if (frame) frame.setAttribute('title', 'Текст книги');
    if (!doc.documentElement.lang) {
      doc.documentElement.lang = doc.documentElement.getAttribute('xml:lang') || this.language;
    }
    const scrollIntent = () => {
      if (this.settings?.flow === 'scrolled' && !this.reflowing && !this.pendingLayout)
        this.anchor = undefined;
    };
    doc.addEventListener('wheel', scrollIntent, { passive: true });
    doc.addEventListener('touchmove', scrollIntent, { passive: true });
    // Defense in depth: no external navigation can leave the reading frame.
    doc.addEventListener('click', (event) => {
      if (Date.now() - lastSwipe < 500) return;
      const target = event.target as Element;
      if (target.closest('a')) {
        const href = target.closest('a')?.getAttribute('href') ?? '';
        if (/^[a-z]+:|^\/\//i.test(href)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (contents.window.getSelection()?.toString()) return;
      const width = this.viewportWidth;
      const x = (event as MouseEvent).clientX % width;
      this.callbacks.onTap(x < width * 0.25 ? 'left' : x > width * 0.75 ? 'right' : 'center');
    });
    doc.addEventListener('keydown', (event) => this.callbacks.onKey(event.key));
    let startX = 0,
      startY = 0;
    doc.addEventListener(
      'touchstart',
      (event) => {
        if (event.touches.length === 1) {
          startX = event.touches[0].clientX;
          startY = event.touches[0].clientY;
        }
      },
      { passive: true },
    );
    doc.addEventListener(
      'touchend',
      (event) => {
        if (this.settings?.flow !== 'paginated' || contents.window.getSelection()?.toString())
          return;
        const t = event.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - startX,
          dy = t.clientY - startY;
        if (Math.abs(dx) > 65 && Math.abs(dy) < 45) {
          lastSwipe = Date.now();
          if (dx < 0) void this.next();
          else void this.previous();
        }
      },
      { passive: true },
    );
  }
  private applyTheme(s: ReaderSettings) {
    const colors = readerColors[s.theme];
    this.rendition?.themes.default({
      html: {
        background: `${colors.background} !important`,
        color: `${colors.text} !important`,
        '-webkit-text-size-adjust': '100%',
      },
      body: {
        padding: '0 !important',
        'vertical-align': 'top',
        'font-family': `${fonts[s.font]} !important`,
        'font-size': `${s.fontSize}px !important`,
        'line-height': `${s.lineHeight} !important`,
        color: `${colors.text} !important`,
        background: `${colors.background} !important`,
        'font-weight': s.bold ? '600 !important' : '400 !important',
        'letter-spacing': `${s.letterSpacing}px !important`,
        'overflow-wrap': 'break-word',
        hyphens: s.hyphenate ? 'auto' : 'none',
        '-webkit-hyphens': s.hyphenate ? 'auto' : 'none',
        'hyphenate-limit-chars': '6 3 3',
        'word-spacing': 'normal !important',
      },
      'p, li, blockquote': {
        'text-align': `${s.align} !important`,
        'text-align-last': 'start !important',
        'line-height': 'inherit !important',
        'font-size': 'inherit !important',
        color: 'inherit !important',
      },
      p: {
        margin: `0 0 ${s.paragraphSpacing}em !important`,
        'text-indent': `${s.paragraphIndent}em !important`,
      },
      'body > :first-child': { 'margin-top': '0 !important' },
      'h1, h2, h3': {
        'font-family': `${fonts[s.font]} !important`,
        color: 'inherit !important',
        'text-align': 'left !important',
        'line-height': '1.25 !important',
        'break-after': 'avoid',
        'font-weight': '400 !important',
        margin: '1em 0 .8em !important',
      },
      h1: { 'font-size': '1.6em !important' },
      h2: { 'font-size': '1.35em !important' },
      h3: { 'font-size': '1.15em !important' },
      img: {
        'max-width': '100% !important',
        'max-height': `${Math.max(80, this.viewportHeight - 4)}px !important`,
        'object-fit': 'contain',
      },
      a: {
        color:
          s.theme === 'night' || s.theme === 'black' ? '#a9c7ac !important' : '#3b684a !important',
      },
      '::selection': { background: '#d9dfb1' },
      table: { 'max-width': '100%', 'font-size': '.85em' },
      pre: { 'white-space': 'pre-wrap' },
    });
  }
  async configure(s: ReaderSettings) {
    const changed = layoutSettings.some((key) => this.settings?.[key] !== s[key]);
    const themeChanged = this.settings?.theme !== s.theme;
    this.settings = s;
    if (changed) this.queueLayout();
    else if (themeChanged) this.applyTheme(s);
  }
  private queueLayout() {
    if (this.destroyed) return;
    this.anchor ??= this.lastLocation?.start.cfi;
    this.pendingLayout = true;
    if (this.element) this.element.dataset.layoutState = 'pending';
    clearTimeout(this.layoutTimer);
    // Collapse slider changes, viewport chrome animation and orientation into
    // one layout of the current section. Never regenerate the book's CFI index.
    this.layoutTimer = setTimeout(() => {
      if (!this.reflowing) this.layoutPromise = this.repaginate();
    }, 120);
  }
  private waitForLayout(action: () => void | Promise<void>) {
    const r = this.rendition!;
    return new Promise<void>((resolve, reject) => {
      let actionDone = false,
        relocated = false,
        finishing = false;
      let firstFrame = 0,
        secondFrame = 0;
      const cleanup = () => {
        clearTimeout(timeout);
        r.off('relocated', onLocation);
      };
      const complete = () => {
        this.cancelLayoutWait = undefined;
        resolve();
      };
      const finish = () => {
        if (!actionDone || !relocated || finishing) return;
        finishing = true;
        cleanup();
        firstFrame = requestAnimationFrame(() => {
          secondFrame = requestAnimationFrame(complete);
        });
      };
      const onLocation = () => {
        relocated = true;
        finish();
      };
      const timeout = setTimeout(() => {
        cleanup();
        this.cancelLayoutWait = undefined;
        reject(new Error('Не удалось обновить разметку страницы.'));
      }, 5000);
      this.cancelLayoutWait = () => {
        cleanup();
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
        complete();
      };
      r.on('relocated', onLocation);
      try {
        void Promise.resolve(action())
          .then(() => {
            actionDone = true;
            void r.reportLocation();
            finish();
          })
          .catch((error) => {
            cleanup();
            this.cancelLayoutWait = undefined;
            reject(error);
          });
      } catch (error) {
        cleanup();
        this.cancelLayoutWait = undefined;
        reject(error);
      }
    });
  }
  private async repaginate() {
    const r = this.rendition,
      element = this.element,
      settings = this.settings;
    if (this.destroyed || !r || !element || !settings) return;
    this.pendingLayout = false;
    this.reflowing = true;
    let healthy = false;
    try {
      await waitForMount(element, this.abort.signal);
      if (this.destroyed) return;
      const width = Math.floor(element.clientWidth),
        height = Math.floor(element.clientHeight);
      const sizeChanged = width !== this.viewportWidth || height !== this.viewportHeight;
      const typographyChanged = layoutSettings.some(
        (key) => this.appliedSettings?.[key] !== settings[key],
      );
      const flowChanged = this.appliedSettings?.flow !== settings.flow;
      if (flowChanged) r.flow(settings.flow === 'paginated' ? 'paginated' : 'scrolled-doc');
      this.viewportWidth = width;
      this.viewportHeight = height;
      this.applyTheme(settings);
      if (sizeChanged) {
        await this.waitForLayout(() => {
          // The upstream JS supports an optional CFI omitted from its .d.ts.
          const resize = r.resize as (width: number, height: number, cfi?: string) => void;
          resize.call(r, width, height, this.pageTarget(this.anchor));
        });
      } else if (typographyChanged) {
        await this.waitForLayout(() => this.displayChecked(this.anchor));
      }
      this.appliedSettings = settings;
      await this.verifyVisible();
      healthy = true;
    } catch (error) {
      if (!this.destroyed)
        this.callbacks.onError?.(
          error instanceof Error ? error.message : 'Не удалось обновить страницу.',
          readerFailure(error, 'layout'),
        );
    } finally {
      this.reflowing = false;
      if (this.pendingLayout) this.queueLayout();
      else if (!this.destroyed) {
        element.dataset.layoutState = healthy ? 'ready' : 'error';
        if (healthy && this.lastLocation) this.emitLocation(this.lastLocation);
      }
    }
  }
  private async finishLayout() {
    if (this.destroyed) return;
    clearTimeout(this.layoutTimer);
    if (this.pendingLayout && !this.reflowing) this.layoutPromise = this.repaginate();
    await this.layoutPromise;
    if (this.pendingLayout) await this.finishLayout();
  }
  async next() {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    try {
      await this.finishLayout();
      this.anchor = undefined;
      await this.guardedDisplay(() => this.rendition!.next(), 'next');
      await this.verifyVisible();
    } finally {
      this.busy = false;
    }
  }
  async previous() {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    try {
      await this.finishLayout();
      this.anchor = undefined;
      await this.guardedDisplay(() => this.rendition!.prev(), 'previous');
      await this.verifyVisible();
    } finally {
      this.busy = false;
    }
  }
  async goTo(target: string) {
    await this.finishLayout();
    this.anchor = target.startsWith('epubcfi(') ? target : undefined;
    if (!this.destroyed) {
      await this.displayChecked(target);
      await this.verifyVisible();
    }
  }
  async goToPercent(percent: number) {
    if (!this.book) return;
    if (!this.locationsReady) await this.locationsTask;
    if (this.destroyed) return;
    this.locationsReady = true;
    const cfi = this.book.locations.cfiFromPercentage(Math.max(0, Math.min(1, percent)));
    if (cfi) await this.goTo(cfi);
  }
  async search(query: string, signal: AbortSignal): Promise<SearchMatch[]> {
    const results: SearchMatch[] = [];
    if (!this.book || query.trim().length < 2) return results;
    const book = this.book;
    for (let i = 0; i < this.sectionCount; i++) {
      if (signal.aborted || this.destroyed) return results;
      const section = book.spine.get(i);
      if (!section) continue;
      const wasLoaded = Boolean(section.document);
      await section.load(book.load.bind(book));
      const matches = section.find(query) as unknown as { cfi: string; excerpt: string }[];
      for (const match of matches) {
        results.push({
          ...match,
          chapter: book.navigation.get(section.href)?.label?.trim() ?? `Раздел ${i + 1}`,
        });
        if (results.length >= 200) break;
      }
      if (!wasLoaded) section.unload();
      if (results.length >= 200) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return results;
  }
  highlight(cfi: string, color: string) {
    try {
      this.rendition?.annotations.highlight(cfi, {}, undefined, 'book-highlight', {
        fill: color,
        'fill-opacity': '0.32',
        'mix-blend-mode': 'multiply',
      });
    } catch {
      /* An invalid old annotation must not break reading. */
    }
  }
  clearSelection() {
    this.element?.querySelectorAll('iframe').forEach((frame) => {
      try {
        frame.contentWindow?.getSelection()?.removeAllRanges();
      } catch {
        /* A detached iframe no longer has a selection. */
      }
    });
  }
  removeHighlight(cfi: string) {
    this.rendition?.annotations.remove(cfi, 'highlight');
  }
  destroy() {
    this.destroyed = true;
    this.abort.abort();
    clearTimeout(this.healthTimer);
    document.removeEventListener('visibilitychange', this.resume);
    this.pendingLayout = false;
    this.observer?.disconnect();
    clearTimeout(this.layoutTimer);
    this.cancelLayoutWait?.();
    clearInterval(this.selectionTimer);
    const book = this.book;
    this.book = undefined;
    if (book) {
      void book.opened
        .then(async () => {
          await this.locationsTask;
          book.destroy();
        })
        .catch(() => recordReaderDiagnostic('engine-dispose', { code: 'closed' }));
    }
  }
}
