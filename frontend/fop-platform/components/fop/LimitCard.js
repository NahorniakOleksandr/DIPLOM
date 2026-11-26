'use client';

import { Alert, Badge, Button, Card, Icon, ProgressBar, Skeleton, cx } from '@/components/ui';
import { money } from '@/lib/format';

const STATUS_TONE = { ok: 'green', warning: 'amber', exceeded: 'red' };
const STATUS_TEXT = { ok: 'text-emerald-600', warning: 'text-amber-600', exceeded: 'text-red-600' };
const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
const MULT = { 1: '167', 2: '834', 3: '1 167' };

export default function LimitCard({ dashboard, error, onReload, onUpdateIncome, onOpenProfile, onAskSpecialist }) {
  const limit = dashboard?.limit;
  const title = `Річний ліміт доходу${limit?.group ? ` (${ROMAN[limit.group]} група)` : ''}`;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <Button size="sm" onClick={onUpdateIncome} disabled={!dashboard}>
          <Icon name="pencil" className="h-3.5 w-3.5" /> Оновити дохід
        </Button>
      </div>

      {error && (
        <Alert className="mt-4" action={<button onClick={onReload} className="shrink-0 text-xs font-medium underline">Повторити</button>}>
          {error}
        </Alert>
      )}

      {!dashboard && !error && (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      )}

      {dashboard && limit.status === 'no_group' && (
        <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-4">
          <p className="text-sm text-slate-700">{limit.message}</p>
          <p className="mt-1 text-xs text-slate-500">
            Лічильник працює як особистий трекер: ліміт залежить від групи, а дохід ви вносите самі.
          </p>
          <Button variant="primary" size="sm" className="mt-3" onClick={onOpenProfile}>
            Заповнити профіль <Icon name="arrowRight" className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {dashboard && limit.status === 'not_configured' && (
        <Alert tone="amber" className="mt-4">{limit.message}</Alert>
      )}

      {dashboard && limit.limit != null && (
        <>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[34px] font-bold leading-none tracking-tight text-slate-900 tabular-nums">{money(limit.used)}</span>
              <span className="text-sm text-slate-400 tabular-nums">/ {money(limit.limit)} грн</span>
            </div>
            <Badge tone={STATUS_TONE[limit.status] || 'slate'} className="tabular-nums">{limit.percent.toFixed(1)}%</Badge>
          </div>

          <div className="mt-4">
            <ProgressBar percent={limit.percent} tone={STATUS_TONE[limit.status] || 'green'} />
          </div>

          <p className="mt-4 text-[13px] text-slate-500">
            Залишок ліміту: <span className="font-semibold text-slate-900 tabular-nums">{money(limit.remaining)} грн</span>
          </p>
          <p className={cx('mt-2 flex items-start gap-1.5 text-xs font-medium', STATUS_TEXT[limit.status])}>
            <Icon name={limit.status === 'ok' ? 'check' : 'alert'} className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>{limit.message}</span>
          </p>
          {limit.status !== 'ok' && (
            <Button size="sm" variant="soft" className="mt-3" onClick={() => onAskSpecialist('accountant')}>
              Запитати бухгалтера
            </Button>
          )}
          <p className="mt-3 text-[11px] leading-4 text-slate-400">
            Ліміт {dashboard.year} року: {MULT[limit.group]} мінімальних зарплат ({money(limit.min_wage)} грн).
            Дохід — із ваших записів у трекері.
          </p>
        </>
      )}
    </Card>
  );
}
