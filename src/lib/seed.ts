import { importBook } from '../engine/importer';
let initialization: Promise<void> | undefined;
export function initializeLibrary() {
  if (initialization) return initialization;
  initialization = (async () => {
    if (localStorage.getItem('book-samples-v1')) return;
    for (const name of ['white-nights', 'queen-of-spades', 'lady-with-dog']) {
      const response = await fetch(`/books/${name}.epub`);
      if (!response.ok) throw new Error('Не удалось загрузить стартовую библиотеку.');
      await importBook(
        new File([await response.blob()], `${name}.epub`, { type: 'application/epub+zip' }),
        true,
      );
    }
    localStorage.setItem('book-samples-v1', '1');
  })().catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}
