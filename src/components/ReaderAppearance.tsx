import { AlignJustify, AlignLeft, Check, Moon, Sun } from 'lucide-react';
import { usePreferences } from '../lib/settings';
import { Range, Toggle } from './Primitives';
import { readerColors } from '../engine/EpubEngine';
export function ReaderAppearance() {
  const { reader: s, setReader, resetReader } = usePreferences();
  return (
    <div className="appearance-controls">
      <div className="theme-options">
        {(
          [
            ['paper', 'Бумага'],
            ['sepia', 'Сепия'],
            ['night', 'Сумерки'],
            ['black', 'Ночь'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-label={label}
            className={s.theme === id ? 'selected' : ''}
            onClick={() => setReader({ theme: id })}
            aria-pressed={s.theme === id}
          >
            <span style={{ background: readerColors[id].background, color: readerColors[id].text }}>
              Aa{s.theme === id && <Check size={12} />}
            </span>
            <small>{label}</small>
          </button>
        ))}
      </div>
      <div className="brightness">
        <Sun size={16} />
        <input
          aria-label="Яркость страницы"
          type="range"
          min="35"
          max="100"
          value={s.brightness}
          onChange={(e) => setReader({ brightness: Number(e.target.value) })}
        />
        <Sun size={22} />
      </div>
      <p className="control-hint">
        Затемняет страницу. Яркость экрана меняется в Пункте управления iPhone.
      </p>
      <div className="control-separator" />
      <label className="select-row">
        <span>Шрифт</span>
        <select
          value={s.font}
          onChange={(e) => setReader({ font: e.target.value as typeof s.font })}
        >
          <option value="literary">Литературный · Georgia</option>
          <option value="classic">Классический · Palatino</option>
          <option value="system">Системный</option>
          <option value="mono">Моноширинный</option>
        </select>
      </label>
      <Range
        label="Размер текста"
        value={s.fontSize}
        min={14}
        max={36}
        unit=" px"
        onChange={(fontSize) => setReader({ fontSize })}
      />
      <Range
        label="Межстрочный интервал"
        value={s.lineHeight}
        min={1.2}
        max={2.4}
        step={0.05}
        onChange={(lineHeight) => setReader({ lineHeight })}
      />
      <Range
        label="Поля страницы"
        value={s.margins}
        min={8}
        max={48}
        unit=" px"
        onChange={(margins) => setReader({ margins })}
      />
      <Range
        label="Расстояние между буквами"
        value={s.letterSpacing}
        min={0}
        max={2}
        step={0.1}
        unit=" px"
        onChange={(letterSpacing) => setReader({ letterSpacing })}
      />
      <Range
        label="Отступ между абзацами"
        value={s.paragraphSpacing}
        min={0}
        max={1.6}
        step={0.1}
        unit=" em"
        onChange={(paragraphSpacing) => setReader({ paragraphSpacing })}
      />
      <div className="select-row">
        <span>Выравнивание</span>
        <div className="segmented">
          <button
            className={s.align === 'left' ? 'active' : ''}
            aria-label="По левому краю"
            aria-pressed={s.align === 'left'}
            onClick={() => setReader({ align: 'left' })}
          >
            <AlignLeft size={19} />
          </button>
          <button
            className={s.align === 'justify' ? 'active' : ''}
            aria-label="По ширине"
            aria-pressed={s.align === 'justify'}
            onClick={() => setReader({ align: 'justify' })}
          >
            <AlignJustify size={19} />
          </button>
        </div>
      </div>
      <div className="select-row">
        <span>Режим чтения</span>
        <div className="segmented">
          <button
            className={s.flow === 'paginated' ? 'active' : ''}
            onClick={() => setReader({ flow: 'paginated' })}
          >
            Страницы
          </button>
          <button
            className={s.flow === 'scrolled' ? 'active' : ''}
            onClick={() => setReader({ flow: 'scrolled' })}
          >
            Свиток
          </button>
        </div>
      </div>
      <Toggle label="Плотный текст" value={s.bold} onChange={() => setReader({ bold: !s.bold })} />
      <Toggle
        label="Не выключать экран"
        description="Если браузер поддерживает эту возможность"
        value={s.keepAwake}
        onChange={() => setReader({ keepAwake: !s.keepAwake })}
      />
      <button className="text-button reset-reader" onClick={resetReader}>
        <Moon size={15} />
        Сбросить настройки чтения
      </button>
    </div>
  );
}
