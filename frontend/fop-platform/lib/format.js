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

// ---------- Київський час (кабінет фахівця) ----------
// Розклад фахівця задається за Києвом, тож і час консультацій показуємо у київському часі
// незалежно від часового поясу браузера.
export const KYIV_TZ = 'Europe/Kyiv';

const kyivDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: KYIV_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const kyivTime = (iso) =>
  parseUtc(iso)?.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', timeZone: KYIV_TZ }) || '';
export const kyivDateTime = (iso) =>
  parseUtc(iso)?.toLocaleString('uk-UA', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: KYIV_TZ }) || '';
export const kyivDate = (iso) =>
  parseUtc(iso)?.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: KYIV_TZ }) || '';

/** «чт, 26 листопада · 10:00–11:00» за київським часом. */
export const kyivSlotLabel = (startIso, endIso) => {
  const day = parseUtc(startIso)?.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'long', timeZone: KYIV_TZ }) || '';
  return `${day} · ${kyivTime(startIso)}–${kyivTime(endIso)}`;
};

/** 'YYYY-MM-DD' дня за київським часом. */
export const kyivDayKey = (iso) => {
  const d = parseUtc(iso);
  return d ? kyivDayFormat.format(d) : '';
};
export const kyivTodayKey = () => kyivDayFormat.format(new Date());

const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** «Сьогодні», «Завтра» або «четвер, 27 листопада» для ключа дня 'YYYY-MM-DD'. */
export function dayHeading(key, todayKey = kyivTodayKey()) {
  const long = parseDateOnly(key)?.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }) || '';
  if (key === todayKey) return { title: 'Сьогодні', sub: long };
  if (key === addDays(todayKey, 1)) return { title: 'Завтра', sub: long };
  if (key === addDays(todayKey, -1)) return { title: 'Вчора', sub: long };
  return { title: long, sub: '' };
}

/** Групує елементи за днем (порядок елементів зберігається). */
export function groupByDay(items, getIso = (x) => x.slot_datetime) {
  const groups = [];
  const index = new Map();
  for (const item of items) {
    const key = kyivDayKey(getIso(item));
    if (!index.has(key)) {
      const group = { key, items: [] };
      index.set(key, group);
      groups.push(group);
    }
    index.get(key).items.push(item);
  }
  return groups;
}

export const WEEKDAYS = [
  { short: 'Пн', full: 'Понеділок' },
  { short: 'Вт', full: 'Вівторок' },
  { short: 'Ср', full: 'Середа' },
  { short: 'Чт', full: 'Четвер' },
  { short: 'Пт', full: 'Пʼятниця' },
  { short: 'Сб', full: 'Субота' },
  { short: 'Нд', full: 'Неділя' },
];

/** 'Іван Петренко' → 'Іван' (для привітання). */
export const firstName = (name = '') => name.trim().split(/\s+/)[0] || '';

export function plural(n, one, few, many) {
  const abs = Math.abs(n);
  const last = abs % 10;
  const tens = abs % 100;
  const word = tens >= 11 && tens <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return `${abs} ${word}`;
}
