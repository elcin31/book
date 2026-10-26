import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  List,
  Maximize2,
  Search,
  Trash2,
  Type,
} from 'lucide-react';
import { EpubEngine, readerColors } from '../engine/EpubEngine';
import type { ReaderEngine, ReaderLocation, ReaderSelection } from '../engine/ReaderEngine';
import { db, readPosition, recordTime, savePosition } from '../lib/db';
import { usePreferences } from '../lib/settings';
import type { BookRecord, SearchMatch, TocItem } from '../types';
import { Dialog, EmptyState, Loading } from './Primitives';
import { ReaderAppearance } from './ReaderAppearance';
interface Props {
  book: BookRecord;
  onClose: () => void;
  notify: (message: string) => void;
  initialCfi?: string;
}
type Panel = 'toc' | 'search' | 'marks' | 'appearance' | null;
export default function Reader({ book, onClose, notify, initialCfi }: Props) {
  const settings = usePreferences((s) => s.reader);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const root = useRef<HTMLDivElement>(null),
    element = useRef<HTMLDivElement>(null),
    engine = useRef<ReaderEngine | null>(null),
    lastActive = useRef(Date.now());
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toc, setToc] = useState<TocItem[]>([]),
    [location, setLocation] = useState<ReaderLocation>(),
    [chrome, setChrome] = useState(false),
    [panel, setPanel] = useState<Panel>(null),
    [selection, setSelection] = useState<ReaderSelection | null>(null),
    [note, setNote] = useState(''),
    [color, setColor] = useState('#e4c85e'),
    [saving, setSaving] = useState(false),
    [query, setQuery] = useState(''),
    [results, setResults] = useState<SearchMatch[]>([]),
    [searching, setSearching] = useState(false),
    [searched, setSearched] = useState(false),
    [jump, setJump] = useState<number | null>(null);
  const panelsRef = useRef(false);
  panelsRef.current = Boolean(panel || selection);
  const searchAbort = useRef<AbortController | null>(null),
    annotations =
      useLiveQuery(
        () => db.annotations.where('bookId').equals(book.id).sortBy('createdAt'),
        [book.id],
      ) ?? [];
  const operation = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        lastActive.current = Date.now();
        await action();
      } catch {
        notify('Не удалось перейти к выбранному месту.');
      }
    },
    [notify],
  );
  const actionRef = useRef({ next: () => {}, prev: () => {} });
  actionRef.current = {
    next: () => void operation(() => engine.current?.next() ?? Promise.resolve()),
    prev: () => void operation(() => engine.current?.previous() ?? Promise.resolve()),
  };
  useEffect(() => {
    let disposed = false;
    const e = new EpubEngine({
      onLocation: (loc) => {
        if (disposed) return;
        setLocation(loc);
        const { cfi, percent, chapter, updatedAt } = loc;
        void savePosition(book.id, { cfi, percent, chapter, updatedAt }).catch(() =>
          notify('Не удалось сохранить прогресс. Проверьте свободное место.'),
        );
      },
      onSelection: (selected) => {
        if (disposed) return;
        setSelection(selected);
        setNote('');
        lastActive.current = Date.now();
      },
      onTap: (zone) => {
        lastActive.current = Date.now();
        if (panelsRef.current) return;
        if (zone === 'center') setChrome((c) => !c);
        else if (settingsRef.current.flow === 'paginated') {
          if (zone === 'left') actionRef.current.prev();
          else actionRef.current.next();
        }
      },
      onKey: (key) => {
        if (panelsRef.current) return;
        if (key === 'ArrowRight' || key === ' ' || key === 'PageDown') actionRef.current.next();
        if (key === 'ArrowLeft' || key === 'PageUp') actionRef.current.prev();
      },
      onError: notify,
    });
    engine.current = e;
    void (async () => {
      try {
        const file = await db.files.get(book.id);
        if (!file)
          throw new Error('Файл книги не найден на устройстве. Импортируйте книгу заново.');
        if (disposed) return;
        const items = await e.open(
          file.data,
          element.current!,
          settingsRef.current,
          initialCfi ?? readPosition(book)?.cfi,
        );
        if (disposed) return;
        setToc(items);
        setLoading(false);
        lastActive.current = Date.now();
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'Не удалось открыть книгу.');
          setLoading(false);
        }
      }
    })();
    return () => {
      disposed = true;
      searchAbort.current?.abort();
      e.destroy();
      engine.current = null;
    };
  }, [book.id, initialCfi, notify]);
  useEffect(() => {
    if (loading) return;
    void operation(() => engine.current?.configure(settings) ?? Promise.resolve());
  }, [settings, loading, operation]);
  useEffect(() => {
    if (CSS.supports('height: 100dvh')) return;
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.current?.style.setProperty(
          '--reader-viewport-height',
          `${Math.round(window.visualViewport?.height ?? window.innerHeight)}px`,
        );
      });
    };
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);
  const highlighted = useRef(new Map<string, string>());
  useEffect(() => {
    if (loading) return;
    const current = new Set(annotations.filter((a) => a.kind === 'highlight').map((a) => a.cfi));
    for (const cfi of highlighted.current.keys())
      if (!current.has(cfi)) {
        engine.current?.removeHighlight(cfi);
        highlighted.current.delete(cfi);
      }
    for (const a of annotations.filter((a) => a.kind === 'highlight'))
      if (highlighted.current.get(a.cfi) !== a.color) {
        engine.current?.highlight(a.cfi, a.color);
        highlighted.current.set(a.cfi, a.color);
      }
  }, [annotations, loading]);
  useEffect(() => {
    let seconds = 0;
    const flush = () => {
      if (seconds) {
        const elapsed = seconds;
        seconds = 0;
        void recordTime(elapsed).catch(() => {});
      }
    };
    const interval = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        !panelsRef.current &&
        !loading &&
        !error &&
        Date.now() - lastActive.current < 120000
      )
        seconds++;
      if (seconds >= 15) flush();
    }, 1000);
    const visibility = () => {
      flush();
      if (document.visibilityState === 'visible') lastActive.current = Date.now();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(interval);
      flush();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [loading, error]);
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    let disposed = false;
    const acquire = async () => {
      if (settings.keepAwake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        try {
          const next = await navigator.wakeLock.request('screen');
          if (disposed) await next.release();
          else lock = next;
        } catch {
          /* iOS may decline in low power mode. */
        }
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      disposed = true;
      void lock?.release();
      document.removeEventListener('visibilitychange', acquire);
    };
  }, [settings.keepAwake]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        panelsRef.current ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        actionRef.current.next();
      }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        actionRef.current.prev();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  useEffect(() => {
    const old = document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', readerColors[settings.theme].background);
    return () => {
      if (old) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', old);
    };
  }, [settings.theme]);
  const goTo = (target: string) => {
    setPanel(null);
    void operation(() => engine.current?.goTo(target) ?? Promise.resolve());
  };
  const addBookmark = async () => {
    if (!location) return;
    try {
      if (annotations.some((a) => a.kind === 'bookmark' && a.cfi === location.cfi)) {
        notify('На этой странице уже есть закладка');
        return;
      }
      await db.annotations.add({
        id: crypto.randomUUID(),
        bookId: book.id,
        cfi: location.cfi,
        text: location.chapter || book.title,
        note: '',
        kind: 'bookmark',
        color: '#9baa90',
        chapter: location.chapter,
        createdAt: Date.now(),
      });
      notify('Закладка сохранена');
    } catch {
      notify('Не удалось сохранить закладку.');
    }
  };
  const saveHighlight = async () => {
    if (!selection) return;
    setSaving(true);
    try {
      const existing = annotations.find((a) => a.cfi === selection.cfi && a.kind === 'highlight');
      await db.annotations.put({
        id: existing?.id ?? crypto.randomUUID(),
        bookId: book.id,
        cfi: selection.cfi,
        text: selection.text,
        note,
        kind: 'highlight',
        color,
        chapter: location?.chapter ?? '',
        createdAt: Date.now(),
      });
      engine.current?.clearSelection();
      setSelection(null);
      notify(note ? 'Заметка сохранена' : 'Выделение сохранено');
    } catch {
      notify('Не удалось сохранить выделение.');
    } finally {
      setSaving(false);
    }
  };
  const search = async () => {
    if (query.trim().length < 2) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    setSearched(true);
    try {
      const matches = await engine.current?.search(query.trim(), controller.signal);
      if (!controller.signal.aborted) setResults(matches ?? []);
    } catch {
      if (!controller.signal.aborted) notify('Не удалось выполнить поиск.');
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  };
  const renderToc = (items: TocItem[], depth = 0) =>
    items.map((item) => (
      <div key={item.id || item.href}>
        <button
          className={`toc-item ${location?.chapter === item.label ? 'current' : ''}`}
          style={{ paddingLeft: 16 + depth * 16 }}
          onClick={() => goTo(item.href)}
        >
          <span>{item.label}</span>
          {location?.chapter === item.label ? (
            <span className="now-reading-dot" />
          ) : (
            <ChevronRight size={15} />
          )}
        </button>
        {renderToc(item.children, depth + 1)}
      </div>
    ));
  const colors = readerColors[settings.theme];
  const progress = jump ?? Math.round((location?.percent ?? book.position?.percent ?? 0) * 100);
  return (
    <div
      ref={root}
      className={`reader reader-${settings.theme} ${chrome ? '' : 'chrome-hidden'}`}
      style={
        {
          background: colors.background,
          color: colors.text,
          '--reader-background': colors.background,
          '--reader-horizontal-margin': `${settings.margins}px`,
          '--reader-vertical-margin': `${settings.verticalMargins}px`,
          '--reader-progress-space': settings.showProgress ? '14px' : '0px',
        } as CSSProperties
      }
      onPointerDown={() => {
        lastActive.current = Date.now();
      }}
    >
      <button
        className="reader-controls-trigger icon-button"
        aria-label={chrome ? 'Скрыть панель чтения' : 'Показать панель чтения'}
        aria-expanded={chrome}
        aria-controls="reader-menu reader-navigation"
        onClick={() => setChrome((visible) => !visible)}
      >
        <Maximize2 size={18} />
      </button>
      <header id="reader-menu" className="reader-header" aria-hidden={!chrome} inert={!chrome}>
        <button className="reader-back" onClick={onClose} aria-label="Вернуться в библиотеку">
          <ChevronLeft size={23} />
          <span>Библиотека</span>
        </button>
        <div className="reader-book-title">
          <strong>{book.title}</strong>
          <small>{location?.chapter || book.author}</small>
        </div>
        <div className="reader-header-actions">
          <button
            className="icon-button"
            disabled={loading || !!error}
            onClick={() => setPanel('search')}
            aria-label="Поиск в книге"
          >
            <Search size={20} />
          </button>
          <button
            className="icon-button"
            disabled={loading || !!error}
            onClick={() => void addBookmark()}
            aria-label="Добавить закладку"
          >
            <Bookmark
              size={20}
              fill={
                annotations.some((a) => a.kind === 'bookmark' && a.cfi === location?.cfi)
                  ? 'currentColor'
                  : 'none'
              }
            />
          </button>
          <button
            className="icon-button reader-type"
            onClick={() => setPanel('appearance')}
            aria-label="Настройки чтения"
          >
            <Type size={23} />
          </button>
        </div>
      </header>
      <div
        className="reader-stage"
        style={{
          filter: `brightness(${settings.brightness}%)`,
        }}
      >
        <div className="reader-mount" ref={element} />
        {loading && (
          <div className="reader-loading">
            <Loading label="Открываем книгу…" />
          </div>
        )}
        {error && (
          <div className="reader-loading">
            <EmptyState
              heading="Книга не открылась"
              action={
                <button className="primary-button" onClick={onClose}>
                  В библиотеку
                </button>
              }
            >
              {error}
            </EmptyState>
          </div>
        )}
      </div>
      <footer
        id="reader-navigation"
        className="reader-footer"
        aria-hidden={!chrome}
        inert={!chrome}
      >
        <div className="reader-progress-row">
          <button className="icon-button" onClick={() => setPanel('toc')} aria-label="Оглавление">
            <List size={21} />
          </button>
          <div className="reader-progress-slider">
            <input
              aria-label="Прогресс чтения"
              type="range"
              min="0"
              max="100"
              value={progress}
              disabled={loading || !!error}
              onChange={(e) => setJump(Number(e.target.value))}
              onPointerUp={(e) => {
                const value = Number(e.currentTarget.value);
                setJump(null);
                void operation(() => engine.current?.goToPercent(value / 100) ?? Promise.resolve());
              }}
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                  const value = Number(e.currentTarget.value);
                  setJump(null);
                  void operation(
                    () => engine.current?.goToPercent(value / 100) ?? Promise.resolve(),
                  );
                }
              }}
            />
          </div>
          <span className="reader-percent">{progress}%</span>
          <button
            className="icon-button"
            onClick={() => setPanel('marks')}
            aria-label="Закладки и заметки"
          >
            <Highlighter size={20} />
          </button>
        </div>
        <div className="reader-page-controls">
          <button
            disabled={loading || location?.atStart || !!error}
            onClick={() => actionRef.current.prev()}
            aria-label={settings.flow === 'paginated' ? 'Предыдущая страница' : 'Предыдущая глава'}
          >
            <ArrowLeft size={18} />
            <span>{settings.flow === 'paginated' ? 'Назад' : 'Предыдущая глава'}</span>
          </button>
          <span>
            {settings.flow === 'paginated'
              ? `${location?.page ?? 1} / ${location?.totalPages ?? 1} в главе`
              : location?.chapter || 'Режим свитка'}
          </span>
          <button
            disabled={loading || location?.atEnd || !!error}
            onClick={() => actionRef.current.next()}
            aria-label={settings.flow === 'paginated' ? 'Следующая страница' : 'Следующая глава'}
          >
            <span>{settings.flow === 'paginated' ? 'Дальше' : 'Следующая глава'}</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </footer>
      {settings.showProgress && !loading && !error && (
        <div className="reader-mini-progress" aria-hidden={chrome}>
          <span aria-label={`Прочитано ${progress}%`}>{progress}%</span>
        </div>
      )}
      {panel && (
        <Dialog
          title={
            {
              toc: 'Оглавление',
              search: 'Поиск в книге',
              marks: 'Закладки и заметки',
              appearance: 'Как вам удобно',
            }[panel]
          }
          onClose={() => {
            searchAbort.current?.abort();
            setSearching(false);
            setPanel(null);
          }}
        >
          {panel === 'appearance' ? (
            <ReaderAppearance />
          ) : panel === 'toc' ? (
            <div className="toc">
              <p className="dialog-copy">
                {book.title} · {toc.length} разделов
              </p>
              {toc.length ? (
                renderToc(toc)
              ) : (
                <EmptyState heading="Оглавление не указано">
                  Переходите по страницам или используйте ползунок прогресса.
                </EmptyState>
              )}
            </div>
          ) : panel === 'search' ? (
            <>
              <form
                className="reader-search-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <div className="search-field">
                  <Search size={18} />
                  <input
                    data-autofocus
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Слово или фраза"
                    aria-label="Текст для поиска"
                    minLength={2}
                  />
                </div>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={searching || query.trim().length < 2}
                >
                  Найти
                </button>
              </form>
              {searching ? (
                <Loading label="Ищем во всей книге…" />
              ) : results.length ? (
                <>
                  <p className="search-count">
                    Найдено: {results.length}
                    {results.length === 200 ? ' (первые 200)' : ''}
                  </p>
                  <div className="search-results">
                    {results.map((r, i) => (
                      <button key={r.cfi + i} onClick={() => goTo(r.cfi)}>
                        <small>{r.chapter}</small>
                        <span>{r.excerpt}</span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={<Search size={28} />}
                  heading={searched ? 'Ничего не найдено' : 'Найдите нужную строку'}
                >
                  {searched
                    ? 'Попробуйте другое слово или его часть.'
                    : 'Поиск работает по всей книге, даже без интернета. От двух символов.'}
                </EmptyState>
              )}
            </>
          ) : annotations.length ? (
            <div className="reader-annotations">
              {annotations.map((a) => (
                <div className="annotation" key={a.id}>
                  <button onClick={() => goTo(a.cfi)}>
                    <small>
                      {a.kind === 'bookmark' ? <Bookmark size={14} /> : <Highlighter size={14} />}{' '}
                      {a.chapter || book.title}
                    </small>
                    <p>{a.text}</p>
                    {a.note && <span className="annotation-note">{a.note}</span>}
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Удалить запись"
                    onClick={() =>
                      void db.annotations
                        .delete(a.id)
                        .catch(() => notify('Не удалось удалить запись.'))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Bookmark size={29} />} heading="Сохраните то, что откликнулось">
              Нажмите на закладку вверху или выделите текст книги, чтобы добавить заметку.
            </EmptyState>
          )}
        </Dialog>
      )}
      {selection && (
        <Dialog
          title="Между строк"
          onClose={() => {
            engine.current?.clearSelection();
            setSelection(null);
          }}
        >
          <blockquote className="selected-quote">{selection.text}</blockquote>
          <div className="highlight-colors">
            {['#e4c85e', '#a1bfa3', '#c7b1d5'].map((c, i) => (
              <button
                key={c}
                style={{ background: c }}
                className={color === c ? 'selected' : ''}
                onClick={() => setColor(c)}
                aria-label={['Жёлтое выделение', 'Зелёное выделение', 'Сиреневое выделение'][i]}
                aria-pressed={color === c}
              >
                {color === c && <Check size={17} />}
              </button>
            ))}
          </div>
          <label className="note-label" htmlFor="reader-note">
            Ваша заметка <span>необязательно</span>
          </label>
          <textarea
            id="reader-note"
            className="note-textarea"
            placeholder="О чём заставила задуматься эта строка?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
            rows={4}
          />
          <button
            className="primary-button full-width"
            disabled={saving}
            onClick={() => void saveHighlight()}
          >
            <Highlighter size={17} />
            {saving ? 'Сохраняем…' : note ? 'Сохранить заметку' : 'Выделить текст'}
          </button>
        </Dialog>
      )}
    </div>
  );
}
