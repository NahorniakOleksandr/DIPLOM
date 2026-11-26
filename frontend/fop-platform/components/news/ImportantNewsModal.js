'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Badge, Button, Icon, Modal } from '@/components/ui';
import { formatDueDate, kyivDate } from '@/lib/format';
import { CATEGORY_TONE, bylineOf } from '@/components/news/newsMeta';

const POLL_MS = 90000;

/**
 * Спливаюче вікно з важливими повідомленнями про зміни в законах.
 * «Прочитано» зберігається на сервері — вікно більше не з'явиться. «Нагадати пізніше» ховає лише до перезавантаження
 * сторінки, тож неприбране повідомлення спливе знову під час наступного входу.
 */
export default function ImportantNewsModal({ onChanged }) {
  const [items, setItems] = useState([]);
  const [later, setLater] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await api.getNewsPopup());
    } catch {
      /* вікно допоміжне: якщо запит не вдався, новини все одно видно у вкладці «Новини» з бейджем */
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => !document.hidden && load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const queue = useMemo(() => items.filter((i) => !later.has(i.id)), [items, later]);
  const current = queue[0];

  async function acknowledge() {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      const counts = await api.markNewsRead(current.id);
      setItems((list) => list.filter((i) => i.id !== current.id));
      await onChanged?.(counts);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function remindLater() {
    if (!current) return;
    setError('');
    setLater((s) => new Set(s).add(current.id));
  }

  if (!current) return null;

  return (
    <Modal
      open
      size="lg"
      onClose={remindLater}
      title={current.title}
      subtitle={`${bylineOf(current)} · ${kyivDate(current.published_at)}`}
      footer={
        <>
          {queue.length > 1 && <span className="mr-auto text-xs text-slate-500">Ще важливих: {queue.length - 1}</span>}
          <Button variant="secondary" onClick={remindLater} disabled={busy}>Нагадати пізніше</Button>
          <Button variant="primary" onClick={acknowledge} loading={busy}>
            <Icon name="check" className="h-4 w-4" /> Прочитано
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="amber"><Icon name="alert" className="mr-1 h-3 w-3" /> Важливо</Badge>
          <Badge tone={CATEGORY_TONE[current.category] || 'slate'}>{current.category_label}</Badge>
          {current.effective_date && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              <Icon name="calendar" className="h-3.5 w-3.5" /> Набирає чинності: {formatDueDate(current.effective_date)}
            </span>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
        <p className="max-h-[50vh] overflow-y-auto whitespace-pre-line break-words text-sm leading-6 text-slate-800">{current.body}</p>
        {current.source_url && (
          <a
            href={current.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-blue-700 hover:underline"
          >
            <Icon name="external" className="h-3.5 w-3.5" /> Джерело
          </a>
        )}
        <p className="text-[11px] text-slate-400">
          Матеріал підготував спеціаліст платформи; це не офіційний документ і не заміна консультації.
        </p>
      </div>
    </Modal>
  );
}
