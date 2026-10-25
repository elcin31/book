import { useState } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  Download,
  FolderPlus,
  Heart,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { db, removeBook } from '../lib/db';
import { download, formatBytes } from '../lib/download';
import type { BookRecord, Collection } from '../types';
import { Dialog } from './Primitives';
import { Cover } from './Cover';
export function BookDetails({
  book,
  collections,
  onClose,
  onRead,
  notify,
}: {
  book: BookRecord;
  collections: Collection[];
  onClose: () => void;
  onRead: (book: BookRecord) => void;
  notify: (message: string) => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [selectedCollections, setSelectedCollections] = useState(book.collectionIds);
  const update = async (patch: Partial<BookRecord>) => {
    try {
      await db.books.update(book.id, patch);
    } catch {
      notify('Не удалось сохранить изменения.');
    }
  };
  const deleteBook = async () => {
    setBusy(true);
    try {
      await removeBook(book.id);
      notify('Книга удалена с устройства');
      onClose();
    } catch {
      notify('Не удалось удалить книгу.');
      setBusy(false);
    }
  };
  return (
    <Dialog title={confirm ? 'Удалить книгу?' : 'О книге'} onClose={onClose}>
      {confirm ? (
        <>
          <p className="dialog-copy">
            «{book.title}», её прогресс, закладки и заметки будут удалены с этого устройства. Другие
            книги останутся в библиотеке.
          </p>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={() => setConfirm(false)}>
              Отмена
            </button>
            <button className="danger-button" disabled={busy} onClick={() => void deleteBook()}>
              {busy ? 'Удаляем…' : 'Удалить книгу'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="book-detail-heading">
            <div className="detail-cover">
              <Cover book={book} />
            </div>
            <div>
              <span className="eyebrow">
                {book.format} · {formatBytes(book.size)}
              </span>
              <h3>{book.title}</h3>
              <p>{book.author}</p>
              <small>
                {book.position
                  ? `${Math.round(book.position.percent * 100)}% прочитано`
                  : 'Ещё не открывали'}
              </small>
            </div>
          </div>
          {book.description && <p className="book-description">{book.description}</p>}
          <button
            className="primary-button full-width"
            onClick={() => {
              onClose();
              onRead(book);
            }}
          >
            <BookOpen size={18} />
            {book.position ? 'Продолжить чтение' : 'Начать читать'}
          </button>
          <div className="action-list">
            <button onClick={() => void update({ favorite: !book.favorite })}>
              <Heart size={19} fill={book.favorite ? 'currentColor' : 'none'} />
              {book.favorite ? 'Убрать из избранного' : 'В избранное'}
              {book.favorite && <Check size={17} />}
            </button>
            <button
              onClick={() =>
                void update({
                  status: book.status === 'finished' ? 'new' : 'finished',
                  ...(book.status === 'finished'
                    ? {}
                    : { position: book.position ? { ...book.position, percent: 1 } : undefined }),
                })
              }
            >
              <CheckCircle2 size={19} />
              {book.status === 'finished' ? 'Отметить непрочитанной' : 'Отметить прочитанной'}
            </button>
            <button
              onClick={async () => {
                try {
                  const file = await db.files.get(book.id);
                  if (file)
                    download(new Blob([file.original], { type: file.originalType }), book.fileName);
                  else notify('Оригинал не найден.');
                } catch {
                  notify('Не удалось сохранить файл.');
                }
              }}
            >
              <Download size={19} />
              Сохранить оригинал
            </button>
            {book.position && (
              <button
                onClick={async () => {
                  try {
                    await db.books.update(book.id, {
                      position: undefined,
                      lastReadAt: 0,
                      status: 'new',
                    });
                    localStorage.removeItem(`book-position:${book.id}`);
                    notify('Прогресс сброшен');
                  } catch {
                    notify('Не удалось сбросить прогресс.');
                  }
                }}
              >
                <RotateCcw size={19} />
                Начать с начала
              </button>
            )}
          </div>
          {collections.length > 0 && (
            <div className="detail-collections">
              <h4>
                <FolderPlus size={17} />
                Добавить в коллекцию
              </h4>
              {collections.map((c) => (
                <label key={c.id}>
                  <span>{c.name}</span>
                  <input
                    type="checkbox"
                    checked={selectedCollections.includes(c.id)}
                    onChange={(e) => {
                      const ids = e.target.checked
                        ? [...selectedCollections, c.id]
                        : selectedCollections.filter((id) => id !== c.id);
                      setSelectedCollections(ids);
                      void update({ collectionIds: ids });
                    }}
                  />
                </label>
              ))}
            </div>
          )}
          <button className="delete-book" onClick={() => setConfirm(true)}>
            <Trash2 size={16} />
            Удалить с устройства
          </button>
        </>
      )}
    </Dialog>
  );
}
