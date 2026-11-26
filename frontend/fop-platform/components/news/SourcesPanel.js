'use client';

import { useCallback, useEffect, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, Card, Icon, Skeleton } from '@/components/ui';
import { kyivDateTime } from '@/lib/format';

/**
 * Стан офіційних стрічок для спеціаліста: коли оновлювалась кожна й чи була помилка.
 * Помилки не ховаються: якщо стрічка не відповідає, це видно тут, а не «тиха» порожнеча.
 */
export default function SourcesPanel({ onSynced }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loading: false, loaded: false, error: '', sources: [] });
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState({ tone: 'green', text: '' });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const sources = await api.getNewsSources();
      setState({ loading: false, loaded: true, error: '', sources });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, loaded: true, error: errorText(e) }));
    }
  }, []);

  useEffect(() => {
    if (open && !state.loaded) load();
  }, [open, state.loaded, load]);

  async function sync() {
    setSyncing(true);
    setMessage({ tone: 'green', text: '' });
    try {
      const result = await api.syncNews();
      if (!result.configured) {
        setMessage({ tone: 'amber', text: 'Стрічки не налаштовано: додайте NEWS_FEEDS у backend/.env.' });
      } else {
        const failed = result.sources.filter((s) => !s.ok);
        setMessage({
          tone: failed.length ? 'amber' : 'green',
          text: failed.length
            ? `Додано нових: ${result.added_total}. Не відповіли стрічок: ${failed.length} (деталі нижче).`
            : `Готово. Додано нових новин: ${result.added_total}.`,
        });
      }
      await load();
      await onSynced?.();
    } catch (e) {
      setMessage({ tone: 'red', text: errorText(e) });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-slate-900">Офіційні джерела</span>
          <span className="block text-xs text-slate-500">Звідки автоматично підтягуються новини про зміни в законах</span>
        </span>
        <Icon name="chevronDown" className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-100 px-5 py-4">
          {state.loading && !state.loaded && <Skeleton className="h-16" />}
          {state.error && <Alert>{state.error}</Alert>}

          {state.loaded && !state.error && state.sources.length === 0 && (
            <p className="text-[13px] leading-5 text-slate-600">
              Автоматичні джерела не налаштовано. Додайте у <code className="rounded bg-slate-100 px-1">backend/.env</code> рядок{' '}
              <code className="rounded bg-slate-100 px-1">NEWS_FEEDS=Назва|https://адреса-RSS-стрічки</code> і перезапустіть
              сервер. Статті спеціалістів працюють і без цього.
            </p>
          )}

          {state.sources.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {state.sources.map((s) => (
                <li key={s.url} className="py-2.5">
                  <p className="text-[13px] font-medium text-slate-900">
                    {s.name}
                    {!s.filtered && <span className="ml-2 text-[11px] font-normal text-slate-400">без відбору за темою</span>}
                  </p>
                  <p className="truncate text-[11px] text-slate-400" title={s.url}>{s.url}</p>
                  {s.last_error ? (
                    <p className="mt-1 text-xs text-red-600">Помилка: {s.last_error}</p>
                  ) : s.last_success_at ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Оновлено {kyivDateTime(s.last_success_at)} · у стрічці {s.last_fetched}, нових {s.last_added}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Ще не оновлювалась</p>
                  )}
                  {s.last_error && s.last_success_at && (
                    <p className="text-[11px] text-slate-400">Остання успішна: {kyivDateTime(s.last_success_at)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {message.text && <Alert tone={message.tone}>{message.text}</Alert>}

          {state.sources.length > 0 && (
            <Button size="sm" variant="secondary" loading={syncing} onClick={sync}>
              Оновити зараз
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
