export function unpack(
  data: ArrayBuffer,
  profile: 'book' | 'backup' = 'book',
): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/archive.worker.ts', import.meta.url), {
      type: 'module',
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Распаковка заняла слишком много времени.'));
    }, 30000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.files);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error('Ошибка чтения архива.'));
    };
    worker.postMessage({ data, profile }, [data]);
  });
}
