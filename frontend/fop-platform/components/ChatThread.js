'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errorText } from '@/lib/api';
import { Alert, Button, Icon, Spinner, cx } from '@/components/ui';
import { formatTime } from '@/lib/format';

const POLL_MS = 8000;

/**
 * Переписка з одним співрозмовником (ФОП ↔ спеціаліст): реальні запити
 * GET /chat/messages/{peerId} і POST /chat/messages, м'яке оновлення кожні 8 секунд.
 * Спільний для кабінету ФОПа (ChatDrawer) і кабінету фахівця (ChatTab).
 */
export default function ChatThread({ peer, meId, className, emptyText = 'Повідомлень поки немає. Напишіть першим.' }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef(null);
  const peerId = peer?.id;

  const load = useCallback(
    async (silent) => {
      if (!peerId) return;
      try {
        const items = await api.getMessages(peerId);
        setMessages((prev) => (prev.length === items.length && prev.at(-1)?.id === items.at(-1)?.id ? prev : items));
        if (!silent) setError('');
      } catch (e) {
        if (!silent) setError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [peerId],
  );

  useEffect(() => {
    if (!peerId) return undefined;
    setLoading(true);
    setMessages([]);
    setDraft('');
    load(false);
    const timer = setInterval(() => !document.hidden && load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [peerId, load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  async function submit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const created = await api.sendMessage(peerId, text);
      setMessages((m) => [...m, created]);
      setDraft('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <div className="flex-1 space-y-2 overflow-y-auto pr-1" role="log" aria-live="polite" aria-label="Переписка">
        {loading && <div className="flex justify-center py-6 text-slate-400"><Spinner /></div>}
        {!loading && messages.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>}
        {messages.map((m) => {
          const mine = m.sender_id === meId;
          return (
            <div key={m.id} className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cx('max-w-[82%] rounded-2xl px-3.5 py-2 text-[13px] leading-5', mine ? 'rounded-br-md bg-blue-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-800')}>
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <p className={cx('mt-0.5 text-right text-[10px]', mine ? 'text-blue-100' : 'text-slate-400')}>{formatTime(m.created_at)}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      {error && <Alert className="mt-3">{error}</Alert>}
      <form onSubmit={submit} className="mt-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={5000}
          placeholder="Напишіть повідомлення…"
          className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          aria-label="Повідомлення"
        />
        <Button type="submit" variant="primary" loading={sending} disabled={!draft.trim()} aria-label="Надіслати">
          <Icon name="arrowUp" className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
