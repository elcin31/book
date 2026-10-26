import { APP_VERSION } from './version';
type DiagnosticFields = {
  code?: string;
  bytes?: number;
  width?: number;
  height?: number;
  sections?: number;
  textLength?: number;
  images?: number;
  hasPosition?: boolean;
  repaired?: boolean;
  kind?: string;
};
interface Entry {
  at: string;
  version: string;
  stage: string;
  bookId?: string;
  detail: DiagnosticFields;
}
let entries: Entry[] = [];
export function recordReaderDiagnostic(
  stage: string,
  detail: DiagnosticFields = {},
  bookId?: string,
) {
  entries.push({ at: new Date().toISOString(), version: APP_VERSION, stage, bookId, detail });
  entries = entries.slice(-60);
  try {
    sessionStorage.setItem('book-reader-diagnostics', JSON.stringify(entries));
  } catch {
    /* Diagnostics must never prevent reading. */
  }
}
export function readerDiagnostics(bookId: string) {
  return JSON.stringify(
    {
      version: APP_VERSION,
      events: entries.filter((e) => !e.bookId || e.bookId === bookId).slice(-20),
    },
    null,
    2,
  );
}
