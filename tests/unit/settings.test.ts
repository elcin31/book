import { describe, expect, it } from 'vitest';
import { defaultSettings, mergePreferences, usePreferences } from '../../src/lib/settings';

describe('1.0 reader preferences', () => {
  it('adds fullscreen fields without resetting any saved reading choice', () => {
    const saved = {
      reader: {
        theme: 'night',
        font: 'classic',
        fontSize: 31,
        lineHeight: 1.9,
        margins: 40,
        letterSpacing: 0.3,
        paragraphSpacing: 0.9,
        align: 'justify',
        flow: 'scrolled',
        bold: true,
        brightness: 75,
        keepAwake: true,
      },
      goal: 45,
      appTheme: 'dark',
    };
    const merged = mergePreferences(saved, usePreferences.getState());
    expect(merged.reader).toMatchObject(saved.reader);
    expect(merged.reader.verticalMargins).toBe(12);
    expect(merged.reader.paragraphIndent).toBe(1.1);
    expect(merged.reader.hyphenate).toBe(true);
    expect(merged.reader.showProgress).toBe(true);
    expect(merged.goal).toBe(45);
    expect(merged.appTheme).toBe('dark');
    expect(merged.setReader).toBe(usePreferences.getState().setReader);
  });
  it('retains custom fullscreen values on later hydrations', () => {
    expect(
      mergePreferences(
        {
          reader: {
            ...defaultSettings,
            verticalMargins: 3,
            paragraphIndent: 0,
            showProgress: false,
          },
        },
        usePreferences.getState(),
      ).reader,
    ).toMatchObject({ verticalMargins: 3, paragraphIndent: 0, showProgress: false });
  });
});
