import { it, expect } from 'vitest';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { unpackBoundedZip } from '../../src/engine/boundedZip';
it('unpacks an ordinary book and rejects parent-directory paths', () => {
  expect(
    strFromU8(unpackBoundedZip(zipSync({ 'books/ok.fb2': strToU8('book') }))['books/ok.fb2']),
  ).toBe('book');
  expect(() => unpackBoundedZip(zipSync({ '../outside.fb2': strToU8('bad') }))).toThrow(/путь/);
});
it('rejects highly compressed oversized entries before inflation', () => {
  const bomb = zipSync({ 'large.fb2': new Uint8Array(17 * 1024 * 1024) }, { level: 1 });
  expect(bomb.length).toBeLessThan(100000);
  expect(() => unpackBoundedZip(bomb)).toThrow(/16 МБ/);
});
