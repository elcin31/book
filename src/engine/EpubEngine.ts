import ePub, { type Book, type Rendition, type Contents } from 'epubjs';
import type { Location } from 'epubjs/types/rendition';
import type { NavItem } from 'epubjs/types/navigation';
import type { ReaderEngine, ReaderCallbacks } from './ReaderEngine';
import type { ReaderSettings, SearchMatch, TocItem } from '../types';
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
export class EpubEngine implements ReaderEngine {
  private element?: HTMLElement;
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
  ): Promise<TocItem[]> {
    this.element = element;
    this.settings = settings;
    this.viewportWidth = element.clientWidth;
    const book = ePub();
    this.book = book;
    await book.open(data, 'binary');
    await book.ready;
    if (this.destroyed) return [];
    this.sectionCount = (await book.loaded.spine).length;
    const r = book.renderTo(element, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: settings.flow === 'paginated' ? 'paginated' : 'scrolled-doc',
      // WebKit blocks even parent-installed DOM listeners in a script-disabled
      // frame. Permission enables the trusted parent controller; every normalized
      // chapter has script-src 'none', and imported scripts/handlers are removed.
      allowScriptedContent: true,
      resizeOnOrientationChange: true,
    });
    this.rendition = r;
    r.hooks.content.register((contents: Contents) => this.setupContents(contents));
    r.on('relocated', (location: Location) => {
      this.lastLocation = location;
      this.emitLocation(location);
    });
    r.on('selected', (cfi: string, contents: Contents) => {
      const selected = contents.window.getSelection()?.toString().trim();
      if (selected) this.emitSelection(cfi, selected);
    });
    this.applyTheme(settings);
    try {
      await r.display(position);
    } catch {
      if (this.destroyed) return [];
      await r.display();
    }
    if (this.destroyed) return [];
    this.observer = new ResizeObserver((entries) => {
      if (this.destroyed) return;
      const { width, height } = entries[0].contentRect;
      this.viewportWidth = width;
      if (width && height) r.resize(Math.round(width), Math.round(height));
    });
    this.observer.observe(element);
    // WebKit can suppress selectionchange in a scriptless srcdoc frame. Read its
    // Selection from the parent realm without enabling scripts in the book.
    this.selectionTimer = setInterval(() => this.sampleSelection(), 250);
    // Locations are typography-independent CFIs. Generate after first paint.
    this.locationsTask = book.locations.generate(1000);
    void this.locationsTask
      .then(() => {
        if (this.destroyed) return;
        this.locationsReady = true;
        if (this.lastLocation) this.emitLocation(this.lastLocation);
      })
      .catch(() => {
        /* CFI restore still works without the optional progress index. */
      });
    const map = (items: NavItem[]): TocItem[] =>
      items.map((item) => ({
        id: item.id,
        label: item.label.trim(),
        href: item.href,
        children: map(item.subitems ?? []),
      }));
    return map(book.navigation.toc);
  }
  private emitLocation(loc: Location) {
    if (this.destroyed || !loc.start) return;
    let percent = 0;
    if (this.locationsReady) percent = this.book!.locations.percentageFromCfi(loc.start.cfi);
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
      cfi: loc.start.cfi,
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
    doc.documentElement.lang = 'ru';
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
        'font-family': `${fonts[s.font]} !important`,
        'font-size': `${s.fontSize}px !important`,
        'line-height': `${s.lineHeight} !important`,
        color: `${colors.text} !important`,
        background: `${colors.background} !important`,
        'font-weight': s.bold ? '600 !important' : '400 !important',
        'letter-spacing': `${s.letterSpacing}px !important`,
        'overflow-wrap': 'break-word',
        hyphens: 'auto',
      },
      'p, li, blockquote': {
        'text-align': `${s.align} !important`,
        'line-height': 'inherit !important',
        'font-size': 'inherit !important',
        color: 'inherit !important',
      },
      p: { margin: `0 0 ${s.paragraphSpacing}em !important`, 'text-indent': '1.1em' },
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
        'max-height': '75vh !important',
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
    const flowChanged = this.settings?.flow !== s.flow;
    this.settings = s;
    const cfi = this.lastLocation?.start.cfi;
    if (flowChanged) this.rendition?.flow(s.flow === 'paginated' ? 'paginated' : 'scrolled-doc');
    this.applyTheme(s);
    if (cfi && !this.destroyed) await this.rendition?.display(cfi);
  }
  async next() {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    try {
      await this.rendition?.next();
    } finally {
      this.busy = false;
    }
  }
  async previous() {
    if (this.busy || this.destroyed) return;
    this.busy = true;
    try {
      await this.rendition?.prev();
    } finally {
      this.busy = false;
    }
  }
  async goTo(target: string) {
    if (!this.destroyed) await this.rendition?.display(target);
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
    this.observer?.disconnect();
    clearInterval(this.selectionTimer);
    const book = this.book;
    this.book = undefined;
    if (book) {
      void book.opened
        .then(async () => {
          await this.locationsTask;
          book.destroy();
        })
        .catch(() => {});
    }
  }
}
