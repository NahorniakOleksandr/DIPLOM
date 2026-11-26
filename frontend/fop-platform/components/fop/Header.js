'use client';

import AppHeader from '@/components/AppHeader';
import { groupLabel } from '@/lib/format';

export const TABS = [
  { id: 'overview', label: 'Огляд' },
  { id: 'ai', label: 'ШІ-помічник' },
  { id: 'specialists', label: 'Фахівці та записи' },
  { id: 'profile', label: 'Мій профіль ФОП' },
];

/** Шапка кабінету ФОПа: спільний AppHeader + чіп із групою та ставкою. */
export default function Header({ tab, onTab, profile, user, onLogout }) {
  const chip = profile?.tax_group
    ? `${groupLabel(profile.tax_group)}${profile.tax_rate != null ? ` + ${Number(profile.tax_rate)}%` : ''}`
    : 'Профіль не заповнено';

  return (
    <AppHeader
      tabs={TABS}
      tab={tab}
      onTab={onTab}
      user={user}
      onLogout={onLogout}
      chip={chip}
      chipTitle="Відкрити профіль ФОП"
      onChip={() => onTab('profile')}
    />
  );
}
