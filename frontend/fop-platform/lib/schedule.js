// Чиста логіка редактора розкладу (без React і без класів Tailwind).
// Правила дзеркалять бекенд (scheduling.validate_windows) лише для миттєвих підказок;
// остаточне слово — за відповіддю сервера.

export const SLOT_OPTIONS = [15, 20, 30, 45, 60, 90, 120];
export const DEFAULT_WINDOW = { start: '10:00', end: '17:00' };
export const MAX_WINDOWS_PER_DAY = 6;

/** 'HH:MM' або 'HH:MM:SS' → хвилини від півночі; NaN, якщо формат некоректний. */
export function toMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? NaN : h * 60 + min;
}

/** 'HH:MM:SS' → 'HH:MM' (формат для <input type="time">). */
export const clock = (value) => String(value || '').slice(0, 5);

/** Відповідь API (windows: [{weekday,start,end}]) → масив із 7 днів, у кожному — вікна за зростанням початку. */
export function daysFromApi(windows = []) {
  const days = Array.from({ length: 7 }, () => []);
  for (const w of windows) {
    if (w.weekday >= 0 && w.weekday <= 6) days[w.weekday].push({ start: clock(w.start), end: clock(w.end) });
  }
  days.forEach((d) => d.sort((a, b) => toMinutes(a.start) - toMinutes(b.start)));
  return days;
}

/** Масив із 7 днів → тіло запиту: [{weekday,start,end}]. */
export function daysToApi(days) {
  const windows = [];
  days.forEach((list, weekday) => list.forEach((w) => windows.push({ weekday, start: w.start, end: w.end })));
  return windows;
}

/** Скільки консультацій вміщують вікна дня. */
export function countSlots(list, slotMinutes) {
  let total = 0;
  for (const w of list) {
    const span = toMinutes(w.end) - toMinutes(w.start);
    if (span > 0 && slotMinutes > 0) total += Math.floor(span / slotMinutes);
  }
  return total;
}

export const totalSlots = (days, slotMinutes) => days.reduce((sum, d) => sum + countSlots(d, slotMinutes), 0);

/**
 * Перша помилка для кожного дня (або null). Правила як на бекенді: обидва часи задано, кінець пізніше за початок,
 * вікно вміщає хоча б одну консультацію, вікна не перетинаються, не більше MAX_WINDOWS_PER_DAY.
 */
export function validateDays(days, slotMinutes) {
  return days.map((list) => {
    if (list.length > MAX_WINDOWS_PER_DAY) return `Не більше ${MAX_WINDOWS_PER_DAY} вікон на день`;
    const parsed = [];
    for (const w of list) {
      const start = toMinutes(w.start);
      const end = toMinutes(w.end);
      if (Number.isNaN(start) || Number.isNaN(end)) return 'Вкажіть початок і кінець кожного вікна';
      if (end <= start) return `Кінець (${w.end}) має бути пізніше за початок (${w.start})`;
      if (end - start < slotMinutes) return `Вікно ${w.start}–${w.end} коротше за одну консультацію (${slotMinutes} хв)`;
      parsed.push({ start, end });
    }
    parsed.sort((a, b) => a.start - b.start);
    let latestEnd = -1;
    for (const w of parsed) {
      if (latestEnd >= 0 && w.start < latestEnd) return 'Вікна перетинаються';
      latestEnd = Math.max(latestEnd, w.end);
    }
    return null;
  });
}

/** Чи відрізняються розклади (порівнюємо нормалізований вигляд). */
export const sameSchedule = (a, b) => JSON.stringify(daysToApi(a)) === JSON.stringify(daysToApi(b));

/** Копіює вікна дня `from` у дні `targets` (повертає новий масив). */
export function copyDay(days, from, targets) {
  return days.map((list, i) => (targets.includes(i) && i !== from ? days[from].map((w) => ({ ...w })) : list));
}
