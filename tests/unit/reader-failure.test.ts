import { afterEach, expect, it, vi } from 'vitest';
import { deadline, ReaderFailure } from '../../src/engine/readerFailure';
afterEach(() => vi.useRealTimers());
it('bounds an unresolved display promise and preserves its stage', async () => {
  vi.useFakeTimers();
  const result = deadline(new Promise<void>(() => {}), 30000, 'display');
  const assertion = expect(result).rejects.toMatchObject({ code: 'timeout', stage: 'display' });
  await vi.advanceTimersByTimeAsync(30001);
  await assertion;
});
it('aborts a pending open during navigation away', async () => {
  const controller = new AbortController();
  const result = deadline(new Promise<void>(() => {}), 30000, 'open', controller.signal);
  controller.abort();
  await expect(result).rejects.toMatchObject({ code: 'cancelled' });
});
it('does not swallow actual failures', async () => {
  const error = new ReaderFailure('resource', 'section');
  await expect(deadline(Promise.reject(error), 30000, 'display')).rejects.toBe(error);
});
