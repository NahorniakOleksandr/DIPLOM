export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const session = {
  get() { try { return JSON.parse(localStorage.getItem("session") || "null"); } catch { return null; } },
  set(s) { localStorage.setItem("session", JSON.stringify(s)); },
  clear() { localStorage.removeItem("session"); },
};
export async function api(path, { method = "GET", body } = {}) {
  const s = session.get();
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let d; try { d = (await res.json()).detail; } catch {}
    throw new Error(typeof d === "string" ? d : "Не вдалося виконати запит. Спробуйте ще раз.");
  }
  return res.json();
}
export const money = (n) => `${Number(n).toLocaleString("uk-UA")} ₴`;
export const when = (s) => new Date(s).toLocaleString("uk-UA", { dateStyle: "medium", timeStyle: "short" });
