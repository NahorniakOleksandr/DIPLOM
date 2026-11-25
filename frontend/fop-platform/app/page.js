"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, session } from "@/lib/api";
import { Err } from "@/components/ui";

export default function Auth() {
  const r = useRouter();
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("fop");
  const [f, setF] = useState({ full_name: "", email: "", password: "", profession: "accountant" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "register") {
        await api("/auth/register", { method: "POST", body: { ...f, role } });
      }
      const d = await api("/auth/login", { method: "POST", body: { email: f.email, password: f.password } });
      const userRole = d.role || role;
      session.set({ token: d.access_token, role: userRole, name: d.full_name || f.full_name || f.email });
      r.push(userRole === "fop" ? "/fop" : "/specialist");
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl items-center gap-12 px-4 md:grid-cols-2">
      <div>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">Податки й закони без паніки</h1>
        <p className="mt-4 max-w-sm text-ink/60">Запишіться до бухгалтера чи юриста, а на швидкі питання отримайте відповідь від ШІ-помічника з посиланням на закон.</p>
      </div>
      <form onSubmit={submit} className="card space-y-4 p-7">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-paper p-1 text-sm">
          {[["fop", "Я ФОП"], ["expert", "Я спеціаліст"]].map(([v, l]) => (
            <button
              type="button"
              key={v}
              onClick={() => setRole(v)}
              className={`rounded-md py-2 ${role === v ? "bg-white font-medium shadow-sm" : "text-ink/60"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <Err msg={err} />
        {mode === "register" && (
          <input className="inp" required placeholder="Ім’я та прізвище" value={f.full_name} onChange={set("full_name")} />
        )}
        <input className="inp" type="email" required placeholder="Електронна пошта" value={f.email} onChange={set("email")} />
        <input className="inp" type="password" required minLength={8} placeholder="Пароль (мін. 8 символів)" value={f.password} onChange={set("password")} />
        {mode === "register" && role === "expert" && (
          <select className="inp" value={f.profession} onChange={set("profession")}>
            <option value="accountant">Бухгалтер</option>
            <option value="lawyer">Юрист</option>
          </select>
        )}
        <button className="btn w-full" disabled={busy}>
          {busy ? "Зачекайте…" : mode === "login" ? "Увійти" : "Створити акаунт"}
        </button>
        <button
          type="button"
          className="w-full text-sm text-ink/60 hover:text-ink"
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}
        >
          {mode === "login" ? "Немає акаунта? Зареєструватися" : "Вже є акаунт? Увійти"}
        </button>
      </form>
    </main>
  );
}