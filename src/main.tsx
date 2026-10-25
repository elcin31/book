import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <img src="/icons/icon-192.png" width="70" height="70" alt="BOOK" />
        <h1>Вернёмся к вашей истории</h1>
        <p>
          Не удалось открыть локальную библиотеку. Проверьте, разрешено ли браузеру хранить данные и
          достаточно ли свободного места.
        </p>
        <button className="primary-button" onClick={() => location.reload()}>
          Открыть заново
        </button>
        <small>Не очищайте данные браузера: они содержат ваши книги.</small>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
