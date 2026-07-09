// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Calendar
// A custom month grid aggregating scheduled events, next-contact dates, future
// interactions, and recurring birthdays. (Built in-house instead of pulling
// FullCalendar over CDN — the aggregation is bespoke and this avoids the
// module/CSS friction of FullCalendar's ESM build.)
// ─────────────────────────────────────────────────────────────────────────
import {
  COLLECTIONS, watchBySpace, createDoc, deleteDoc, linkAttendees,
  escHtml, tsToDate,
} from "../data.js";
import { toast, openModal, confirmDialog } from "../ui.js";

let S = null;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function mount({ content, go }) {
  const now = new Date();
  S = { content, go, view: new Date(now.getFullYear(), now.getMonth(), 1),
        people: [], byId: {}, interactions: [], events: [], ready: 0 };
  const need = 3, bump = () => { if (++S.ready >= need) render(); };
  const unsubs = [
    watchBySpace(COLLECTIONS.people, (r) => { S.people = r; S.byId = Object.fromEntries(r.map((x) => [x.id, x])); bump(); }),
    watchBySpace(COLLECTIONS.interactions, (r) => { S.interactions = r; bump(); }),
    watchBySpace(COLLECTIONS.events, (r) => { S.events = r; bump(); }),
  ];
  return () => unsubs.forEach((u) => u && u());
}

function dn(p) { return p.displayName || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "?"; }
function keyOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

// Build a map: dateKey → [ {icon,label,color,personId?} ]
function buildItems(year, month) {
  const map = {};
  const add = (d, item) => { if (!d) return; const k = keyOf(d); (map[k] ||= []).push(item); };

  // Birthdays (recurring — placed in the displayed year)
  S.people.forEach((p) => {
    if (p.birthday && p.birthday.month)
      add(new Date(year, p.birthday.month - 1, p.birthday.day),
        { icon: "🎂", label: `${dn(p)}'s birthday`, color: "#B5623C", personId: p.id });
  });
  // Next contact dates
  S.people.forEach((p) => {
    const d = tsToDate(p.nextContactAt);
    if (d) add(d, { icon: "📌", label: `Contact ${dn(p)}`, color: "#2E5E4E", personId: p.id });
  });
  // Future / scheduled interactions
  const today = new Date(); today.setHours(0, 0, 0, 0);
  S.interactions.forEach((i) => {
    const d = tsToDate(i.occurredAt);
    if (d && d >= today) {
      const who = (i.personIds || []).map((x) => S.byId[x] && dn(S.byId[x])).filter(Boolean).join(", ");
      add(d, { icon: "🤝", label: `${i.type} · ${who}`, color: "#7A7268", personId: (i.personIds || [])[0] });
    }
  });
  // Events
  S.events.forEach((e) => {
    const d = tsToDate(e.startAt);
    add(d, { icon: e.type === "reminder" ? "⏰" : "🎉", label: e.title || "Event", color: "#C25E3C", eventId: e.id,
             personId: (e.attendeeIds || [])[0] });
  });
  return map;
}

function render() {
  const y = S.view.getFullYear(), m = S.view.getMonth();
  const items = buildItems(y, m);
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayKey = keyOf(new Date());

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));
  while (cells.length % 7) cells.push(null);

  S.content.innerHTML = `
    <div class="toolbar">
      <button class="btn btn--ghost btn--sm" id="prev">←</button>
      <button class="btn btn--ghost btn--sm" id="today">Today</button>
      <button class="btn btn--ghost btn--sm" id="next">→</button>
      <h2 style="font-size:1.3rem;margin:0 8px">${MONTHS[m]} ${y}</h2>
      <div class="toolbar__spacer"></div>
      <button class="btn" id="addEvent">＋ Add event</button>
    </div>
    <div class="card" style="padding:0">
      <div style="display:grid;grid-template-columns:repeat(7,1fr)">
        ${DOW.map((d) => `<div style="padding:8px;text-align:center;font-size:.72rem;font-weight:700;color:var(--text-light);text-transform:uppercase;border-bottom:1px solid var(--border)">${d}</div>`).join("")}
        ${cells.map((c) => cellHtml(c, items, todayKey)).join("")}
      </div>
    </div>`;

  S.content.querySelector("#prev").onclick = () => { S.view = new Date(y, m - 1, 1); render(); };
  S.content.querySelector("#next").onclick = () => { S.view = new Date(y, m + 1, 1); render(); };
  S.content.querySelector("#today").onclick = () => { const n = new Date(); S.view = new Date(n.getFullYear(), n.getMonth(), 1); render(); };
  S.content.querySelector("#addEvent").onclick = () => openEventModal();
  S.content.querySelectorAll("[data-goto]").forEach((el) => el.onclick = () => S.go("people", { id: el.dataset.goto }));
  S.content.querySelectorAll("[data-delevent]").forEach((el) => el.onclick = async (e) => {
    e.stopPropagation();
    if (await confirmDialog("Delete this event?", { danger: true, okLabel: "Delete" })) { await deleteDoc(COLLECTIONS.events, el.dataset.delevent); toast("Event deleted"); }
  });
}

