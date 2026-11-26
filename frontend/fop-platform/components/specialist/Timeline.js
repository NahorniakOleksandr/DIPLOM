'use client';

import { Button, EmptyState, Icon, cx } from '@/components/ui';
import { dayHeading, groupByDay, kyivTime, kyivTodayKey } from '@/lib/format';
import { ClientParams, StatusBadge } from '@/components/specialist/parts';

/**
 * Таймлайн консультацій, згрупований за днями (київський час). Елементи мають бути вже відсортовані.
 * onComplete (необов'язково) додає кнопку «Завершити» для тих, що потребують завершення (can_complete з бекенду).
 */
export default function Timeline({ items, onOpen, onComplete, emptyTitle, emptyText, action }) {
  if (!items.length) {
    return <EmptyState title={emptyTitle || 'Нічого немає'} action={action}>{emptyText}</EmptyState>;
  }
  const today = kyivTodayKey();

  return (
    <div className="space-y-6">
      {groupByDay(items).map((group) => {
        const heading = dayHeading(group.key, today);
        return (
          <section key={group.key} aria-label={heading.title}>
            <h4 className="mb-2.5 flex items-baseline gap-2">
              <span className={cx('text-[13px] font-semibold', group.key === today ? 'text-blue-700' : 'text-slate-900')}>
                {heading.title}
              </span>
              {heading.sub && <span className="text-xs text-slate-500">{heading.sub}</span>}
            </h4>
            <ol className="ml-1.5 space-y-3 border-l border-slate-200 pl-5">
              {group.items.map((item) => {
                const needsCompletion = item.can_complete;
                return (
                  <li key={item.id} className="relative">
                    <span
                      className={cx(
                        'absolute -left-[26px] top-4 h-2.5 w-2.5 rounded-full border-2 border-white',
                        needsCompletion ? 'bg-amber-500' : item.is_past ? 'bg-slate-300' : 'bg-blue-600',
                      )}
                      aria-hidden="true"
                    />
                    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                            <Icon name="clock" className="h-3.5 w-3.5 text-slate-400" />
                            {kyivTime(item.slot_datetime)}–{kyivTime(item.slot_end)}
                          </p>
                          <button
                            type="button"
                            onClick={() => onOpen(item)}
                            className="mt-1 block truncate text-left text-sm font-semibold text-slate-900 hover:text-blue-700 hover:underline"
                          >
                            {item.client_name}
                          </button>
                          <p className="truncate text-xs text-slate-500">{item.service_title}</p>
                        </div>
                        <StatusBadge item={item} />
                      </div>
                      <div className="mt-2">
                        <ClientParams profile={item.client_profile} maxKveds={2} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {item.has_ai_summary && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700">
                            <Icon name="sparkle" className="h-3 w-3" /> Контекст від ШІ
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          {item.meeting_url && !item.is_past && (
                            <a
                              href={item.meeting_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-medium text-blue-700 hover:bg-blue-50"
                            >
                              <Icon name="video" className="h-3.5 w-3.5" /> Зустріч
                            </a>
                          )}
                          {onComplete && needsCompletion && (
                            <Button size="sm" variant="primary" onClick={() => onComplete(item)}>
                              <Icon name="check" className="h-3.5 w-3.5" /> Завершити
                            </Button>
                          )}
                          <Button size="sm" variant="soft" onClick={() => onOpen(item)}>
                            Картка <Icon name="chevronRight" className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
