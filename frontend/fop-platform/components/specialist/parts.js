'use client';

import { Badge } from '@/components/ui';
import { groupLabel } from '@/lib/format';

// Підписи статусів з погляду спеціаліста (ФОП бачить свої: «Очікує підтвердження» тощо)
export const EXPERT_STATUS = {
  pending: { label: 'Нова заявка', tone: 'amber' },
  confirmed: { label: 'Підтверджено', tone: 'blue' },
  paid: { label: 'Оплачено', tone: 'blue' },
  completed: { label: 'Проведено', tone: 'green' },
  rejected: { label: 'Відхилено', tone: 'red' },
  cancelled: { label: 'Скасовано клієнтом', tone: 'slate' },
};

/** Бейдж статусу. Прапорці can_* приходять з бекенду, тож «потребує завершення» не вгадується на клієнті. */
export function StatusBadge({ item, className }) {
  if ((item.status === 'confirmed' || item.status === 'paid') && item.can_complete) {
    return <Badge tone="amber" className={className}>Потребує завершення</Badge>;
  }
  if (item.status === 'pending' && item.is_past) {
    return <Badge tone="red" className={className}>Час минув</Badge>;
  }
  const meta = EXPERT_STATUS[item.status] || { label: item.status, tone: 'slate' };
  return <Badge tone={meta.tone} className={className}>{meta.label}</Badge>;
}

/** Параметри ФОПа з його профілю: група, ставка, КВЕД, працівники. */
export function ClientParams({ profile, maxKveds = 3 }) {
  const chips = [];
  if (profile?.tax_group) {
    const rate = profile.tax_rate != null ? ` · ${Number(profile.tax_rate)}%` : '';
    chips.push(`${groupLabel(profile.tax_group)}${rate}`);
  }
  const kveds = profile?.kveds || [];
  kveds.slice(0, maxKveds).forEach((k) => chips.push(`КВЕД ${k}`));
  if (kveds.length > maxKveds) chips.push(`+${kveds.length - maxKveds}`);
  if (profile?.tax_group) chips.push(profile.has_employees ? 'Є працівники' : 'Без працівників');

  if (!chips.length) return <span className="text-xs text-slate-400">Профіль ФОП не заповнено</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span key={chip} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          {chip}
        </span>
      ))}
    </div>
  );
}
