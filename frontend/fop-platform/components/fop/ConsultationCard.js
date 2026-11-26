'use client';

import { useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Badge, Button, Icon, Spinner } from '@/components/ui';
import { BOOKING_STATUS, SPECIALIZATION_LABEL, formatDateTime, formatTime, money } from '@/lib/format';

const CHAT_STATUSES = ['pending', 'confirmed', 'paid', 'completed'];
const CANCELLABLE = ['pending', 'confirmed', 'paid'];

export default function ConsultationCard({ item, onChat, onChanged }) {
  const meta = BOOKING_STATUS[item.status] || { label: item.status, tone: 'slate' };
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ctxOpen, setCtxOpen] = useState(false);
  const [ctx, setCtx] = useState({ loading: false, text: '', error: '' });

  async function cancel() {
    setBusy(true);
    setError('');
    try {
      await api.cancelBooking(item.id);
      setConfirming(false);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleContext() {
    const next = !ctxOpen;
    setCtxOpen(next);
    if (next && !ctx.text && !ctx.loading) {
      setCtx({ loading: true, text: '', error: '' });
      try {
        const data = await api.getBookingContext(item.id);
        setCtx({ loading: false, text: data.ai_summary || '', error: '' });
      } catch (e) {
        setCtx({ loading: false, text: '', error: errorText(e) });
      }
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold leading-5 text-slate-900">{item.service_title}</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            {item.expert_name}
            {item.expert_specialization && ` · ${SPECIALIZATION_LABEL[item.expert_specialization]}`} · {money(item.service_price)} грн
          </p>
        </div>
        <Badge tone={meta.tone} className="shrink-0">{meta.label}</Badge>
      </div>

      <p className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-slate-700">
        <Icon name="calendar" className="h-3.5 w-3.5 text-slate-400" />
        {formatDateTime(item.slot_datetime)} – {formatTime(item.slot_end)}
      </p>

      {item.status === 'pending' && <p className="mt-2 text-xs text-slate-500">Фахівець ще не підтвердив запис. Статус оновиться тут одразу після його рішення.</p>}
      {item.status === 'rejected' && (
        <p className="mt-2 text-xs text-red-600">Фахівець відхилив запис{item.rejection_reason ? `: ${item.rejection_reason}` : '.'} Оберіть інший час.</p>
      )}
      {(item.status === 'confirmed' || item.status === 'paid') &&
        (item.meeting_url ? (
          <a href={item.meeting_url} target="_blank" rel="noopener noreferrer" className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700">
            <Icon name="video" className="h-3.5 w-3.5" /> Посилання на зустріч
          </a>
        ) : (
          <p className="mt-2 text-xs text-slate-500">Посилання на зустріч фахівець ще не додав — напишіть йому в чаті.</p>
        ))}
      {item.status === 'completed' && item.expert_summary && (
        <div className="mt-2.5 rounded-lg bg-emerald-50/70 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Підсумок від фахівця</p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700">{item.expert_summary}</p>
        </div>
      )}

      {item.has_ai_summary && (
        <div className="mt-2.5">
          <button type="button" onClick={toggleContext} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
            <Icon name="sparkle" className="h-3.5 w-3.5" /> Контекст від ШІ, переданий фахівцю
            <Icon name="chevronDown" className={`h-3 w-3 transition-transform ${ctxOpen ? 'rotate-180' : ''}`} />
          </button>
          {ctxOpen && (
            <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">
              {ctx.loading && <Spinner className="h-3.5 w-3.5" />}
              {ctx.error && <span className="text-red-600">{ctx.error}</span>}
              {ctx.text && <p className="whitespace-pre-wrap">{ctx.text}</p>}
            </div>
          )}
        </div>
      )}

      {error && <Alert className="mt-3">{error}</Alert>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {CHAT_STATUSES.includes(item.status) && (
          <Button size="sm" onClick={() => onChat({ id: item.expert_id, name: item.expert_name })}>
            <Icon name="chat" className="h-3.5 w-3.5" /> Чат
          </Button>
        )}
        {CANCELLABLE.includes(item.status) &&
          (confirming ? (
            <>
              <span className="text-xs text-slate-600">Скасувати запис?</span>
              <Button size="sm" variant="danger" loading={busy} onClick={cancel}>Так, скасувати</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Ні</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>Скасувати</Button>
          ))}
      </div>
    </article>
  );
}
