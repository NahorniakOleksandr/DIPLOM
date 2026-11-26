'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Avatar, Badge, Button, Card, EmptyState, Icon, Input, Skeleton, cx } from '@/components/ui';
import { SPECIALIZATION_LABEL, money } from '@/lib/format';
import ConsultationCard from './ConsultationCard';

const FILTERS = [
  { id: null, label: 'Усі' },
  { id: 'accountant', label: 'Бухгалтери' },
  { id: 'lawyer', label: 'Юристи' },
];
const BOOKING_GROUPS = [
  { id: 'all', label: 'Усі', match: () => true },
  { id: 'active', label: 'Активні', match: (s) => ['pending', 'confirmed', 'paid'].includes(s) },
  { id: 'done', label: 'Завершені', match: (s) => s === 'completed' },
  { id: 'other', label: 'Інші', match: (s) => ['rejected', 'cancelled'].includes(s) },
];

function ExpertCard({ expert, onBook }) {
  const services = [...(expert.services || [])].sort((a, b) => Number(a.price) - Number(b.price));
  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <Avatar name={expert.full_name} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900">{expert.full_name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {expert.specialization ? <Badge tone="blue">{SPECIALIZATION_LABEL[expert.specialization]}</Badge> : <Badge>Фахівець</Badge>}
          </div>
        </div>
      </div>
      {expert.headline && <p className="mt-3 text-[13px] font-medium text-slate-800">{expert.headline}</p>}
      {expert.bio && <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-500">{expert.bio}</p>}

      <ul className="mt-3 space-y-1.5">
        {services.slice(0, 3).map((s) => (
          <li key={s.id} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-slate-600">{s.title.replace(/^Консультація (бухгалтера|юриста):\s*/i, '')}</span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">{money(s.price)} грн</span>
          </li>
        ))}
        {services.length > 3 && <li className="text-[11px] text-slate-400">і ще {services.length - 3}…</li>}
      </ul>

      <Button variant="primary" size="md" className="mt-4 w-full" onClick={() => onBook(expert)}>
        Записатися <Icon name="arrowRight" className="h-3.5 w-3.5" />
      </Button>
    </article>
  );
}

export default function Catalog({ specialization, onSpecialization, consultations, onBook, onChat, onReloadConsultations }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ loading: true, items: [], error: '' });
  const [group, setGroup] = useState('all');
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const items = await api.listExperts({ specialization: specialization || undefined, q: q.trim().length >= 2 ? q.trim() : undefined });
      if (id === requestId.current) setState({ loading: false, items, error: '' });
    } catch (e) {
      if (id === requestId.current) setState({ loading: false, items: [], error: errorText(e) });
    }
  }, [specialization, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const list = (consultations.items || []).filter((c) => BOOKING_GROUPS.find((g) => g.id === group).match(c.status));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
      <div>
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Каталог фахівців</h2>
              <p className="text-xs text-slate-500">Бухгалтери та юристи платформи. Оберіть фахівця й вільний час.</p>
            </div>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              {FILTERS.map((f) => (
                <button
                  key={String(f.id)}
                  type="button"
                  onClick={() => onSpecialization(f.id)}
                  className={cx('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', specialization === f.id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <Input className="mt-4" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук за іменем або темою (від 2 літер)…" aria-label="Пошук фахівця" />
        </Card>

        <div className="mt-4">
          {state.error && <Alert action={<button onClick={load} className="shrink-0 text-xs font-medium underline">Повторити</button>}>{state.error}</Alert>}
          {state.loading && (
            <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-60" />)}</div>
          )}
          {!state.loading && !state.error && state.items.length === 0 && (
            <EmptyState title="Фахівців не знайдено">Змініть фільтр або пошуковий запит.</EmptyState>
          )}
          {!state.loading && state.items.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {state.items.map((ex) => <ExpertCard key={ex.id} expert={ex} onBook={onBook} />)}
            </div>
          )}
        </div>
      </div>

      <Card className="h-fit p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Ваші записи</h2>
          <div className="flex gap-1">
            {BOOKING_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={cx('rounded-md px-2 py-1 text-[11px] font-medium', group === g.id ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50')}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {consultations.error && <Alert action={<button onClick={onReloadConsultations} className="shrink-0 text-xs font-medium underline">Повторити</button>}>{consultations.error}</Alert>}
          {consultations.loading && !consultations.items && <Skeleton className="h-28" />}
          {consultations.items && list.length === 0 && (
            <EmptyState title={consultations.items.length === 0 ? 'Записів поки немає' : 'Немає записів у цій категорії'}>
              {consultations.items.length === 0 && 'Оберіть фахівця зліва й запишіться на консультацію.'}
            </EmptyState>
          )}
          {list.map((item) => (
            <ConsultationCard key={item.id} item={item} onChat={onChat} onChanged={onReloadConsultations} />
          ))}
        </div>
      </Card>
    </div>
  );
}
