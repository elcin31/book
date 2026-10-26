import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  HardDrive,
  Info,
  LockKeyhole,
  Share,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { usePreferences } from '../lib/settings';
import { formatBytes } from '../lib/download';
import { Dialog } from './Primitives';
export function Settings({ notify }: { notify: (message: string) => void }) {
  const { appTheme, setAppTheme } = usePreferences();
  const [storage, setStorage] = useState<StorageEstimate>(),
    [persistent, setPersistent] = useState(false),
    [busy, setBusy] = useState(false),
    [install, setInstall] = useState(false),
    [about, setAbout] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void navigator.storage
      ?.estimate()
      .then(setStorage)
      .catch(() => {});
    void navigator.storage
      ?.persisted?.()
      .then(setPersistent)
      .catch(() => {});
  }, []);
  const exportLibrary = async () => {
    setBusy(true);
    try {
      const { exportBackup } = await import('../lib/backup');
      await exportBackup();
      notify('Резервная копия готова. Сохраните её в «Файлы».');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Не удалось создать копию.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ВАШЕ ПРОСТРАНСТВО ДЛЯ ЧТЕНИЯ</p>
          <h1>Настройки</h1>
        </div>
      </div>
      <div className="settings-layout">
        <div>
          <section className="panel settings-panel">
            <h2>Внешний вид</h2>
            <p className="muted">Настройки текста и страницы доступны внутри книги — Aa.</p>
            <div className="app-themes">
              {(
                [
                  ['light', 'Светлая'],
                  ['dark', 'Тёмная'],
                  ['auto', 'Системная'],
                ] as const
              ).map(([id, label]) => (
                <button
                  className={appTheme === id ? 'selected' : ''}
                  key={id}
                  onClick={() => setAppTheme(id)}
                >
                  <div className={`app-theme-preview preview-${id}`}>
                    <i />
                    <span />
                    <span />
                    {appTheme === id && <Check size={15} />}
                  </div>
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="panel settings-panel">
            <h2>
              <HardDrive size={21} />
              Книги и данные
            </h2>
            <div className="storage-info">
              <span>Занято в браузере</span>
              <strong>{storage?.usage ? formatBytes(storage.usage) : 'Подсчитываем…'}</strong>
            </div>
            <p className="control-hint">
              Книги хранятся в этом браузере. Очистка данных Safari или удаление PWA может удалить
              библиотеку. Резервная копия сохраняет книги, прогресс, коллекции и заметки.
            </p>
            <div className="action-list">
              <button disabled={busy} onClick={() => void exportLibrary()}>
                <ArrowDownToLine size={19} />
                {busy ? 'Обрабатываем данные…' : 'Сохранить резервную копию'}
                <ChevronRight size={16} />
              </button>
              <button disabled={busy} onClick={() => input.current?.click()}>
                <ArrowUpFromLine size={19} />
                Восстановить из копии
                <ChevronRight size={16} />
              </button>
              <button
                onClick={async () => {
                  try {
                    const granted = await navigator.storage?.persist?.();
                    setPersistent(Boolean(granted));
                    notify(
                      granted
                        ? 'Браузер предоставил постоянное хранилище'
                        : 'Браузер управляет хранением автоматически. Сохраните резервную копию.',
                    );
                  } catch {
                    notify('Браузер не поддерживает запрос постоянного хранилища.');
                  }
                }}
              >
                <ShieldCheck size={19} />
                {persistent ? 'Постоянное хранилище включено' : 'Защитить локальное хранилище'}
                {persistent ? <Check size={16} /> : <ChevronRight size={16} />}
              </button>
            </div>
            <input
              type="file"
              accept=".book"
              hidden
              ref={input}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy(true);
                try {
                  const { restoreBackup } = await import('../lib/backup');
                  const count = await restoreBackup(file);
                  notify(`Копия восстановлена. Добавлено книг: ${count}`);
                } catch (err) {
                  notify(err instanceof Error ? err.message : 'Не удалось восстановить копию.');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </section>
          <section className="panel settings-panel">
            <h2>Приложение</h2>
            <div className="action-list">
              <button onClick={() => setInstall(true)}>
                <Smartphone size={19} />
                Установить на iPhone
                <ChevronRight size={16} />
              </button>
              <button onClick={() => setAbout(true)}>
                <Info size={19} />О BOOK
                <ChevronRight size={16} />
              </button>
            </div>
          </section>
        </div>
        <aside className="privacy-card">
          <LockKeyhole size={29} strokeWidth={1.3} />
          <h2>
            Только вы
            <br />и ваши книги.
          </h2>
          <p>
            Без аккаунта, рекламы и отслеживания. Ваша библиотека, заметки и история чтения остаются
            на вашем устройстве.
          </p>
          <span>СДЕЛАНО ДЛЯ ТИХИХ МОМЕНТОВ</span>
        </aside>
      </div>
      {install && (
        <Dialog title="BOOK на вашем iPhone" onClose={() => setInstall(false)}>
          <div className="install-icon">
            <img src="/icons/icon-192.png" width="70" height="70" alt="Иконка BOOK" />
          </div>
          <p className="dialog-copy">
            Установите BOOK на экран «Домой» — для чтения в отдельном окне и быстрого доступа к
            библиотеке.
          </p>
          <ol className="install-steps">
            <li>
              <span>1</span>
              <div>
                Откройте BOOK в <strong>Safari</strong>.
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                Нажмите <Share size={18} /> <strong>«Поделиться»</strong>.
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                Выберите <strong>«На экран „Домой“»</strong> и нажмите «Добавить».
              </div>
            </li>
          </ol>
          <p className="control-hint">
            Перед первым чтением без интернета откройте приложение онлайн и дождитесь сообщения
            «Готово к чтению офлайн». На Android используйте пункт «Установить приложение» в меню
            браузера.
          </p>
        </Dialog>
      )}
      {about && (
        <Dialog title="BOOK 1.0.1" onClose={() => setAbout(false)}>
          <div className="about-brand">
            BOOK<span>ваша личная библиотека</span>
          </div>
          <p className="dialog-copy">
            Место для хороших историй. Импортируйте EPUB, FB2, FB2.ZIP и TXT до 50 МБ, читайте без
            интернета и сохраняйте то, что откликнулось.
          </p>
          <p className="dialog-copy">
            Встроенная классика — полные произведения Пушкина, Достоевского и Чехова из Викитеки.
            Авторские тексты в общественном достоянии; сведения об источниках и лицензии
            транскрипции указаны в конце каждой книги.
          </p>
          <p className="control-hint">
            Версия 1.0.1 · EPUB.js · React · IndexedDB
            <br />
            DRM, PDF, аудиокниги, синхронизация между устройствами и фиксированная вёрстка EPUB не
            входят в версию 1.0.
          </p>
        </Dialog>
      )}
    </>
  );
}
