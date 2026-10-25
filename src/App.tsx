import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  BookOpen,
  Bookmark,
  Check,
  CheckCircle2,
  Coffee,
  Folder,
  Heart,
  LibraryBig,
  LoaderCircle,
  Plus,
  Settings2,
  Sparkles,
  Target,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { db } from './lib/db';
import { initializeLibrary } from './lib/seed';
import { importBook } from './engine/importer';
import { usePreferences } from './lib/settings';
import { Library, type LibraryFilter } from './components/Library';
import { BookDetails } from './components/BookDetails';
import { ReadingStats } from './components/ReadingStats';
import { Notes } from './components/Notes';
import { Settings } from './components/Settings';
import { Dialog, Loading } from './components/Primitives';
import type { BookRecord } from './types';
const Reader = lazy(() => import('./components/Reader'));
type Page = 'library' | 'notes' | 'stats' | 'settings';
const navigation = [
  { id: 'library' as const, label: 'Библиотека', icon: LibraryBig },
  { id: 'notes' as const, label: 'Между строк', icon: Bookmark },
  { id: 'stats' as const, label: 'Время читать', icon: Target },
  { id: 'settings' as const, label: 'Настройки', icon: Settings2 },
];
export default function App() {
  const books = useLiveQuery(() => db.books.toArray()),
    collections = useLiveQuery(() => db.collections.orderBy('createdAt').toArray()) ?? [];
  const [page, setPage] = useState<Page>('library'),
    [filter, setFilter] = useState<LibraryFilter>('all'),
    [reading, setReading] = useState<{ book: BookRecord; cfi?: string } | null>(null),
    [details, setDetails] = useState<string | null>(null),
    [newCollection, setNewCollection] = useState(false),
    [collectionName, setCollectionName] = useState(''),
    [collectionError, setCollectionError] = useState(''),
    [deleteCollection, setDeleteCollection] = useState<string | null>(null),
    [toast, setToast] = useState(''),
    [importing, setImporting] = useState(''),
    [importErrors, setImportErrors] = useState<string[]>([]),
    [dragging, setDragging] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [seedReady, setSeedReady] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const importingRef = useRef(false);
  const notify = useCallback((message: string) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: () =>
      notify('Не удалось подготовить офлайн-режим. Откройте приложение онлайн ещё раз.'),
  });
  const appTheme = usePreferences((s) => s.appTheme);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = appTheme === 'dark' || (appTheme === 'auto' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#1d2420' : '#f8f7f3');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appTheme]);
  useEffect(() => {
    void initializeLibrary()
      .catch((e) =>
        notify(e instanceof Error ? e.message : 'Добавьте книги через кнопку «Добавить».'),
      )
      .finally(() => setSeedReady(true));
    return () => clearTimeout(toastTimer.current);
  }, [notify]);
  useEffect(() => {
    const check = () => setOnline(navigator.onLine);
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
    };
  }, []);
  useEffect(() => {
    if (offlineReady && !reading && !toast) {
      notify('Готово к чтению офлайн. Все книги доступны без интернета.');
      setOfflineReady(false);
    }
  }, [offlineReady, reading, toast, notify, setOfflineReady]);
  const closeReader = useCallback(() => setReading(null), []);
  const openBook = (book: BookRecord, cfi?: string) => {
    setReading({ book, cfi });
    setDetails(null);
  };
  const selectFilter = (next: string) => {
    setPage('library');
    setFilter(next);
  };
  const addCollection = async () => {
    const name = collectionName.trim();
    if (!name) {
      setCollectionError('Введите название коллекции.');
      return;
    }
    if (collections.some((c) => c.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) {
      setCollectionError('Коллекция с таким названием уже есть.');
      return;
    }
    try {
      const id = crypto.randomUUID();
      await db.collections.add({ id, name, createdAt: Date.now() });
      setNewCollection(false);
      setCollectionName('');
      selectFilter(id);
      notify('Коллекция создана');
    } catch {
      setCollectionError('Не удалось создать коллекцию.');
    }
  };
  const importFiles = async (files: FileList | File[]) => {
    if (importingRef.current) return;
    importingRef.current = true;
    const errors: string[] = [];
    let added = 0,
      duplicates = 0;
    const list = Array.from(files);
    try {
      for (let i = 0; i < list.length; i++) {
        setImporting(`Добавляем ${i + 1} из ${list.length} · ${list[i].name}`);
        try {
          const result = await importBook(list[i]);
          if (result.duplicate) duplicates++;
          else added++;
        } catch (e) {
          errors.push(
            `${list[i].name}: ${e instanceof Error ? e.message : 'Не удалось прочитать файл.'}`,
          );
        }
      }
    } finally {
      setImporting('');
      importingRef.current = false;
    }
    if (errors.length) setImportErrors(errors);
    if (added || duplicates)
      notify(`Добавлено книг: ${added}${duplicates ? ` · Уже в библиотеке: ${duplicates}` : ''}`);
    setPage('library');
    setFilter('all');
  };
  const content = reading ? (
    <Suspense fallback={<Loading label="Открываем читалку…" />}>
      <Reader book={reading.book} initialCfi={reading.cfi} onClose={closeReader} notify={notify} />
    </Suspense>
  ) : (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            selectFilter('all');
          }}
          aria-label="BOOK — библиотека"
        >
          <BookOpen size={27} strokeWidth={1.4} />
          <span>
            BOOK<span className="brand-period">.</span>
          </span>
        </a>
        <span className="brand-tagline">ХОРОШИЕ ИСТОРИИ БЛИЖЕ</span>
        <nav className="main-nav" aria-label="Главное меню">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? 'active' : ''}
              onClick={() => {
                setPage(id);
                if (id === 'library') setFilter('all');
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === 'library' && <small>{books?.length ?? 0}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-label">МОЯ БИБЛИОТЕКА</div>
        <nav className="shelf-nav" aria-label="Полки">
          <button
            className={page === 'library' && filter === 'reading' ? 'active' : ''}
            onClick={() => selectFilter('reading')}
          >
            <BookOpen size={17} />
            Читаю сейчас<span>{books?.filter((b) => b.status === 'reading').length ?? 0}</span>
          </button>
          <button
            className={page === 'library' && filter === 'favorites' ? 'active' : ''}
            onClick={() => selectFilter('favorites')}
          >
            <Heart size={17} />
            Избранное<span>{books?.filter((b) => b.favorite).length ?? 0}</span>
          </button>
          <button
            className={page === 'library' && filter === 'finished' ? 'active' : ''}
            onClick={() => selectFilter('finished')}
          >
            <CheckCircle2 size={17} />
            Прочитано<span>{books?.filter((b) => b.status === 'finished').length ?? 0}</span>
          </button>
        </nav>
        <div className="sidebar-label collections-label">
          КОЛЛЕКЦИИ
          <button
            aria-label="Создать коллекцию"
            onClick={() => {
              setCollectionError('');
              setNewCollection(true);
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <nav className="collection-nav" aria-label="Коллекции">
          {collections.map((c) => (
            <button
              key={c.id}
              className={page === 'library' && filter === c.id ? 'active' : ''}
              onClick={() => selectFilter(c.id)}
            >
              <Folder size={17} />
              <span>{c.name}</span>
            </button>
          ))}
          <button
            className="create-collection"
            onClick={() => {
              setCollectionError('');
              setNewCollection(true);
            }}
          >
            <Plus size={17} />
            Новая коллекция
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="quiet-note">
            <Coffee size={24} strokeWidth={1.2} />
            <p>
              Мир подождёт.
              <br />
              <em>Прочитайте ещё главу.</em>
            </p>
          </div>
          <span className="version-label">
            BOOK 1.0 <span>С любовью к чтению</span>
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-topbar">
          <a
            className="mobile-brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              selectFilter('all');
            }}
          >
            BOOK<span>.</span>
          </a>
          <span className="topbar-date">
            {new Date().toLocaleDateString('ru', {
              day: 'numeric',
              month: 'long',
              weekday: 'long',
            })}
          </span>
          <div className="topbar-right">
            <span className="local-indicator">
              <i className={online ? '' : 'offline'} />
              {online ? 'На вашем устройстве' : 'Без интернета'}
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button topbar-settings"
              onClick={() => setPage('settings')}
              aria-label="Настройки"
            >
              <Settings2 size={18} />
            </button>
            <button
              className="mobile-add icon-button"
              aria-label="Добавить книгу"
              onClick={() => input.current?.click()}
            >
              <Plus size={24} />
            </button>
          </div>
        </header>
        <main className="main-content">
          {!online && (
            <div className="offline-banner">
              <WifiOff size={15} />
              Вы офлайн. Ваша библиотека по-прежнему с вами.
            </div>
          )}
          {books === undefined || !seedReady ? (
            <Loading />
          ) : page === 'library' ? (
            <Library
              books={books}
              collections={collections}
              filter={filter}
              onFilter={setFilter}
              onOpen={openBook}
              onDetails={(b) => setDetails(b.id)}
              onImport={() => input.current?.click()}
              onCreateCollection={() => {
                setCollectionError('');
                setNewCollection(true);
              }}
              onDeleteCollection={setDeleteCollection}
            />
          ) : page === 'stats' ? (
            <ReadingStats books={books} />
          ) : page === 'notes' ? (
            <Notes books={books} onOpen={openBook} notify={notify} />
          ) : (
            <Settings notify={notify} />
          )}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Главное меню">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={page === id ? 'active' : ''}
            onClick={() => {
              setPage(id);
              if (id === 'library') setFilter('all');
            }}
          >
            <Icon size={21} strokeWidth={page === id ? 2 : 1.5} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
  const detailBook = books?.find((b) => b.id === details);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
      }}
    >
      {content}
      <input
        ref={input}
        type="file"
        multiple
        accept=".epub,.fb2,.zip,.txt,application/epub+zip,application/x-fictionbook+xml,text/plain"
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Upload size={48} strokeWidth={1.3} />
            <h2>Новая история начинается здесь</h2>
            <p>Отпустите EPUB, FB2 или TXT</p>
          </div>
        </div>
      )}
      {importing && (
        <div className="import-indicator" role="status">
          <LoaderCircle className="spin" size={19} />
          {importing}
        </div>
      )}
      {detailBook && (
        <BookDetails
          book={detailBook}
          collections={collections}
          onClose={() => setDetails(null)}
          onRead={openBook}
          notify={notify}
        />
      )}{' '}
      {newCollection && (
        <Dialog title="Новая коллекция" onClose={() => setNewCollection(false)}>
          <p className="dialog-copy">Соберите книги по настроению, теме или любимому автору.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addCollection();
            }}
          >
            <label className="field-label" htmlFor="collection-name">
              Название
            </label>
            <input
              data-autofocus
              className="text-input"
              id="collection-name"
              value={collectionName}
              onChange={(e) => {
                setCollectionName(e.target.value);
                setCollectionError('');
              }}
              maxLength={60}
              placeholder="Например, Тихие вечера"
            />
            {collectionError && (
              <p className="field-error" role="alert">
                {collectionError}
              </p>
            )}
            <button className="primary-button full-width" type="submit">
              <Plus size={18} />
              Создать коллекцию
            </button>
          </form>
        </Dialog>
      )}
      {deleteCollection && (
        <Dialog title="Удалить коллекцию?" onClose={() => setDeleteCollection(null)}>
          <p className="dialog-copy">
            Книги останутся в вашей библиотеке. Будет удалена только коллекция «
            {collections.find((c) => c.id === deleteCollection)?.name}».
          </p>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={() => setDeleteCollection(null)}>
              Отмена
            </button>
            <button
              className="danger-button"
              onClick={async () => {
                try {
                  await db.transaction('rw', [db.collections, db.books], async () => {
                    await db.collections.delete(deleteCollection);
                    await db.books
                      .where('collectionIds')
                      .equals(deleteCollection)
                      .modify((b) => {
                        b.collectionIds = b.collectionIds.filter((id) => id !== deleteCollection);
                      });
                  });
                  setDeleteCollection(null);
                  setFilter('all');
                  notify('Коллекция удалена');
                } catch {
                  notify('Не удалось удалить коллекцию.');
                }
              }}
            >
              Удалить
            </button>
          </div>
        </Dialog>
      )}
      {importErrors.length > 0 && (
        <Dialog title="Не все книги удалось добавить" onClose={() => setImportErrors([])}>
          <ul className="import-errors">
            {importErrors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
          <p className="control-hint">
            Остальные книги сохранены. Поддерживаются EPUB без DRM, FB2, FB2.ZIP и TXT до 50 МБ.
          </p>
        </Dialog>
      )}
      {needRefresh && !reading && (
        <div className="update-banner">
          <Sparkles size={17} />
          <span>Доступна новая версия BOOK</span>
          <button onClick={() => void updateServiceWorker(true)}>Обновить</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
