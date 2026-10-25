import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ReaderSettings } from '../types';
export const defaultSettings: ReaderSettings = {
  theme: 'paper',
  font: 'literary',
  fontSize: 20,
  lineHeight: 1.65,
  margins: 24,
  letterSpacing: 0,
  paragraphSpacing: 0.7,
  align: 'justify',
  flow: 'paginated',
  bold: false,
  brightness: 100,
  keepAwake: false,
};
interface Preferences {
  reader: ReaderSettings;
  goal: number;
  appTheme: 'light' | 'dark' | 'auto';
  setReader: (patch: Partial<ReaderSettings>) => void;
  resetReader: () => void;
  setGoal: (goal: number) => void;
  setAppTheme: (theme: Preferences['appTheme']) => void;
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
    { name: 'book-preferences', version: 1 },
  ),
);
