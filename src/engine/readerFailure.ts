export type ReaderFailureCode =
  | 'format'
  | 'document'
  | 'no-content'
  | 'viewport'
  | 'hidden'
  | 'timeout'
  | 'position'
  | 'resource'
  | 'webkit'
  | 'cancelled';
export class ReaderFailure extends Error {
  constructor(
    public code: ReaderFailureCode,
    public stage: string,
    message?: string,
  ) {
    super(
      message ??
        (code === 'format' || code === 'no-content'
          ? 'Не удалось прочитать содержимое файла'
          : code === 'position'
            ? 'Не удалось восстановить место чтения'
            : 'Книга загружена, но возникла ошибка отображения'),
    );
    this.name = 'ReaderFailure';
  }
}
export function readerFailure(error: unknown, stage = 'open'): ReaderFailure {
  if (error instanceof ReaderFailure) return error;
  return new ReaderFailure('document', stage);
}
export function deadline<T>(
  promise: Promise<T>,
  ms: number,
  stage: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new ReaderFailure('cancelled', stage));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new ReaderFailure(
          'timeout',
          stage,
          'Открытие книги заняло слишком много времени. Попробуйте ещё раз.',
        ),
      );
    }, ms);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
