// Форматування чисел, дат і підписів. Класи Tailwind тут НЕ використовуються
// (папка lib не сканується Tailwind) — лише «тони», які мапляться в components/ui.js.

const nf0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n) => nf0.format(Math.round(Number(n) || 0));
export const moneyExact = (n) => nf2.format(Number(n) || 0);

const NO_TZ = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;
/** Бекенд (SQLite) може повернути ISO без часової зони — це завжди UTC. */
export function parseUtc(iso) {
  if (!iso) return null;
  return new Date(NO_TZ.test(iso) ? iso : `${iso}Z`);
}

/** 'YYYY-MM-DD' → Date у локальній зоні (без зсуву на попередній день). */
export function parseDateOnly(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const pad = (x) => String(x).padStart(2, '0');

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const formatDateTime = (iso) =>
  parseUtc(iso)?.toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) || '';
export const formatTime = (iso) =>
  parseUtc(iso)?.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) || '';
export const formatDayLong = (date) =>
  date?.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' }) || '';
export const formatDueDate = (value) =>
  parseDateOnly(value)?.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }) || '';
export const dayNumber = (value) => parseDateOnly(value)?.getDate();
export const monthShort = (value) =>
  (parseDateOnly(value)?.toLocaleDateString('uk-UA', { month: 'short' }) || '').replace('.', '');

/** Ключ дня в локальній зоні користувача для групування слотів. */
export function dayKey(iso) {
  const d = parseUtc(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

export const ROMAN_GROUP = { 1: 'I', 2: 'II', 3: 'III' };
export const groupLabel = (g) => (g ? `${ROMAN_GROUP[g]} група` : '');

export const SPECIALIZATION_LABEL = { accountant: 'Бухгалтер', lawyer: 'Юрист' };

export const BOOKING_STATUS = {
  pending: { label: 'Очікує підтвердження', tone: 'amber' },
  confirmed: { label: 'Підтверджено', tone: 'blue' },
  paid: { label: 'Оплачено', tone: 'blue' },
  completed: { label: 'Завершено', tone: 'green' },
  rejected: { label: 'Відхилено', tone: 'red' },
  cancelled: { label: 'Скасовано', tone: 'slate' },
};

export const DEADLINE_STATUS = {
  done: { label: 'Виконано', tone: 'green' },
  verify: { label: 'Уточнити строк', tone: 'red' },
  overdue: { label: 'Строк минув', tone: 'red' },
  soon: { label: 'Наближається', tone: 'amber' },
  planned: { label: 'Заплановано', tone: 'green' },
};

export function daysLabel(n) {
  const abs = Math.abs(n);
  const last = abs % 10;
  const tens = abs % 100;
  const word = tens >= 11 && tens <= 14 ? 'днів' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дні' : 'днів';
  return `${abs} ${word}`;
}
