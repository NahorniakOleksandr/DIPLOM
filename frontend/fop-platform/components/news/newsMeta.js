import { SPECIALIZATION_LABEL } from '@/lib/format';

// Категорії збігаються з backend/news_rules.py (CATEGORY_LABEL)
export const CATEGORY_OPTIONS = [
  { id: 'law_change', label: 'Зміни в законах' },
  { id: 'taxes', label: 'Податки' },
  { id: 'reporting', label: 'Звітність' },
  { id: 'esv', label: 'ЄСВ і зарплата' },
  { id: 'other', label: 'Інше' },
];

// Кольори — готові рядки в ui.js (BADGE_TONES), тож Tailwind їх не «вирізає»
export const CATEGORY_TONE = {
  law_change: 'blue',
  taxes: 'green',
  reporting: 'amber',
  esv: 'slate',
  other: 'slate',
};

export const SCOPES = [
  { id: 'all', label: 'Усі' },
  { id: 'article', label: 'Від спеціалістів' },
  { id: 'official', label: 'Офіційні джерела' },
];

/** Підпис автора або джерела: «Анна Бондар · Бухгалтер» чи «Законодавство України». */
export function bylineOf(item) {
  if (item.kind === 'official') return item.source_name || 'Офіційне джерело';
  const spec = SPECIALIZATION_LABEL[item.author_specialization];
  const name = item.author_name || 'Автор невідомий';
  return spec ? `${name} · ${spec}` : name;
}
