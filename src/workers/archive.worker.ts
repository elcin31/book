import { unpackBoundedZip } from '../engine/boundedZip';
self.onmessage = (event: MessageEvent<{ data: ArrayBuffer; profile?: 'book' | 'backup' }>) => {
  try {
    const files = unpackBoundedZip(
      new Uint8Array(event.data.data),
      event.data.profile === 'backup' ? 'backup' : 'book',
    );
    self.postMessage({ files }, { transfer: Object.values(files).map((file) => file.buffer) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Не удалось прочитать архив.',
    });
  }
};
