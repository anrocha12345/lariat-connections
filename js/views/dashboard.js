// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Dashboard
// At-a-glance: overdue follow-ups, what's coming up, birthdays, recent additions.
// ─────────────────────────────────────────────────────────────────────────
import { COLLECTIONS, watchBySpace, escHtml, fmtDate, tsToDate } from "../data.js";
import { avatarHtml } from "../ui.js";

let S = null;

export function mount({ content, go }) {
  S = { content, go, people: [], byId: {}, interactions: [], events: [], ready: 0 };
  const need = 3, bump = () => { if (++S.ready >= need) render(); };
  const unsubs = [
    watchBySpace(COLLECTIONS.people, (r) => { S.people = r; S.byId = Object.fromEntries(r.map((x) => [x.id, x])); bump(); }),
    watchBySpace(COLLECTIONS.interactions, (r) => { S.interactions = r; bump(); }),
    watchBySpace(COLLECTIONS.events, (r) => { S.events = r; bump(); }),
  ];
  return () => unsubs.forEach((u) => u && u());
}

function dn(p) { return p.displayName || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "?"; }
const DAY = 864e5;

function render() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const today = now.getTime();

  // Overdue follow-ups
  const overdue = S.people
    .map((p) => ({ p, d: tsToDate(p.nextContactAt) }))
    .filter((x) => x.d && x.d.getTime() < today)
    .sort((a, b) => a.d - b.d);

  // Upcoming (next contacts + events + birthdays) within 60 days
  const horizon = today + 60 * DAY;
  const up = [];
  S.people.forEach((p) => {
    const d = tsToDate(p.nextContactAt);
    if (d && d.getTime() >= today && d.getTime() <= horizon)
      up.push({ date: d, icon: "📌", label: `Contact ${dn(p)}`, personId: p.id });
    if (p.birthday && p.birthday.month) {
      let bd = new Date(now.getFullYear(), p.birthday.month - 1, p.birthday.day);
      if (bd.getTime() < today) bd = new Date(now.getFullYear() + 1, p.birthday.month - 1, p.birthday.day);
      if (bd.getTime() <= horizon) up.push({ date: bd, icon: "🎂", label: `${dn(p)}'s birthday`, personId: p.id });
    }
  });
  S.events.forEach((e) => {
    const d = tsToDate(e.startAt);
    if (d && d.getTime() >= today && d.getTime() <= horizon)
      up.push({ date: d, icon: "🎉", label: e.title || "Event", personId: (e.attendeeIds || [])[0] });
  });
  up.sort((a, b) => a.date - b.date);

  // Recent additions
  const recent = [...S.people].sort((a, b) => (tsToDate(b.createdAt) || 0) - (tsToDate(a.createdAt) || 0)).slice(0, 6);

  // Stats
  const monthAgo = Date.now() - 30 * DAY;
  const touchesThisMonth = S.interactions.filter((i) => (tsToDate(i.occurredAt) || 0) >= monthAgo).length;

  S.content.innerHTML = `
    <div class="grid grid--stats" style="margin-bottom:22px">
      ${stat(S.people.length, "People")}
      ${stat(overdue.length, "Overdue follow-ups")}
      ${stat(up.filter((u) => u.date.getTime() <= today + 7 * DAY).length, "Next 7 days")}
      ${stat(touchesThisMonth, "Touches this month")}
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;align-items:start">
      <div class="card">
        <h3 style="font-size:1.1rem">⚠ Overdue follow-ups</h3>
        <div class="stack" style="margin-top:12px">
          ${overdue.length ? overdue.slice(0, 8).map(({ p, d }) => personRow(p,
            `<span class="badge badge--warn">${Math.round((today - d.getTime()) / DAY)}d overdue</span>`)).join("")
            : '<p class="muted small">Nothing overdue. Nice.</p>'}
        </div>
      </div>
      <div class="card">
        <h3 style="font-size:1.1rem">🗓️ Coming up</h3>
        <div class="stack" style="margin-top:12px">
          ${up.length ? up.slice(0, 8).map((u) => `<div class="spread ${u.personId ? "row-click" : ""}" ${u.personId ? `data-goto="${u.personId}"` : ""} style="${u.personId ? "cursor:pointer" : ""}">
              <div class="row"><span>${u.icon}</span><span>${escHtml(u.label)}</span></div>
              <span class="muted small">${fmtDate(u.date)}</span></div>`).join("")
            : '<p class="muted small">Nothing scheduled. Add a next-contact date or event.</p>'}
        </div>
      </div>
      <div class="card">
        <h3 style="font-size:1.1rem">✨ Recently added</h3>
        <div class="stack" style="margin-top:12px">
          ${recent.length ? recent.map((p) => personRow(p, `<span class="muted small">${fmtDate(p.createdAt)}</span>`)).join("")
            : '<p class="muted small">No people yet — import LinkedIn or add someone.</p>'}
        </div>
      </div>
      <div class="card">
        <h3 style="font-size:1.1rem">Quick actions</h3>
        <div class="stack" style="margin-top:12px">
          <a class="btn btn--ghost btn--block" href="#people">👤 Browse people</a>
          <a class="btn btn--ghost btn--block" href="#import">📥 Import LinkedIn</a>
          <a class="btn btn--ghost btn--block" href="#map">🕸️ Explore the map</a>
        </div>
      </div>
    </div>`;

  S.content.querySelectorAll("[data-goto]").forEach((el) => el.onclick = () => S.go("people", { id: el.dataset.goto }));
}

function stat(num, label) {
  return `<div class="card stat"><div class="stat__num">${num}</div><div class="stat__label">${escHtml(label)}</div></div>`;
}
function personRow(p, right) {
  return `<div class="spread row-click" data-goto="${p.id}" style="cursor:pointer">
    <div class="row">${avatarHtml(p)}<div><div style="font-weight:600">${escHtml(dn(p))}</div>
      <div class="muted small">${escHtml(p.currentCompanyName || "")}</div></div></div>${right || ""}</div>`;
}
