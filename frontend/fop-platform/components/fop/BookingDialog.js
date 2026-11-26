'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, EmptyState, Icon, Label, Modal, Select, Skeleton, Spinner, Textarea, cx } from '@/components/ui';
import { SPECIALIZATION_LABEL, dayKey, formatDayLong, formatTime, money, parseUtc } from '@/lib/format';

const SUMMARY_LIMIT = 2000;

/**
 * Запис на консультацію.
 *  - initialExpert: фахівець із каталогу (інакше його можна обрати у вікні);
 *  - conversationId: сценарій ескалації з ШІ-чату — підсумок діалогу генерується запитом
 *    POST /api/ai/conversations/{id}/summary, ФОП його редагує, і він іде в POST /fop/bookings.
 */
export default function BookingDialog({ open, onClose, initialExpert, conversationId, conversations = [], onBooked }) {
  const [experts, setExperts] = useState([]);
  const [expertsError, setExpertsError] = useState('');
  const [expert, setExpert] = useState(null);
  const [serviceId, setServiceId] = useState(null);

  const [slots, setSlots] = useState({ state: 'idle', items: [], error: '' });
  const [dayId, setDayId] = useState(null);
  const [slot, setSlot] = useState(null);

  const [attachId, setAttachId] = useState('');
  const [summary, setSummary] = useState('');
  const [summaryState, setSummaryState] = useState({ state: 'idle', source: '', error: '' });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const activeConversationId = conversationId || (attachId ? Number(attachId) : null);

  const fetchSummary = useCallback(async (id) => {
    setSummaryState({ state: 'loading', source: '', error: '' });
    setSummary('');
    try {
      const res = await api.summarizeConversation(id);
      setSummary(res.summary);
      setSummaryState({ state: 'ready', source: res.generated_by, error: '' });
    } catch (e) {
      setSummaryState({ state: 'error', source: '', error: errorText(e) });
    }
  }, []);

  const loadSlots = useCallback(async (expertId) => {
    setSlots({ state: 'loading', items: [], error: '' });
    setDayId(null);
    setSlot(null);
    try {
      const res = await api.getExpertSlots(expertId, 14);
      setSlots({ state: 'ok', items: res.slots, error: '' });
      if (res.slots.length) setDayId(dayKey(res.slots[0].start));
    } catch (e) {
      setSlots({ state: 'error', items: [], error: errorText(e) });
    }
  }, []);

  // Ініціалізація при відкритті
  useEffect(() => {
    if (!open) return;
    setError('');
    setSubmitting(false);
    setAttachId('');
    setSummary('');
    setSummaryState({ state: 'idle', source: '', error: '' });
    setSlots({ state: 'idle', items: [], error: '' });
    setSlot(null);
    setExpert(initialExpert || null);
    setServiceId(initialExpert?.services?.[0]?.id ?? null);
    if (initialExpert) loadSlots(initialExpert.id);

    if (!initialExpert) {
      setExpertsError('');
      api.listExperts().then(setExperts).catch((e) => setExpertsError(errorText(e)));
    }
    if (conversationId) fetchSummary(conversationId);
  }, [open, initialExpert, conversationId, loadSlots, fetchSummary]);

  function pickExpert(id) {
    const next = experts.find((e) => e.id === Number(id)) || null;
    setExpert(next);
    setServiceId(next?.services?.[0]?.id ?? null);
    setSlot(null);
    if (next) loadSlots(next.id);
    else setSlots({ state: 'idle', items: [], error: '' });
  }

  function pickConversation(id) {
    setAttachId(id);
    if (id) fetchSummary(Number(id));
    else {
      setSummary('');
      setSummaryState({ state: 'idle', source: '', error: '' });
    }
  }

  const days = useMemo(() => {
    const map = new Map();
    for (const s of slots.items) {
      const k = dayKey(s.start);
      if (!map.has(k)) map.set(k, { id: k, date: parseUtc(s.start), slots: [] });
      map.get(k).slots.push(s);
    }
    return [...map.values()];
  }, [slots.items]);

  const daySlots = days.find((d) => d.id === dayId)?.slots || [];
  const service = expert?.services?.find((s) => s.id === serviceId);
  const canSubmit = Boolean(expert && serviceId && slot) && summaryState.state !== 'loading';
  const slotMinutes = slots.items.length ? Math.round((parseUtc(slots.items[0].end) - parseUtc(slots.items[0].start)) / 60000) : 60;

  async function submit() {
    setSubmitting(true);
    setError('');
    const text = summary.trim();
    try {
      const booking = await api.createBooking({
        serviceId,
        slot: slot.start,
        aiSummary: text || undefined,
        aiConversationId: text ? activeConversationId : undefined,
      });
      await onBooked(booking);
    } catch (e) {
      setError(errorText(e));
      // слот могли зайняти — оновлюємо список
      if (e.status === 409 || e.status === 422) loadSlots(expert.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={conversationId ? 'Передати питання фахівцю' : 'Запис на консультацію'}
      subtitle="Фахівець підтвердить запис, і ви побачите статус у розділі «Фахівці та записи»."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Скасувати</Button>
          <Button variant="primary" onClick={submit} loading={submitting} disabled={!canSubmit}>
            Надіслати заявку
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* 1. Фахівець і послуга */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">1. Фахівець і послуга</h3>
          {!initialExpert && (
            <div className="mb-3">
              <Label htmlFor="bk-expert">Фахівець</Label>
              {expertsError && <Alert className="mb-2">{expertsError}</Alert>}
              <Select id="bk-expert" value={expert?.id || ''} onChange={(e) => pickExpert(e.target.value)}>
                <option value="">Оберіть фахівця…</option>
                {experts.filter((e) => e.services?.length).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.specialization ? `${SPECIALIZATION_LABEL[e.specialization]} · ` : ''}{e.full_name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {expert && (
            <div>
              {initialExpert && <p className="mb-2 text-sm font-medium text-slate-900">{expert.full_name}</p>}
              <div className="space-y-2">
                {expert.services.map((s) => (
                  <label
                    key={s.id}
                    className={cx('flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors', serviceId === s.id ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50')}
                  >
                    <input type="radio" name="service" className="mt-1 accent-blue-600" checked={serviceId === s.id} onChange={() => setServiceId(s.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-slate-900">{s.title}</span>
                      {s.description && <span className="mt-0.5 block text-xs leading-5 text-slate-500">{s.description}</span>}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{money(s.price)} грн</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 2. Дата й час */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">2. Вільний час</h3>
          {!expert && <p className="text-sm text-slate-500">Спершу оберіть фахівця.</p>}
          {slots.state === 'loading' && <div className="space-y-2"><Skeleton className="h-9" /><Skeleton className="h-9" /></div>}
          {slots.state === 'error' && <Alert action={<button onClick={() => loadSlots(expert.id)} className="text-xs font-medium underline">Повторити</button>}>{slots.error}</Alert>}
          {slots.state === 'ok' && days.length === 0 && (
            <EmptyState title="Немає вільних слотів на найближчі 14 днів">Спробуйте іншого фахівця або загляньте пізніше.</EmptyState>
          )}
          {days.length > 0 && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {days.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => { setDayId(d.id); setSlot(null); }}
                    className={cx('shrink-0 rounded-xl border px-3 py-2 text-xs font-medium capitalize transition-colors', dayId === d.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}
                  >
                    {formatDayLong(d.date)}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {daySlots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => setSlot(s)}
                    aria-pressed={slot?.start === s.start}
                    className={cx('rounded-xl border py-2 text-sm font-medium tabular-nums transition-colors', slot?.start === s.start ? 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600' : 'border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50/40')}
                  >
                    {formatTime(s.start)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Час показано за вашим місцевим часом. Тривалість — {slotMinutes} хв.</p>
            </>
          )}
        </section>

        {/* 3. Контекст від ШІ */}
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">3. Контекст від ШІ-помічника</h3>

          {!conversationId && (
            <div className="mb-3">
              <Label htmlFor="bk-conv" hint="необов'язково">Прикріпити підсумок розмови з ШІ</Label>
              <Select id="bk-conv" value={attachId} onChange={(e) => pickConversation(e.target.value)} disabled={conversations.length === 0}>
                <option value="">{conversations.length ? 'Не прикріплювати' : 'Розмов із ШІ ще немає'}</option>
                {conversations.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </Select>
            </div>
          )}

          {summaryState.state === 'loading' && (
            <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Готуємо короткий підсумок розмови…</p>
          )}
          {summaryState.state === 'error' && (
            <Alert action={activeConversationId && <button onClick={() => fetchSummary(activeConversationId)} className="text-xs font-medium underline">Повторити</button>}>
              {summaryState.error} Ви можете надіслати заявку й без підсумку.
            </Alert>
          )}
          {summaryState.state === 'ready' && (
            <div>
              <Label htmlFor="bk-summary">Підсумок для фахівця — перевірте й за потреби відредагуйте</Label>
              <Textarea id="bk-summary" rows={5} maxLength={SUMMARY_LIMIT} value={summary} onChange={(e) => setSummary(e.target.value)} />
              <div className="mt-1 flex items-start justify-between gap-3 text-[11px] text-slate-400">
                <span>
                  {summaryState.source === 'fallback'
                    ? 'ШІ зараз недоступний, тому підсумок складено з ваших питань автоматично.'
                    : 'Підсумок підготовлено автоматично з вашої розмови. Очистіть поле, щоб не передавати його.'}
                </span>
                <span className="shrink-0 tabular-nums">{summary.length}/{SUMMARY_LIMIT}</span>
              </div>
            </div>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-slate-500">
            <Icon name="shield" className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" />
            Разом із заявкою фахівець побачить параметри вашого профілю ФОП (група, ставка, КВЕД) і цей підсумок — більше нічого з розмови.
          </p>
        </section>

        {error && <Alert>{error}</Alert>}
        {service && slot && (
          <p className="rounded-xl bg-slate-50 px-3.5 py-3 text-xs leading-5 text-slate-600">
            <b className="text-slate-900">{service.title}</b> · {parseUtc(slot.start).toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · {money(service.price)} грн
          </p>
        )}
      </div>
    </Modal>
  );
}
