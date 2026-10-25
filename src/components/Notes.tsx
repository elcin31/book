import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowUpRight, Bookmark, Highlighter, Pencil, Search, Trash2 } from 'lucide-react';
import { db } from '../lib/db';
import type { Annotation, BookRecord } from '../types';
import { Dialog, EmptyState } from './Primitives';
export function Notes({
  books,
  onOpen,
  notify,
}: {
  books: BookRecord[];
  onOpen: (book: BookRecord, cfi: string) => void;
  notify: (message: string) => void;
}) {
  const annotations =
    useLiveQuery(() => db.annotations.orderBy('createdAt').reverse().toArray()) ?? [];
  const [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [editing, setEditing] = useState<Annotation | null>(null),
    [text, setText] = useState('');
  const filtered = annotations.filter(
    (a) =>
      (filter === 'all' || a.kind === filter) &&
      `${a.text} ${a.note} ${books.find((b) => b.id === a.bookId)?.title ?? ''}`
        .toLocaleLowerCase('ru')
        .includes(query.toLocaleLowerCase('ru')),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">МЫСЛИ, К КОТОРЫМ ХОЧЕТСЯ ВЕРНУТЬСЯ</p>
          <h1>
            Между строк<span className="count-badge">{annotations.length}</span>
          </h1>
        </div>
      </div>
      <div className="notes-toolbar">
        <div className="filter-tabs">
          {[
            ['all', 'Всё'],
            ['bookmark', 'Закладки'],
            ['highlight', 'Выделения'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? 'active' : ''}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={17} />
          <input
            type="search"
            placeholder="Поиск по записям"
            aria-label="Поиск по записям"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {filtered.length ? (
        <div className="notes-grid">
          {filtered.map((a) => {
            const book = books.find((b) => b.id === a.bookId);
            return (
              <article className="note-card" key={a.id}>
                <div className="note-card-top">
                  <span>
                    {a.kind === 'bookmark' ? <Bookmark size={16} /> : <Highlighter size={16} />}{' '}
                    {a.kind === 'bookmark' ? 'Закладка' : 'Выделение'}
                  </span>
                  <time>
                    {new Date(a.createdAt).toLocaleDateString('ru', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </time>
                </div>
                <blockquote style={{ borderColor: a.color }}>{a.text}</blockquote>
                {a.note && <p>{a.note}</p>}
                <footer>
                  <button className="note-book-link" onClick={() => book && onOpen(book, a.cfi)}>
                    {book?.title ?? 'Книга удалена'}
                    <ArrowUpRight size={14} />
                  </button>
                  <div>
                    <button
                      className="icon-button"
                      aria-label="Редактировать заметку"
                      onClick={() => {
                        setEditing(a);
                        setText(a.note);
                      }}
                    >
                      <Pencil size={15} />
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
                      <Trash2 size={15} />
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Bookmark size={31} />}
          heading={query ? 'Ничего не найдено' : 'Самое важное — между строк'}
        >
          {query
            ? 'Попробуйте другой запрос.'
            : 'Во время чтения оставляйте закладки, выделяйте любимые строки и сохраняйте свои мысли. Они появятся здесь.'}
        </EmptyState>
      )}
      {editing && (
        <Dialog title="Ваша заметка" onClose={() => setEditing(null)}>
          <blockquote className="selected-quote">{editing.text}</blockquote>
          <textarea
            data-autofocus
            className="note-textarea"
            aria-label="Текст заметки"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            maxLength={4000}
          />
          <button
            className="primary-button full-width"
            onClick={async () => {
              try {
                await db.annotations.update(editing.id, { note: text });
                setEditing(null);
                notify('Заметка сохранена');
              } catch {
                notify('Не удалось сохранить заметку.');
              }
            }}
          >
            Сохранить
          </button>
        </Dialog>
      )}
    </>
  );
}
