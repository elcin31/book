import { useDeferredValue, useMemo, useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  CloudOff,
  Heart,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type { BookRecord, Collection } from '../types';
import { Cover } from './Cover';
import { EmptyState } from './Primitives';
export type LibraryFilter = 'all' | 'reading' | 'finished' | 'favorites' | string;
export function bookWord(n: number) {
  return n % 10 === 1 && n % 100 !== 11
    ? 'книга'
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? 'книги'
      : 'книг';
}
interface Props {
  books: BookRecord[];
  collections: Collection[];
  filter: LibraryFilter;
  onFilter: (filter: string) => void;
  onOpen: (book: BookRecord) => void;
  onDetails: (book: BookRecord) => void;
  onImport: () => void;
  onCreateCollection: () => void;
  onDeleteCollection: (id: string) => void;
}
export function Library({
  books,
  collections,
  filter,
  onFilter,
  onOpen,
  onDetails,
  onImport,
  onCreateCollection,
  onDeleteCollection,
}: Props) {
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState('recent'),
    [view, setView] = useState<'grid' | 'list'>('grid');
  const q = useDeferredValue(query.toLocaleLowerCase('ru'));
  const collection = collections.find((c) => c.id === filter);
  const filtered = useMemo(
    () =>
      books
        .filter(
          (b) =>
            (filter === 'all' ||
              (filter === 'reading' && b.status === 'reading') ||
              (filter === 'finished' && b.status === 'finished') ||
              (filter === 'favorites' && b.favorite) ||
              b.collectionIds.includes(filter)) &&
            `${b.title} ${b.author}`.toLocaleLowerCase('ru').includes(q),
        )
        .sort((a, b) =>
          sort === 'title'
            ? a.title.localeCompare(b.title, 'ru')
            : sort === 'author'
              ? a.author.localeCompare(b.author, 'ru')
              : sort === 'added'
                ? b.addedAt - a.addedAt
                : (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt),
        ),
    [books, filter, q, sort],
  );
  const current = [...books]
    .filter((b) => b.status === 'reading')
    .sort((a, b) => b.lastReadAt - a.lastReadAt)[0];
  const titles: Record<string, string> = {
    all: 'Библиотека',
    reading: 'Читаю сейчас',
    finished: 'Прочитано',
    favorites: 'Избранное',
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ИСТОРИИ, КОТОРЫЕ ВСЕГДА РЯДОМ</p>
          <h1>
            {titles[filter] ?? collection?.name ?? 'Библиотека'}
            <span className="count-badge">{filtered.length}</span>
          </h1>
        </div>
        <button className="primary-button desktop-add" onClick={onImport}>
          <Plus size={18} />
          Добавить книгу
        </button>
      </div>
      {filter === 'all' && !query && (
        <section className={`reading-hero ${current ? 'has-current' : ''}`}>
          <div className="hero-copy">
            <span className="hero-label">
              <span className="small-line" />
              {current ? 'ПРОДОЛЖИТЬ ЧТЕНИЕ' : 'НЕМНОГО ВРЕМЕНИ ДЛЯ СЕБЯ'}
            </span>
            <h2>
              {current ? (
                current.title
              ) : (
                <>
                  Откройте
                  <br />
                  новую главу.
                </>
              )}
            </h2>
            <p>
              {current ? current.author : 'Хорошая книга. Тихий момент.\nИ целый мир между строк.'}
            </p>
            {current && (
              <div className="hero-progress">
                <span style={{ width: `${Math.round((current.position?.percent ?? 0) * 100)}%` }} />
                <small>Прочитано {Math.round((current.position?.percent ?? 0) * 100)}%</small>
              </div>
            )}
            <button
              className="hero-button"
              onClick={() =>
                current
                  ? onOpen(current)
                  : document
                      .getElementById('library-books')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              {current ? 'Продолжить чтение' : 'К вашим книгам'}
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="hero-illustration" aria-hidden="true">
            <div className="hero-circle" />
            <div className="hero-orbit" />
            <span className="hero-star star-one">✧</span>
            <span className="hero-star star-two">✦</span>
            <div className="hero-book book-back">
              <Cover
                book={
                  books.find((b) => b.title === 'Пиковая дама') ?? {
                    title: 'Пиковая дама',
                    author: 'Александр Пушкин',
                  }
                }
                decorative
              />
            </div>
            <div className="hero-book book-front">
              <Cover
                book={
                  current ??
                  books.find((b) => b.title === 'Белые ночи') ?? {
                    title: 'Белые ночи',
                    author: 'Фёдор Достоевский',
                  }
                }
                decorative
              />
            </div>
            <span className="hero-caption">ЕЩЁ ОДНА СТРАНИЦА — И ВЫ В ДРУГОМ МИРЕ</span>
          </div>
        </section>
      )}
      <section id="library-books" className="library-section">
        <div className="section-title">
          <div>
            <h2>
              {filter === 'all' ? 'Ваши книги' : 'На вашей полке'}{' '}
              <span>
                {books.length} {bookWord(books.length)}
              </span>
            </h2>
          </div>
          <div className="view-switch">
            <button
              aria-label="Показать сеткой"
              aria-pressed={view === 'grid'}
              className={view === 'grid' ? 'active' : ''}
              onClick={() => setView('grid')}
            >
              <LayoutGrid size={17} />
            </button>
            <button
              aria-label="Показать списком"
              aria-pressed={view === 'list'}
              className={view === 'list' ? 'active' : ''}
              onClick={() => setView('list')}
            >
              <List size={19} />
            </button>
          </div>
        </div>
        <div className="library-tools">
          <div className="filter-tabs" aria-label="Фильтр книг">
            {[
              ['all', 'Все книги'],
              ['reading', 'Читаю'],
              ['finished', 'Прочитано'],
              ['favorites', 'Избранное'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? 'active' : ''}
                onClick={() => onFilter(id)}
              >
                {id === 'favorites' && <Heart size={14} />}
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="search-sort">
            <div className="search-field">
              <Search size={17} />
              <input
                type="search"
                aria-label="Поиск по библиотеке"
                placeholder="Название или автор"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="Очистить поиск" onClick={() => setQuery('')}>
                  <X size={15} />
                </button>
              )}
            </div>
            <label className="sort-control">
              <ArrowDownWideNarrow size={17} />
              <select
                aria-label="Сортировка книг"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="recent">Недавние</option>
                <option value="added">По дате добавления</option>
                <option value="title">По названию</option>
                <option value="author">По автору</option>
              </select>
              <ChevronDown size={13} />
            </label>
          </div>
        </div>
        {collection && (
          <div className="collection-heading">
            <span>
              Коллекция · {filtered.length} {bookWord(filtered.length)}
            </span>
            <button
              className="text-button danger"
              onClick={() => onDeleteCollection(collection.id)}
            >
              Удалить коллекцию
            </button>
          </div>
        )}
        {filtered.length ? (
          <div className={`book-grid ${view === 'list' ? 'book-list' : ''}`}>
            {filtered.map((book) => (
              <article className="book-card" key={book.id}>
                <div className="book-cover-wrap">
                  <button
                    className="book-open"
                    onClick={() => onOpen(book)}
                    aria-label={`Читать «${book.title}»`}
                  >
                    <Cover book={book} />
                    <span className="cover-open-label">
                      Читать <ArrowRight size={16} />
                    </span>
                  </button>
                  {book.favorite && (
                    <span className="favorite-mark">
                      <Heart size={13} fill="currentColor" />
                    </span>
                  )}
                  {book.status === 'finished' && (
                    <span className="finished-mark">
                      <Check size={13} />
                      Прочитано
                    </span>
                  )}
                </div>
                <div className="book-info">
                  <div className="book-title-row">
                    <button className="book-title" onClick={() => onOpen(book)}>
                      {book.title}
                    </button>
                    <button
                      className="book-menu icon-button"
                      onClick={() => onDetails(book)}
                      aria-label={`Действия с книгой «${book.title}»`}
                    >
                      <MoreHorizontal size={19} />
                    </button>
                  </div>
                  <p className="book-author">{book.author}</p>
                  <div className="book-meta">
                    <span>{book.format}</span>
                    <span className="meta-dot" />
                    {book.status === 'reading' ? (
                      <span className="reading-percent">
                        {Math.round((book.position?.percent ?? 0) * 100)}% прочитано
                      </span>
                    ) : book.status === 'finished' ? (
                      <span className="reading-percent">Прочитано</span>
                    ) : (
                      <span>Не начата</span>
                    )}
                    <CloudOff size={12} className="offline-book" aria-label="Доступна офлайн" />
                  </div>
                  {book.status === 'reading' && (
                    <div className="book-progress">
                      <i style={{ width: `${(book.position?.percent ?? 0) * 100}%` }} />
                    </div>
                  )}
                </div>
              </article>
            ))}
            {filter === 'all' && !query && (
              <button className="add-book-tile" onClick={onImport}>
                <span>
                  <Plus size={25} strokeWidth={1.3} />
                </span>
                <strong>Новая история</strong>
                <small>Добавьте свою книгу</small>
                <em>EPUB · FB2 · TXT</em>
              </button>
            )}
          </div>
        ) : (
          <EmptyState
            icon={
              query ? (
                <Search size={30} />
              ) : filter === 'favorites' ? (
                <Heart size={30} />
              ) : (
                <Bookmark size={30} />
              )
            }
            heading={
              query
                ? 'Ничего не найдено'
                : filter === 'all'
                  ? 'Здесь начнётся ваша история'
                  : 'На этой полке пока тихо'
            }
            action={
              filter === 'all' ? (
                <button className="primary-button" onClick={onImport}>
                  <Plus size={17} />
                  Добавить книгу
                </button>
              ) : (
                <button
                  className="secondary-button"
                  onClick={() => {
                    onFilter('all');
                    setQuery('');
                  }}
                >
                  Все книги
                </button>
              )
            }
          >
            {query
              ? 'Попробуйте другое название или имя автора.'
              : filter === 'reading'
                ? 'Откройте любую книгу — она появится здесь.'
                : filter === 'favorites'
                  ? 'Добавьте любимые книги в избранное через меню книги.'
                  : collection
                    ? 'Добавьте сюда книги через их меню.'
                    : 'Все ваши книги хранятся на этом устройстве.'}
          </EmptyState>
        )}
        <button className="mobile-collection-create text-button" onClick={onCreateCollection}>
          <Plus size={15} />
          Создать коллекцию
        </button>
        {collections.length > 0 && (
          <div className="mobile-collections">
            {collections.map((c) => (
              <button
                className={filter === c.id ? 'active' : ''}
                key={c.id}
                onClick={() => onFilter(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </section>
      <footer className="library-footer">
        <span>
          <CloudOff size={14} />
          Ваши книги — только на вашем устройстве
        </span>
        <span>Без рекламы. Без суеты.</span>
      </footer>
    </>
  );
}
