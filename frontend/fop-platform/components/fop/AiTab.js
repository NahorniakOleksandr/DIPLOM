'use client';

import { useEffect } from 'react';
import { Alert, Button, Card, Icon, cx } from '@/components/ui';
import { parseUtc } from '@/lib/format';
import AiChatPanel from './AiChatPanel';

export default function AiTab({ chat, profile, onEscalate, onOpenProfile }) {
  const { refreshConversations } = chat;
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  return (
    <div className="grid gap-5 lg:grid-cols-[270px_minmax(0,1fr)]">
      <Card className="h-fit p-3">
        <Button variant="primary" className="w-full" onClick={chat.reset}>
          <Icon name="plus" className="h-4 w-4" /> Нова розмова
        </Button>
        <h3 className="mb-1.5 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Історія</h3>
        {chat.listError && <Alert className="mb-2">{chat.listError}</Alert>}
        {chat.conversations.length === 0 && !chat.listError && (
          <p className="px-2 py-3 text-xs leading-5 text-slate-500">Розмов ще немає. Поставте перше питання — воно збережеться тут.</p>
        )}
        <ul className="max-h-[420px] space-y-0.5 overflow-y-auto">
          {chat.conversations.map((c) => (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => chat.open(c.id)}
                className={cx(
                  'w-full rounded-lg px-2.5 py-2 pr-9 text-left transition-colors',
                  c.id === chat.conversationId ? 'bg-blue-50' : 'hover:bg-slate-50',
                )}
              >
                <span className={cx('block truncate text-[13px]', c.id === chat.conversationId ? 'font-medium text-blue-700' : 'text-slate-800')}>{c.title}</span>
                <span className="block text-[11px] text-slate-400">
                  {parseUtc(c.updated_at)?.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}
                </span>
              </button>
              <button
                type="button"
                onClick={() => window.confirm('Видалити цю розмову?') && chat.remove(c.id)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                aria-label="Видалити розмову"
              >
                <Icon name="trash" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <AiChatPanel chat={chat} profile={profile} variant="full" onEscalate={onEscalate} onOpenProfile={onOpenProfile} />
    </div>
  );
}
