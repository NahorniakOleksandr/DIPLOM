// Клієнт API платформи. Усі запити кабінету ФОПа йдуть через цей файл до FastAPI-бекенду.
// Адреса бекенду: NEXT_PUBLIC_API_URL у .env.local (за замовчуванням http://localhost:8000).

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

// ---------- Токен ----------
export const TOKEN_KEY = 'fop_token';
// Сесія входу (token, role, name) одним JSON-об'єктом: її пише сторінка входу app/page.js.
const SESSION_KEY = 'session';

function readSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

// Сумісність: якщо сторінка входу раніше зберігала токен під іншим ключем — підхоплюємо його один раз.
const LEGACY_TOKEN_KEYS = ['access_token', 'token', 'fop_platform_token'];

export function getToken() {
  if (typeof window === 'undefined') return null;
  try {
    let token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) {
      for (const key of LEGACY_TOKEN_KEYS) {
        const legacy = window.localStorage.getItem(key);
        if (legacy) {
          token = legacy;
          window.localStorage.setItem(TOKEN_KEY, legacy);
          break;
        }
      }
    }
    if (!token) {
      // Сторінка входу зберігає сесію одним JSON-об'єктом {token, role, name}.
      const stored = readSession();
      if (stored && stored.token) {
        token = stored.token;
        window.localStorage.setItem(TOKEN_KEY, token);
      }
    }
    return token || null;
  } catch {
    return null;
  }
}

export function setToken(token) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* сховище недоступне (приватний режим) — токен житиме лише в пам'яті сесії */
  }
}

export function clearToken() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(SESSION_KEY);
    for (const key of LEGACY_TOKEN_KEYS) window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------- Помилки ----------
export class ApiError extends Error {
  constructor(message, { status = 0, detail = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

const FIELD_NAMES = {
  email: 'Email',
  password: 'Пароль',
  full_name: "Повне ім'я",
  amount: 'Сума',
  received_on: 'Дата',
  note: 'Примітка',
  tax_group: 'Група',
  tax_rate: 'Ставка',
  kveds: 'КВЕД',
  has_employees: 'Наймані працівники',
  question: 'Питання',
  slot_datetime: 'Час',
  ai_summary: 'Підсумок',
  meeting_url: 'Посилання',
  expert_notes: 'Нотатки',
  expert_summary: 'Підсумок',
  summary: 'Підсумок',
  reason: 'Причина',
  slot_minutes: 'Тривалість консультації',
  windows: 'Розклад',
  weekday: 'День тижня',
  start: 'Початок',
  end: 'Кінець',
  headline: 'Заголовок',
  bio: 'Про себе',
  experience_years: 'Стаж',
  title: 'Назва',
  description: 'Опис',
  price: 'Ціна',
};

function translateMessage(msg) {
  const m = String(msg || '').replace(/^Value error,\s*/i, '');
  if (/^Field required/i.test(m)) return "обов'язкове поле";
  let r = m.match(/should have at least (\d+) character/i);
  if (r) return `мінімум ${r[1]} символів`;
  r = m.match(/should have at most (\d+) character/i);
  if (r) return `максимум ${r[1]} символів`;
  if (/valid number|valid decimal|valid integer/i.test(m)) return 'введіть коректне число';
  if (/greater than 0/i.test(m)) return 'має бути більше нуля';
  if (/greater than or equal to/i.test(m)) return 'значення надто мале';
  if (/less than or equal to/i.test(m)) return 'значення надто велике';
  if (/valid email/i.test(m)) return 'некоректна адреса email';
  return m;
}

function formatDetail(detail, status) {
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const path = Array.isArray(d.loc) ? d.loc.filter((p) => !['body', 'query', 'path'].includes(p)) : [];
        const field = path.length ? FIELD_NAMES[path[path.length - 1]] || path.join('.') : '';
        const text = translateMessage(d.msg);
        return field ? `${field}: ${text}` : text;
      })
      .join('; ');
  }
  if (status === 401) return 'Сесія завершилась. Увійдіть знову.';
  if (status === 403) return 'Недостатньо прав для цієї дії.';
  if (status >= 500) return `Помилка сервера (${status}). Спробуйте пізніше.`;
  return `Не вдалося виконати запит (${status}).`;
}

export function errorText(err) {
  if (err instanceof ApiError) return err.message;
  if (err && err.message) return err.message;
  return 'Сталася невідома помилка.';
}

// ---------- Базовий запит ----------
async function request(path, { method = 'GET', body, query, auth = true, signal } = {}) {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError(`Не вдалося з'єднатися із сервером (${BASE_URL}). Перевірте, чи запущено бекенд.`, { status: 0 });
  }

  if (response.status === 204) return null;

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && auth) clearToken();
    throw new ApiError(formatDetail(data && data.detail, response.status), {
      status: response.status,
      detail: data && data.detail,
    });
  }
  return data;
}

// ---------- Авторизація ----------
// Відповідь /auth/login: { access_token, token_type, role, full_name }
export async function login(email, password) {
  const data = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
  session.set({ token: data.access_token, role: data.role, name: data.full_name || email });
  return data;
}

export function register(payload) {
  return request('/auth/register', { method: 'POST', body: payload, auth: false });
}

export const me = (opts) => request('/auth/me', opts);

export function logout() {
  clearToken();
}

// ---------- Профіль ФОПа ----------
export const getFopProfile = () => request('/fop/profile');
export const saveFopProfile = (profile) => request('/fop/profile', { method: 'PUT', body: profile });

