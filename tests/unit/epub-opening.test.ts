import { afterEach, expect, it, vi } from 'vitest';
import { EpubEngine } from '../../src/engine/EpubEngine';
import { defaultSettings } from '../../src/lib/settings';

const mock = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('epubjs', () => ({ default: mock.open }));
afterEach(() => vi.useRealTimers());

function environment(reportFailure: boolean) {
  const listeners = new Map<string, Set<(error?: unknown) => void>>();
  const rendition = {
    on: (name: string, callback: (error?: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
    },
    off: (name: string, callback: (error?: unknown) => void) =>
      listeners.get(name)?.delete(callback),
    hooks: { content: { register: vi.fn() } },
    themes: { default: vi.fn() },
    // EPUB.js 0.3.93 can emit displayError without settling display().
    display: () => {
      if (reportFailure)
        queueMicrotask(() =>
          listeners.get('displayError')?.forEach((cb) => cb(new Error('section failed'))),
        );
      return new Promise(() => {});
    },
  };
  const book = {
    open: async () => {},
    ready: Promise.resolve(),
    opened: Promise.resolve(),
    loaded: { spine: Promise.resolve([{}]), metadata: Promise.resolve({ language: 'ru' }) },
    spine: { hooks: { content: { register: vi.fn() } } },
    renderTo: () => rendition,
    destroy: vi.fn(),
  };
  mock.open.mockReturnValue(book);
  const mount = document.createElement('div');
  Object.defineProperties(mount, { clientWidth: { value: 370 }, clientHeight: { value: 836 } });
  const onLocation = vi.fn();
  const engine = new EpubEngine({
    onLocation,
    onSelection: vi.fn(),
    onTap: vi.fn(),
    onKey: vi.fn(),
  });
  return { engine, mount, onLocation, book };
}
it('rejects a section error even when the upstream display promise never settles', async () => {
  const { engine, mount, onLocation } = environment(true);
  await expect(engine.open(new ArrayBuffer(8), mount, defaultSettings)).rejects.toMatchObject({
    code: 'resource',
    stage: 'display',
  });
  expect(onLocation).not.toHaveBeenCalled();
  engine.destroy();
});
it('bounds a silently stalled display and leaves the saved position untouched', async () => {
  vi.useFakeTimers();
  const { engine, mount, onLocation } = environment(false);
  const assertion = expect(
    engine.open(new ArrayBuffer(8), mount, defaultSettings),
  ).rejects.toMatchObject({ code: 'timeout', stage: 'display' });
  await vi.advanceTimersByTimeAsync(30001);
  await assertion;
  expect(onLocation).not.toHaveBeenCalled();
  engine.destroy();
});
