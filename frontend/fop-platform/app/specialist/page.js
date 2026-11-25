"use client";
import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { useGuard, Shell, Empty, Err, Meetings, ChatPanel } from "@/components/ui";

const TABS = [["services", "Мої послуги"], ["meetings", "Консультації"], ["chat", "Чат з клієнтами"]];

export default function SpecialistCabinet() {
  const user = useGuard("specialist"); const [tab, setTab] = useState("services");
  const [services, setServices] = useState([]); const [meetings, setMeetings] = useState([]);
  const [form, setForm] = useState({ title: "", price: "" }); const [err, setErr] = useState("");
  const loadServices = () => api("/services/my").then(setServices).catch(() => {});
  useEffect(() => { if (user) { loadServices(); api("/appointments/my").then(setMeetings).catch(() => {}); } }, [user]);
  if (!user) return null;
  async function add(e) {
    e.preventDefault(); setErr("");
    try { await api("/services", { method: "POST", body: { title: form.title, price: Number(form.price) } }); setForm({ title: "", price: "" }); loadServices(); }
    catch (x) { setErr(x.message); }
  }
  const peers = [...new Map(meetings.map((m) => [m.peer_id, { id: m.peer_id, name: m.peer_name }])).values()];
  return (
    <Shell user={user} tabs={TABS} tab={tab} setTab={setTab}>
      {tab === "services" && (
        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          <form onSubmit={add} className="card h-fit space-y-3">
            <h2 className="font-semibold">Нова послуга</h2><Err msg={err} />
            <input className="inp" required placeholder="Назва, напр. Консультація з ЄП" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className="inp" required type="number" min="1" placeholder="Ціна, ₴" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            <button className="btn w-full">Додати послугу</button>
          </form>
          <div>
            {!services.length ? <Empty>Додайте першу послугу — вона з’явиться в каталозі.</Empty> : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-white">
                {services.map((s) => <li key={s.id} className="flex justify-between px-5 py-3 text-sm"><span>{s.title}</span><b>{money(s.price)}</b></li>)}
              </ul>)}
          </div>
        </div>)}
      {tab === "meetings" && <Meetings items={meetings} />}
      {tab === "chat" && <ChatPanel peers={peers} />}
    </Shell>
  );
}
