import type { BookRecord } from '../types';
export function Cover({
  book,
  decorative = false,
}: {
  book: Pick<BookRecord, 'title' | 'author' | 'cover'>;
  decorative?: boolean;
}) {
  let variant = 0;
  for (const c of book.title) variant = (variant + c.charCodeAt(0)) % 5;
  if (book.title === 'Белые ночи') variant = 0;
  if (book.title === 'Пиковая дама') variant = 1;
  if (book.title === 'Дама с собачкой') variant = 2;
  return (
    <div className={`cover cover-${variant}`} aria-hidden={decorative || undefined}>
      {book.cover ? (
        <img src={book.cover} alt={decorative ? '' : `Обложка «${book.title}»`} loading="lazy" />
      ) : (
        <>
          <div className="cover-topline">БИБЛИОТЕКА BOOK</div>
          <div className="cover-author">{book.author}</div>
          <div className="cover-title">{book.title}</div>
          <div className="cover-art">
            <span />
            <span />
            <span />
            {variant === 1 && <b>♠</b>}
          </div>
          <div className="cover-foot">РУССКАЯ КЛАССИКА</div>
        </>
      )}
    </div>
  );
}
