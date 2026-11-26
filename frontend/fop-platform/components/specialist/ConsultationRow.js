'use client';

import { Avatar, Button, Icon, cx } from '@/components/ui';
import { kyivSlotLabel, money } from '@/lib/format';
import { ClientParams, StatusBadge } from '@/components/specialist/parts';

/**
 * Картка заявки/консультації у списках. Які кнопки показати — вирішують прапорці can_* з бекенду:
 * інтерфейс не повторює правила часу й статусів, тож «Підтвердити» не з'явиться для слота, що вже минув.
 */
export default function ConsultationRow({ item, actions, onOpen, onChat, highlight = false }) {
  const live = item.status === 'confirmed' || item.status === 'paid';

  return (
    <article
      className={cx(
        'rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        highlight ? 'border-amber-200' : 'border-slate-200',
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={item.client_name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="truncate text-left text-sm font-semibold text-slate-900 hover:text-blue-700 hover:underline"
            >
              {item.client_name}
            </button>
            <StatusBadge item={item} className="shrink-0" />
          </div>
          <div className="mt-1.5">
            <ClientParams profile={item.client_profile} />
          </div>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 text-xs text-slate-600">
        <div className="flex items-center gap-1.5">
          <Icon name="calendar" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <dt className="sr-only">Час</dt>
          <dd className="font-medium text-slate-800">{kyivSlotLabel(item.slot_datetime, item.slot_end)}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <Icon name="doc" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <dt className="sr-only">Послуга</dt>
          <dd>
            {item.service_title} · {money(item.service_price)} грн
          </dd>
        </div>
      </dl>

      {(item.has_ai_summary || item.has_notes) && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {item.has_ai_summary && (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              <Icon name="sparkle" className="h-3 w-3" /> Є контекст від ШІ
            </span>
          )}
          {item.has_notes && (
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              <Icon name="lock" className="h-3 w-3" /> Є нотатки
            </span>
          )}
        </div>
      )}

      {item.status === 'rejected' && item.rejection_reason && (
        <p className="mt-2.5 text-xs text-red-600">Причина: {item.rejection_reason}</p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {item.can_confirm && (
          <Button size="sm" variant="primary" onClick={() => actions.confirm(item)}>
            <Icon name="check" className="h-3.5 w-3.5" /> Підтвердити
          </Button>
        )}
        {item.can_complete && (
          <Button size="sm" variant="primary" onClick={() => actions.complete(item)}>
            <Icon name="check" className="h-3.5 w-3.5" /> Завершити
          </Button>
        )}
        {item.can_reject && (
          <Button size="sm" variant="danger" onClick={() => actions.reject(item)}>
            {item.status === 'pending' ? 'Відхилити' : 'Скасувати'}
          </Button>
        )}
        {live && item.meeting_url && !item.is_past && (
          <a
            href={item.meeting_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-medium text-blue-700 hover:bg-blue-50"
          >
            <Icon name="video" className="h-3.5 w-3.5" /> Зустріч
          </a>
        )}
        <div className="ml-auto flex items-center gap-1">
          {onChat && item.status !== 'rejected' && item.status !== 'cancelled' && (
            <Button size="sm" variant="ghost" onClick={() => onChat({ id: item.client_id, name: item.client_name })}>
              <Icon name="chat" className="h-3.5 w-3.5" /> Чат
            </Button>
          )}
          <Button size="sm" variant="soft" onClick={() => onOpen(item)}>
            Картка <Icon name="chevronRight" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}
