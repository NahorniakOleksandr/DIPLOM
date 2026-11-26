'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { errorText } from '@/lib/api';
import ChatThread from '@/components/ChatThread';
import { Alert, Avatar, Card, EmptyState, Icon, Skeleton, cx } from '@/components/ui';
import { groupLabel, kyivDate } from '@/lib/format';

const POLL_MS = 30000;

function subline(client) {
  if (client.next_slot_datetime) return `Найближча консультація: ${kyivDate(client.next_slot_datetime)}`;
  if (client.last_slot_datetime) return `Остання консультація: ${kyivDate(client.last_slot_datetime)}`;
  return 'Написав(ла) у чат';
}

/** Чат із клієнтами: список (GET /expert/clients) і переписка (спільний ChatThread → /chat/*). */
export default function ChatTab({ meId, initialPeer }) {
  const [state, setState] = useState({ loading: true, error: '', clients: [] });
  const [selected, setSelected] = useState(initialPeer || null); // { id, name }

  const load = useCallback(async (silent) => {
    try {
      const clients = await api.listExpertClients();
      setState({ loading: false, error: '', clients });
    } catch (e) {
      setState((s) => ({ loading: false, error: silent ? s.error : errorText(e), clients: s.clients }));
    }
  }, []);

  useEffect(() => {
    load(false);
    const timer = setInterval(() => !document.hidden && load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (initialPeer) setSelected(initialPeer);
  }, [initialPeer]);

  const { loading, error, clients } = state;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Чат із клієнтами</h1>
        <p className="mt-1 text-sm text-slate-500">Листування з клієнтами, які записувалися до вас або писали вам.</p>
      </div>

      {error && <Alert>{error}</Alert>}

      {loading && <Skeleton className="h-96" />}

      {!loading && clients.length === 0 && !selected && (
        <EmptyState title="Клієнтів поки немає">Чат стане доступним після першої заявки від клієнта.</EmptyState>
      )}

      {!loading && (clients.length > 0 || selected) && (
        <Card className="grid h-[calc(100vh-250px)] min-h-[440px] overflow-hidden md:grid-cols-[300px_1fr]">
          <aside className={cx('min-h-0 overflow-y-auto border-slate-200 md:block md:border-r', selected && 'hidden md:block')}>
            <ul>
              {selected && !clients.some((c) => c.id === selected.id) && (
                <li>
                  <ClientButton name={selected.name} sub="Нова розмова" active onClick={() => {}} />
                </li>
              )}
              {clients.map((c) => (
                <li key={c.id}>
                  <ClientButton
                    name={c.full_name}
                    sub={subline(c)}
                    badge={c.tax_group ? groupLabel(c.tax_group) : ''}
                    active={selected?.id === c.id}
                    onClick={() => setSelected({ id: c.id, name: c.full_name })}
                  />
                </li>
              ))}
            </ul>
          </aside>

          <div className={cx('min-h-0 flex-col p-4', selected ? 'flex' : 'hidden md:flex')}>
            {selected ? (
              <>
                <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-3">
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
                    aria-label="До списку клієнтів"
                  >
                    <Icon name="chevronRight" className="h-4 w-4 rotate-180" />
                  </button>
                  <Avatar name={selected.name} className="h-8 w-8 text-xs" />
                  <p className="text-sm font-semibold text-slate-900">{selected.name}</p>
                </div>
                <ChatThread peer={selected} meId={meId} className="min-h-0 flex-1" emptyText="Повідомлень поки немає. Напишіть клієнту першим." />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Оберіть клієнта зі списку</div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function ClientButton({ name, sub, badge, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors',
        active ? 'bg-blue-50' : 'hover:bg-slate-50',
      )}
    >
      <Avatar name={name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-slate-900">{name}</span>
        <span className="block truncate text-xs text-slate-500">{sub}</span>
      </span>
      {badge && <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{badge}</span>}
    </button>
  );
}
