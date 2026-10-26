import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ReaderSettings } from '../types';
export const defaultSettings: ReaderSettings = {
  theme: 'paper',
  font: 'literary',
  fontSize: 20,
  lineHeight: 1.65,
  margins: 16,
  verticalMargins: 12,
  letterSpacing: 0,
  paragraphSpacing: 0.7,
  paragraphIndent: 1.1,
  hyphenate: true,
  showProgress: true,
  align: 'left',
  flow: 'paginated',
  bold: false,
  brightness: 100,
  keepAwake: false,
};
export interface Preferences {
  reader: ReaderSettings;
  goal: number;
  appTheme: 'light' | 'dark' | 'auto';
  setReader: (patch: Partial<ReaderSettings>) => void;
  resetReader: () => void;
  setGoal: (goal: number) => void;
  setAppTheme: (theme: Preferences['appTheme']) => void;
}
// Zustand's default shallow merge would replace the entire reader object with
// the 1.0 settings. Fill only new fields; retain every existing preference.
export function mergePreferences(persisted: unknown, current: Preferences): Preferences {
  const saved = (persisted ?? {}) as Partial<Preferences>;
  return { ...current, ...saved, reader: { ...defaultSettings, ...saved.reader } };
}
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      reader: defaultSettings,
      goal: 20,
      appTheme: 'light',
      setReader: (patch) => set((s) => ({ reader: { ...s.reader, ...patch } })),
      resetReader: () => set({ reader: defaultSettings }),
      setGoal: (goal) => set({ goal }),
      setAppTheme: (appTheme) => set({ appTheme }),
    }),
    { name: 'book-preferences', version: 1, merge: mergePreferences },
  ),
);