// ---------- Дашборд, доходи, строки ----------
export const getDashboard = () => request('/fop/dashboard');
export const listIncome = (year) => request('/fop/income', { query: { year } });
export const addIncome = (entry) => request('/fop/income', { method: 'POST', body: entry });
export const deleteIncome = (id) => request(`/fop/income/${id}`, { method: 'DELETE' });
export const setDeadlineDone = (key, done) =>
  request(`/fop/deadlines/${encodeURIComponent(key)}`, { method: 'PUT', body: { done } });

// ---------- ШІ-помічник ----------
export const aiChat = (question, conversationId) =>
  request('/api/ai/chat', {
    method: 'POST',
    body: conversationId ? { question, conversation_id: conversationId } : { question },
  });
export const listConversations = () => request('/api/ai/conversations');
export const getConversation = (id) => request(`/api/ai/conversations/${id}`);
export const deleteConversation = (id) => request(`/api/ai/conversations/${id}`, { method: 'DELETE' });
export const summarizeConversation = (id) => request(`/api/ai/conversations/${id}/summary`, { method: 'POST' });
export const getBookingContext = (bookingId) => request(`/api/ai/bookings/${bookingId}/context`);

// ---------- Каталог фахівців і записи ----------
export const listExperts = ({ specialization, q } = {}) =>
  request('/fop/experts', { query: { specialization, q, with_services: true, limit: 50 } });
export const getExpertSlots = (expertId, days = 14) => request(`/fop/experts/${expertId}/slots`, { query: { days } });
export const createBooking = ({ serviceId, slot, aiSummary, aiConversationId }) =>
  request('/fop/bookings', {
    method: 'POST',
    body: {
      service_id: serviceId,
      slot_datetime: slot,
      ...(aiSummary ? { ai_summary: aiSummary } : {}),
      ...(aiConversationId ? { ai_conversation_id: aiConversationId } : {}),
    },
  });
export const listConsultations = (status) => request('/fop/consultations', { query: { status } });
export const cancelBooking = (id) => request(`/fop/bookings/${id}/cancel`, { method: 'POST' });

// ---------- Чат із фахівцем ----------
export const getMessages = (peerId) => request(`/chat/messages/${peerId}`);
export const sendMessage = (receiverId, content) =>
  request('/chat/messages', { method: 'POST', body: { receiver_id: receiverId, content } });

// Сумісність зі сторінкою входу (app/page.js): api('/шлях', { method, body }) і session.
export const session = {
  get() {
    if (typeof window === 'undefined') return null;
    return readSession();
  },
  set(value) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } catch {
      /* сховище недоступне — сесія житиме лише в пам'яті */
    }
    if (value && value.token) setToken(value.token);
  },
  clear() {
    clearToken();
  },
};

function apiCall(path, { method = 'GET', body } = {}) {
  return request(path, { method, body });
}

// ---------- Кабінет спеціаліста (Етап 3) ----------
export const getExpertDashboard = () => request('/expert/dashboard');

/** scope: requests (нові заявки) | upcoming (підтверджені) | history (архів) | all */
export const listExpertConsultations = ({ scope = 'all', status, limit } = {}) =>
  request('/expert/consultations', { query: { scope, status, limit } });
export const getExpertConsultation = (id) => request(`/expert/consultations/${id}`);

/** Часткове оновлення картки: передавайте лише змінені поля (meeting_url, expert_notes, expert_summary). */
export const updateExpertConsultation = (id, patch) =>
  request(`/expert/consultations/${id}`, { method: 'PATCH', body: patch });

/** status: confirmed (+ meetingUrl) | rejected (+ reason) | completed (+ summary). */
export const setBookingStatus = (id, { status, meetingUrl, reason, summary }) =>
  request(`/expert/bookings/${id}/status`, {
    method: 'PATCH',
    body: { status, meeting_url: meetingUrl || undefined, reason: reason || undefined, summary },
  });

export const listExpertClients = () => request('/expert/clients');

export const getExpertSchedule = () => request('/expert/schedule');
export const saveExpertSchedule = ({ slotMinutes, windows }) =>
  request('/expert/schedule', { method: 'PUT', body: { slot_minutes: slotMinutes, windows } });

export const getExpertProfile = () => request('/expert/profile');
export const saveExpertProfile = (patch) => request('/expert/profile', { method: 'PATCH', body: patch });

export const listMyServices = () => request('/expert/services');
export const createService = ({ title, description, price }) =>
  request('/expert/services', { method: 'POST', body: { title, description, price } });
export const updateService = (id, patch) => request(`/expert/services/${id}`, { method: 'PATCH', body: patch });
export const deleteService = (id) => request(`/expert/services/${id}`, { method: 'DELETE' });

export const api = Object.assign(apiCall, {
  login, register, me, logout, getToken, setToken, clearToken,
  getFopProfile, saveFopProfile,
  getDashboard, listIncome, addIncome, deleteIncome, setDeadlineDone,
  aiChat, listConversations, getConversation, deleteConversation, summarizeConversation, getBookingContext,
  listExperts, getExpertSlots, createBooking, listConsultations, cancelBooking,
  getMessages, sendMessage,
  getExpertDashboard, listExpertConsultations, getExpertConsultation, updateExpertConsultation, setBookingStatus,
  listExpertClients, getExpertSchedule, saveExpertSchedule, getExpertProfile, saveExpertProfile,
  listMyServices, createService, updateService, deleteService,
});

export default api;
