import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, CalendarDays, Flame, Timer } from 'lucide-react';
import { db, localDate } from '../lib/db';
import { usePreferences } from '../lib/settings';
import type { BookRecord } from '../types';
export function ReadingStats({ books }: { books: BookRecord[] }) {
  const days = useLiveQuery(() => db.days.toArray()) ?? [];
  const { goal, setGoal } = usePreferences();
  const today = days.find((d) => d.date === localDate());
  const todayMinutes = Math.floor((today?.seconds ?? 0) / 60);
  const totalMinutes = Math.floor(days.reduce((s, d) => s + d.seconds, 0) / 60);
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return {
      key,
      label: date.toLocaleDateString('ru', { weekday: 'short' }),
      minutes: (days.find((d) => d.date === key)?.seconds ?? 0) / 60,
    };
  });
  const maximum = Math.max(goal, ...week.map((d) => d.minutes));
  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if ((days.find((day) => day.date === key)?.seconds ?? 0) >= 60) streak++;
    else if (i > 0 || todayMinutes > 0) break;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">МАЛЕНЬКИЕ ПРИВЫЧКИ. БОЛЬШИЕ МИРЫ.</p>
          <h1>Время читать</h1>
        </div>
      </div>
      <section className="goal-card">
        <div
          className="goal-circle"
          style={{
            background: `conic-gradient(var(--green) ${Math.min(100, (todayMinutes / goal) * 100)}%,var(--border) 0)`,
          }}
        >
          <div>
            <strong>{todayMinutes}</strong>
            <span>из {goal} минут</span>
          </div>
        </div>
        <div>
          <span className="eyebrow">ВАША ЦЕЛЬ НА СЕГОДНЯ</span>
          <h2>{todayMinutes >= goal ? 'Хорошая глава вашего дня.' : 'Всего несколько страниц.'}</h2>
          <p>
            {todayMinutes >= goal
              ? 'Цель достигнута. Пусть у хорошей истории будет продолжение.'
              : 'Найдите немного времени для истории, которая останется с вами.'}
          </p>
          <label className="goal-select">
            Ежедневная цель{' '}
            <select value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
              {[5, 10, 15, 20, 30, 45, 60].map((n) => (
                <option key={n} value={n}>
                  {n} минут
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <div className="stats-grid">
        {[
          [<Timer size={21} />, totalMinutes, 'минут с книгой'],
          [
            <BookOpen size={21} />,
            books.filter((b) => b.status === 'finished').length,
            'книг прочитано',
          ],
          [<Flame size={21} />, streak, 'дней подряд'],
          [<CalendarDays size={21} />, days.filter((d) => d.seconds >= 60).length, 'дней чтения'],
        ].map(([icon, value, label], i) => (
          <div className="stat-card" key={i}>
            {icon}
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className="panel week-panel">
        <div className="section-title">
          <h2>Ваша неделя</h2>
          <span className="muted">Минуты чтения</span>
        </div>
        <div className="week-chart">
          {week.map((day) => (
            <div className={`week-day ${day.key === localDate() ? 'today' : ''}`} key={day.key}>
              <div className="bar-space">
                <span>{Math.floor(day.minutes)}</span>
                <div
                  className="week-bar"
                  style={{ height: `${Math.max(3, (day.minutes / maximum) * 130)}px` }}
                  title={`${day.label}: ${Math.floor(day.minutes)} мин`}
                />
              </div>
              <small>{day.label}</small>
            </div>
          ))}
        </div>
        <p className="control-hint">
          Учитывается время открытого чтения. Пауза после двух минут без действий, при открытии
          панелей и уходе приложения в фон.
        </p>
      </section>
    </>
  );
}
