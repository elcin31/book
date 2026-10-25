import { unzipSync } from 'fflate';
/** Read central-directory sizes before inflation; this runs off the UI thread. */
export function unpackBoundedZip(
  data: Uint8Array,
  profile: 'book' | 'backup' = 'book',
): Record<string, Uint8Array> {
  let total = 0,
    count = 0;
  return unzipSync(data, {
    filter(entry) {
      if (
        ++count > 4000 ||
        entry.originalSize > (profile === 'backup' ? 100 : 16) * 1024 * 1024 ||
        (total += entry.originalSize) > 100 * 1024 * 1024
      )
        throw new Error(
          profile === 'backup'
            ? 'Резервная копия превышает 100 МБ после распаковки.'
            : 'Архив превышает лимиты: 100 МБ суммарно, 16 МБ на файл, 4000 файлов.',
        );
      if (
        entry.name.split('/').includes('..') ||
        entry.name.startsWith('/') ||
        entry.name.includes('\\')
      )
        throw new Error('Недопустимый путь внутри архива.');
      return true;
    },
  });
}
