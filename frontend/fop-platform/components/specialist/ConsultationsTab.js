'use client';

import { useMemo, useState } from 'react';
import { Alert, EmptyState, Skeleton, cx } from '@/components/ui';
import ConsultationRow from '@/components/specialist/ConsultationRow';
import Timeline from '@/components/specialist/Timeline';

const HISTORY_FILTERS = [
  { id: 'all', label: 'Усі' },
  { id: 'completed', label: 'Проведені' },
  { id: 'rejected', label: 'Відхилені' },
  { id: 'cancelled', label: 'Скасовані клієнтом' },
];

function Segment({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            'rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors',
            value === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
          {o.count > 0 && <span className="ml-1.5 text-xs text-slate-400">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Майбутні консультації (таймлайн за днями) та архів із фільтром за статусом. */
export default function ConsultationsTab({ upcoming, history, error, onReload, actions, onOpen, onChat, historyLimit }) {
  const [view, setView] = useState('upcoming');
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(
    () => (history || []).filter((h) => filter === 'all' || h.status === filter),
    [history, filter],
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Консультації</h1>
        <p className="mt-1 text-sm text-slate-500">Розклад зустрічей і архів проведених консультацій.</p>
      </div>

      <Segment
        value={view}
        onChange={setView}
        options={[
          { id: 'upcoming', label: 'Майбутні', count: upcoming?.length || 0 },
          { id: 'history', label: 'Архів', count: history?.length || 0 },
        ]}
      />

      {error && (
        <Alert action={<button type="button" onClick={onReload} className="shrink-0 text-xs font-medium underline">Спробувати ще раз</button>}>
          {error}
        </Alert>
      )}

      {view === 'upcoming' && (
        <>
          {!upcoming && !error && <Skeleton className="h-40" />}
          {upcoming && (
            <Timeline
              items={upcoming}
              onOpen={onOpen}
              onComplete={actions.complete}
              emptyTitle="Підтверджених консультацій немає"
              emptyText="Підтверджені заявки з’являтимуться тут за днями."
            />
          )}
        </>
      )}

      {view === 'history' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {HISTORY_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cx(
                  'rounded-full border px-3 py-1 text-xs font-medium',
                  filter === f.id ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {!history && !error && <Skeleton className="h-40" />}
          {history && filtered.length === 0 && (
            <EmptyState title="Тут поки порожньо">
              {filter === 'all' ? 'Проведені, відхилені й скасовані консультації зберігаються тут.' : 'За цим фільтром записів немає.'}
            </EmptyState>
          )}
          {filtered.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {filtered.map((item) => (
                <ConsultationRow key={item.id} item={item} actions={actions} onOpen={onOpen} onChat={onChat} />
              ))}
            </div>
          )}
          {history && history.length >= historyLimit && (
            <p className="text-center text-xs text-slate-400">Показано останні {historyLimit} записів.</p>
          )}
        </>
      )}
    </div>
  );
}
