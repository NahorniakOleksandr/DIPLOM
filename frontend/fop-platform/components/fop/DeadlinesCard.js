'use client';

import { useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, Card, Icon, Skeleton, TONE_TEXT, TONE_TILE, cx } from '@/components/ui';
import { DEADLINE_STATUS, daysLabel, dayNumber, formatDueDate, monthShort } from '@/lib/format';

export default function DeadlinesCard({ dashboard, error, onReload, onOpenProfile, onAskSpecialist }) {
  const [busyKey, setBusyKey] = useState(null);
  const [actionError, setActionError] = useState('');

  async function toggle(item) {
    setBusyKey(item.key);
    setActionError('');
    try {
      await api.setDeadlineDone(item.key, !item.done);
      await onReload();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusyKey(null);
    }
  }

  const items = dashboard?.deadlines || [];
  const hasGroup = dashboard?.limit?.group;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Найближчі податкові дедлайни</h2>
        <Icon name="calendar" className="h-4 w-4 text-slate-400" />
      </div>

      {error && (
        <Alert className="mt-4" action={<button onClick={onReload} className="shrink-0 text-xs font-medium underline">Повторити</button>}>
          {error}
        </Alert>
      )}
      {actionError && <Alert className="mt-3">{actionError}</Alert>}

      {!dashboard && !error && (
        <div className="mt-4 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)}</div>
      )}

      {dashboard && !hasGroup && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
          <p className="text-sm text-slate-700">Строки залежать від групи єдиного податку.</p>
          <Button variant="primary" size="sm" className="mt-3" onClick={onOpenProfile}>
            Вказати групу <Icon name="arrowRight" className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {dashboard && hasGroup && items.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">Найближчих строків немає — усе позначено виконаним.</p>
      )}

      {items.length > 0 && (
        <ul className="mt-4 space-y-3.5">
          {items.map((item) => {
            const meta = DEADLINE_STATUS[item.status];
            const dated = Boolean(item.due_date);
            return (
              <li key={item.key} className="flex items-start gap-3">
                <div className={cx('flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border leading-none', TONE_TILE[meta.tone === 'green' && item.status === 'planned' ? 'blue' : meta.tone])}>
                  <span className="text-[15px] font-bold">{dated ? dayNumber(item.due_date) : item.badge}</span>
                  <span className="mt-0.5 text-[9px] font-medium opacity-80">{dated ? monthShort(item.due_date) : 'строки'}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-5 text-slate-900">
                    {item.title}
                    {dated && <span className="font-normal text-slate-600"> — до {formatDueDate(item.due_date)}</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    <span className={cx('font-medium', TONE_TEXT[meta.tone])}>{meta.label}</span>
                    {item.period && <span> · {item.period}</span>}
                    {dated && item.days_left >= 0 && item.status !== 'done' && <span> · {item.days_left === 0 ? 'сьогодні' : `ще ${daysLabel(item.days_left)}`}</span>}
                    {item.status === 'overdue' && <span> · {daysLabel(item.days_left)} тому</span>}
                  </p>
                  {item.status === 'overdue' && (
                    <p className="mt-0.5 text-[11px] text-slate-400">Якщо вже сплатили — позначте виконаним.</p>
                  )}
                  {item.advice && item.status !== 'planned' && (
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">
                      {item.advice}{' '}
                      {item.suggest_specialist && (
                        <button type="button" onClick={() => onAskSpecialist('accountant')} className="font-medium text-blue-600 hover:underline">
                          Знайти фахівця
                        </button>
                      )}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => toggle(item)}
                  disabled={busyKey === item.key}
                  title={item.done ? 'Зняти позначку' : 'Позначити виконаним'}
                  aria-label={item.done ? 'Зняти позначку виконання' : 'Позначити виконаним'}
                  className={cx(
                    'mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-50',
                    item.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-transparent hover:border-emerald-400 hover:text-emerald-500',
                  )}
                >
                  <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {dashboard && hasGroup && (
        <p className="mt-4 text-[11px] leading-4 text-slate-400">
          Строки-орієнтири для вашої групи. Вихідні враховано, державні свята — ні.
        </p>
      )}
    </Card>
  );
}
