'use client';

import { Badge, Button, Card, Icon } from '@/components/ui';
import LimitCard from './LimitCard';
import DeadlinesCard from './DeadlinesCard';
import AiChatPanel from './AiChatPanel';

const CATEGORIES = [
  { id: 'accountant', icon: 'doc', title: 'Бухгалтер для ФОП', text: 'Звітність, податки та облік' },
  { id: 'lawyer', icon: 'scale', title: 'Юрист для бізнесу', text: 'Договори, КВЕДи та правові питання' },
];

export default function OverviewTab({
  user, dashboard, dashError, onReloadDashboard, chat, consultations,
  onUpdateIncome, onOpenProfile, onOpenAiTab, onAskSpecialist, onEscalate, onBookNew, onOpenBookings,
}) {
  const firstName = (user?.full_name || '').split(/\s+/)[0] || '';
  const active = (consultations.items || []).filter((c) => ['pending', 'confirmed', 'paid'].includes(c.status));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">Вітаємо{firstName && `, ${firstName}`}</h1>
        <p className="mt-1 text-sm text-slate-500">Ваші фінанси, податки та відповіді — в одному місці.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <LimitCard
          dashboard={dashboard}
          error={dashError}
          onReload={onReloadDashboard}
          onUpdateIncome={onUpdateIncome}
          onOpenProfile={onOpenProfile}
          onAskSpecialist={onAskSpecialist}
        />
        <DeadlinesCard
          dashboard={dashboard}
          error={dashError}
          onReload={onReloadDashboard}
          onOpenProfile={onOpenProfile}
          onAskSpecialist={onAskSpecialist}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div>
          <AiChatPanel chat={chat} profile={dashboard?.profile} variant="compact" onEscalate={onEscalate} onOpenProfile={onOpenProfile} />
          <button type="button" onClick={onOpenAiTab} className="mt-2 text-xs font-medium text-blue-600 hover:underline">
            Відкрити повний чат та історію розмов →
          </button>
        </div>

        <Card className="h-fit p-5">
          <h2 className="text-sm font-semibold text-slate-900">Фахівці та записи</h2>
          <p className="text-xs text-slate-500">Підтримка, коли вона потрібна</p>

          <div className="mt-4 space-y-2.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onAskSpecialist(c.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Icon name={c.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-slate-900">{c.title}</span>
                  <span className="block text-xs text-slate-500">{c.text}</span>
                </span>
                <Icon name="chevronRight" className="h-4 w-4 text-slate-400" />
              </button>
            ))}
          </div>

          <Button variant="primary" size="lg" className="mt-4 w-full" onClick={() => onAskSpecialist(null)}>
            Знайти фахівця <Icon name="arrowRight" className="h-4 w-4" />
          </Button>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-slate-900">Ваші записи</h3>
              <button type="button" onClick={onOpenBookings}>
                <Badge tone={active.length ? 'blue' : 'slate'}>
                  {consultations.items === null ? '…' : active.length ? `Активних: ${active.length}` : 'Немає записів'}
                </Badge>
              </button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {active.length
                ? 'Статуси консультацій і посилання на зустрічі — у розділі «Фахівці та записи».'
                : 'Запланувати розмову з фахівцем у зручний для вас час.'}
            </p>
            <button type="button" onClick={onBookNew} className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-blue-600 hover:underline">
              Обрати час консультації <Icon name="arrowRight" className="h-3.5 w-3.5" />
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
