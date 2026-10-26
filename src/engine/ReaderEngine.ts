import type { BookInspection } from './inspection';
import type { ReaderFailure } from './readerFailure';
import type { ReaderHealth } from './readerHealth';
import type { ReaderSettings, ReadingPosition, TocItem, SearchMatch } from '../types';
export interface ReaderLocation extends ReadingPosition {
  page: number;
  totalPages: number;
  atStart: boolean;
  atEnd: boolean;
}
export interface ReaderSelection {
  cfi: string;
  text: string;
}
export interface ReaderCallbacks {
  onLocation: (location: ReaderLocation) => void;
  onSelection: (selection: ReaderSelection) => void;
  onTap: (zone: 'left' | 'center' | 'right') => void;
  onKey: (key: string) => void;
  onError?: (message: string, failure?: ReaderFailure) => void;
  onState?: (health: ReaderHealth) => void;
}
export interface ReaderEngine {
  open: (
    data: ArrayBuffer,
    element: HTMLElement,
    settings: ReaderSettings,
    position?: string,
    inspection?: BookInspection,
  ) => Promise<TocItem[]>;
  next: () => Promise<void>;
  skipToText: () => Promise<void>;
  previous: () => Promise<void>;
  goTo: (target: string) => Promise<void>;
  goToPercent: (percent: number) => Promise<void>;
  configure: (settings: ReaderSettings) => Promise<void>;
  search: (query: string, signal: AbortSignal) => Promise<SearchMatch[]>;
  highlight: (cfi: string, color: string) => void;
  removeHighlight: (cfi: string) => void;
  clearSelection: () => void;
  destroy: () => void;
}
