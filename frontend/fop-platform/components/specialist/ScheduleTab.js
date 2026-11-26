'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, Card, Icon, Select, Skeleton, cx } from '@/components/ui';
import { WEEKDAYS, plural } from '@/lib/format';
import {
  DEFAULT_WINDOW,
  MAX_WINDOWS_PER_DAY,
  SLOT_OPTIONS,
  copyDay,
  countSlots,
  daysFromApi,
  daysToApi,
  sameSchedule,
  totalSlots,
  validateDays,
} from '@/lib/schedule';

const TIME_FIELD =
  'h-9 w-[124px] rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

/**
 * Керування розкладом: робочі вікна по днях тижня (київський час) і тривалість консультації.
 * Дані — GET/PUT /expert/schedule. Клієнти бачать слоти, які сервер генерує з цих вікон.
 */
export default function ScheduleTab({ onSaved }) {
  const [state, setState] = useState({ loading: true, error: '', saved: null });
  const [days, setDays] = useState(() => daysFromApi([]));
  const [slotMinutes, setSlotMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await api.getExpertSchedule();
      setDays(daysFromApi(data.windows));
      setSlotMinutes(data.slot_minutes);
      setState({ loading: false, error: '', saved: data });
    } catch (e) {
      setState({ loading: false, error: errorText(e), saved: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saved = state.saved;
  const savedDays = useMemo(() => (saved ? daysFromApi(saved.windows) : null), [saved]);
  const dirty = Boolean(saved) && (slotMinutes !== saved.slot_minutes || !sameSchedule(days, savedDays));
  const errors = useMemo(() => validateDays(days, slotMinutes), [days, slotMinutes]);
  const hasErrors = errors.some(Boolean);
  const total = totalSlots(days, slotMinutes);

  const touch = () => {
    setJustSaved(false);
    setSaveError('');
  };
  const updateDay = (i, fn) => {
    touch();
    setDays((cur) => cur.map((list, idx) => (idx === i ? fn(list) : list)));
  };

  async function save() {
    if (hasErrors || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const data = await api.saveExpertSchedule({ slotMinutes, windows: daysToApi(days) });
      setDays(daysFromApi(data.windows));
      setSlotMinutes(data.slot_minutes);
      setState({ loading: false, error: '', saved: data });
      setJustSaved(true);
      onSaved?.();
    } catch (e) {
      setSaveError(errorText(e)); // справжня відповідь сервера, напр. про майбутні записи
    } finally {
      setSaving(false);
    }
  }

  if (state.loading && !saved) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (state.error && !saved) {
    return (
      <Alert action={<button type="button" onClick={load} className="shrink-0 text-xs font-medium underline">Спробувати ще раз</button>}>
        {state.error}
      </Alert>
    );
  }

  const outside = saved?.outside_schedule_bookings || 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Розклад</h1>
        <p className="mt-1 text-sm text-slate-500">
          Вкажіть, коли ви приймаєте клієнтів. З цих вікон формуються вільні слоти для запису. Час — київський (Europe/Kyiv).
        </p>
      </div>

      {outside > 0 && (
        <Alert tone="amber">
          {plural(outside, 'майбутній запис не збігається', 'майбутні записи не збігаються', 'майбутніх записів не збігаються')} зі слотами
          поточного розкладу. Вони лишаються в силі, але на цей час нові клієнти записатися не зможуть.
        </Alert>
      )}
      {total === 0 && (
        <Alert tone="amber">Немає жодного робочого вікна — клієнти не бачитимуть вільних слотів і не зможуть записатися.</Alert>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <label htmlFor="slot-minutes" className="mb-1.5 block text-xs font-medium text-slate-700">Тривалість однієї консультації</label>
            <Select id="slot-minutes" className="w-44" value={slotMinutes} onChange={(e) => { touch(); setSlotMinutes(Number(e.target.value)); }}>
              {SLOT_OPTIONS.map((m) => <option key={m} value={m}>{m} хвилин</option>)}
              {!SLOT_OPTIONS.includes(slotMinutes) && <option value={slotMinutes}>{slotMinutes} хвилин</option>}
            </Select>
          </div>
          <p className="text-sm text-slate-600">
            Усього за тиждень: <b className="text-slate-900">{plural(total, 'слот', 'слоти', 'слотів')}</b>
          </p>
        </div>

        <ul className="divide-y divide-slate-100">
          {WEEKDAYS.map((day, i) => {
            const list = days[i];
            const on = list.length > 0;
            const error = errors[i];
            return (
              <li key={day.full} className="grid gap-3 py-4 sm:grid-cols-[150px_1fr]">
                <div className="flex items-center gap-3 sm:items-start">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${day.full}: ${on ? 'працюю' : 'вихідний'}`}
                    onClick={() => updateDay(i, (l) => (l.length ? [] : [{ ...DEFAULT_WINDOW }]))}
                    className={cx(
                      'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300',
                      on ? 'bg-blue-600' : 'bg-slate-300',
                    )}
                  >
                    <span className={cx('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on && 'translate-x-5')} />
                  </button>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{day.full}</p>
                    <p className="text-xs text-slate-500">{on ? plural(countSlots(list, slotMinutes), 'слот', 'слоти', 'слотів') : 'Вихідний'}</p>
                  </div>
                </div>

                <div>
                  {on && (
                    <ul className="space-y-2">
                      {list.map((w, wi) => (
                        <li key={wi} className="flex flex-wrap items-center gap-2">
                          <input
                            type="time"
                            step={300}
                            aria-label={`${day.full}, початок вікна ${wi + 1}`}
                            className={TIME_FIELD}
                            value={w.start}
                            onChange={(e) => updateDay(i, (l) => l.map((x, xi) => (xi === wi ? { ...x, start: e.target.value } : x)))}
                          />
                          <span className="text-slate-400">—</span>
                          <input
                            type="time"
                            step={300}
                            aria-label={`${day.full}, кінець вікна ${wi + 1}`}
                            className={TIME_FIELD}
                            value={w.end}
                            onChange={(e) => updateDay(i, (l) => l.map((x, xi) => (xi === wi ? { ...x, end: e.target.value } : x)))}
                          />
                          <button
                            type="button"
                            onClick={() => updateDay(i, (l) => l.filter((_, xi) => xi !== wi))}
                            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                            aria-label={`Видалити вікно ${wi + 1} (${day.full})`}
                          >
                            <Icon name="trash" className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {on && list.length < MAX_WINDOWS_PER_DAY && (
                    <button
                      type="button"
                      onClick={() =>
                        updateDay(i, (l) => {
                          const last = l[l.length - 1];
                          // Нове вікно — після останнього (години 14:00–18:00 за замовчуванням, якщо місця немає)
                          return [...l, last && last.end < '17:00' ? { start: last.end, end: '18:00' } : { start: '14:00', end: '18:00' }];
                        })
                      }
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                    >
                      <Icon name="plus" className="h-3.5 w-3.5" /> Додати вікно
                    </button>
                  )}
                  {on && i === 0 && (
                    <button
                      type="button"
                      onClick={() => { touch(); setDays((cur) => copyDay(cur, 0, [1, 2, 3, 4])); }}
                      className="ml-4 mt-2 inline-flex items-center text-xs font-medium text-slate-500 hover:text-blue-700 hover:underline"
                    >
                      Скопіювати на Вт–Пт
                    </button>
                  )}
                  {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
                  {!on && <p className="text-sm text-slate-400">Не приймаю клієнтів. Увімкніть перемикач, щоб додати години.</p>}
                </div>
              </li>
            );
          })}
        </ul>

        {saveError && <Alert className="mt-2">{saveError}</Alert>}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <Button variant="primary" loading={saving} disabled={!dirty || hasErrors} onClick={save}>Зберегти розклад</Button>
          <Button
            variant="ghost"
            disabled={!dirty || saving}
            onClick={() => { touch(); setDays(daysFromApi(saved.windows)); setSlotMinutes(saved.slot_minutes); }}
          >
            Скасувати зміни
          </Button>
          {justSaved && !dirty && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
              <Icon name="check" className="h-4 w-4" /> Розклад збережено
            </span>
          )}
          {dirty && hasErrors && <span className="text-xs text-red-600">Виправте помилки, щоб зберегти</span>}
          {dirty && !hasErrors && !saving && <span className="text-xs text-amber-600">Є незбережені зміни</span>}
        </div>
      </Card>

      <p className="text-xs leading-5 text-slate-500">
        Вже створені записи не скасовуються при зміні розкладу. Тривалість консультації можна змінити, коли немає майбутніх записів.
      </p>
    </div>
  );
}