function cellHtml(date, items, todayKey) {
  if (!date) return `<div style="min-height:96px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);background:var(--bg)"></div>`;
  const k = keyOf(date);
  const list = items[k] || [];
  const isToday = k === todayKey;
  return `<div style="min-height:96px;border-bottom:1px solid var(--border);border-right:1px solid var(--border);padding:5px 6px;${isToday ? "background:var(--accent-soft)" : ""}">
    <div style="font-size:.78rem;font-weight:${isToday ? 700 : 500};color:${isToday ? "var(--accent)" : "var(--text-light)"}">${date.getDate()}</div>
    ${list.map((it) => `<div title="${escHtml(it.label)}" ${it.personId ? `data-goto="${it.personId}"` : ""}
        style="cursor:${it.personId ? "pointer" : "default"};font-size:.72rem;margin-top:3px;padding:2px 5px;border-radius:5px;background:${it.color}18;color:${it.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;gap:3px;align-items:center">
        <span>${it.icon}</span><span style="overflow:hidden;text-overflow:ellipsis">${escHtml(it.label)}</span>
        ${it.eventId ? `<span data-delevent="${it.eventId}" style="margin-left:auto;opacity:.5">✕</span>` : ""}
      </div>`).join("")}
  </div>`;
}

function openEventModal() {
  const sel = new Set();
  const m = openModal(`
    <div class="modal__head"><h3>Add event</h3><button class="modal__close" data-x>×</button></div>
    <form id="evForm" class="stack">
      <div class="form-group"><label>Title</label><input name="title" required placeholder="Dinner, conference, reminder…"></div>
      <div class="form-row">
        <div class="form-group"><label>Date</label><input type="date" name="date" required value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="form-group"><label>Type</label><select name="type">
          <option value="event">🎉 Event</option><option value="meeting">🤝 Meeting</option><option value="reminder">⏰ Reminder</option></select></div>
      </div>
      <div class="form-group"><label>Place (optional)</label><input name="place"></div>
      <div class="form-group"><label>People (optional — 2+ get linked)</label>
        <input id="attFilter" placeholder="Filter…" style="margin-bottom:8px">
        <div id="attList" style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px"></div></div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn btn--ghost" data-x>Cancel</button>
        <button type="submit" class="btn" id="saveEv">Save</button></div>
    </form>`, { wide: true });

  const attList = m.root.querySelector("#attList"), attFilter = m.root.querySelector("#attFilter");
  const draw = () => {
    const q = attFilter.value.trim().toLowerCase();
    attList.innerHTML = S.people.filter((p) => !q || dn(p).toLowerCase().includes(q))
      .sort((a, b) => dn(a).localeCompare(dn(b)))
      .map((p) => `<label style="display:flex;gap:8px;align-items:center;font-weight:400;text-transform:none;padding:3px 0">
        <input type="checkbox" style="width:auto" value="${p.id}" ${sel.has(p.id) ? "checked" : ""}> ${escHtml(dn(p))}</label>`).join("") || '<p class="muted small">No people.</p>';
    attList.querySelectorAll("input").forEach((cb) => cb.onchange = () => cb.checked ? sel.add(cb.value) : sel.delete(cb.value));
  };
  attFilter.oninput = draw; draw();

  m.root.querySelectorAll("[data-x]").forEach((b) => b.onclick = m.close);
  m.root.querySelector("#evForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = m.root.querySelector("#saveEv");
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      const ids = [...sel];
      await createDoc(COLLECTIONS.events, {
        title: f.title.value.trim(), type: f.type.value, startAt: new Date(f.date.value),
        place: f.place.value.trim(), attendeeIds: ids, status: "scheduled",
      });
      if (ids.length >= 2) await linkAttendees(ids, { type: f.type.value === "meeting" ? "met_together" : "same_event", source: "inferred", context: f.title.value.trim() });
      toast("Event added"); m.close();
    } catch (err) { toast("Save failed: " + err.message, true); btn.disabled = false; btn.textContent = "Save"; }
  };
}
