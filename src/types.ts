import type { BookInspection } from './engine/inspection';
export type BookFormat = 'EPUB' | 'FB2' | 'TXT';
export type BookStatus = 'new' | 'reading' | 'finished';
export interface ReadingPosition {
  cfi: string;
  percent: number;
  chapter: string;
  updatedAt: number;
}
export interface BookRecord {
  id: string;
  hash: string;
  title: string;
  author: string;
  description: string;
  format: BookFormat;
  cover?: string;
  addedAt: number;
  lastReadAt: number;
  size: number;
  fileName: string;
  status: BookStatus;
  favorite: boolean;
  collectionIds: string[];
  position?: ReadingPosition;
  sample?: boolean;
}
export interface BookFile {
  id: string;
  data: ArrayBuffer;
  original: ArrayBuffer;
  originalType: string;
  normalizerVersion?: number;
  normalizedHash?: string;
  inspection?: BookInspection;
}
export interface Annotation {
  id: string;
  bookId: string;
  cfi: string;
  text: string;
  note: string;
  kind: 'bookmark' | 'highlight';
  color: string;
  chapter: string;
  createdAt: number;
}
export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}
export interface ReadingDay {
  date: string;
  seconds: number;
}
export type ReaderTheme = 'paper' | 'sepia' | 'night' | 'black';
export interface ReaderSettings {
  theme: ReaderTheme;
  font: 'literary' | 'classic' | 'system' | 'mono';
  fontSize: number;
  lineHeight: number;
  margins: number;
  verticalMargins: number;
  letterSpacing: number;
  paragraphSpacing: number;
  paragraphIndent: number;
  hyphenate: boolean;
  showProgress: boolean;
  align: 'justify' | 'left';
  flow: 'paginated' | 'scrolled';
  bold: boolean;
  brightness: number;
  keepAwake: boolean;
}
export interface TocItem {
  id: string;
  label: string;
  href: string;
  children: TocItem[];
}
export interface SearchMatch {
  cfi: string;
  excerpt: string;
  chapter: string;
}
