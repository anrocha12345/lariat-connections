// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Companies lookup
// Search a company → current employees, past employees, and 1-hop connections
// (people you know who are linked to someone at that company).
// ─────────────────────────────────────────────────────────────────────────
import { COLLECTIONS, watchBySpace, escHtml, tsToDate, fmtDate } from "../data.js";
import { avatarHtml } from "../ui.js";

let S = null;

export function mount({ content, go }) {
  S = { content, go, companies: [], people: [], byId: {}, experiences: [], relationships: [], ready: 0 };
  const need = 4, bump = () => { if (++S.ready >= need) render(); };
  const unsubs = [
    watchBySpace(COLLECTIONS.companies, (r) => { S.companies = r; bump(); }),
    watchBySpace(COLLECTIONS.people, (r) => { S.people = r; S.byId = Object.fromEntries(r.map((x) => [x.id, x])); bump(); }),
    watchBySpace(COLLECTIONS.experiences, (r) => { S.experiences = r; bump(); }),
    watchBySpace(COLLECTIONS.relationships, (r) => { S.relationships = r; bump(); }),
  ];

  function render() {
    const [, id] = location.hash.replace("#", "").split("/");
    if (id && S.companies.find((c) => c.id === id)) renderDetail(id);
    else renderList();
  }
  S.render = render;
  return () => unsubs.forEach((u) => u && u());
}

function dn(p) { return p.displayName || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "(no name)"; }
function empsOf(companyId) { return S.experiences.filter((e) => e.companyId === companyId); }

function renderList() {
  S.content.innerHTML = `
    <div class="toolbar">
      <input class="search-input" id="coSearch" placeholder="Search a company…">
      <div class="toolbar__spacer"></div>
      <span class="muted small">${S.companies.length} companies</span>
    </div>
    <div class="card table-scroll" style="padding:0" id="coWrap"></div>`;
  const wrap = S.content.querySelector("#coWrap");
  const search = S.content.querySelector("#coSearch");

  function draw() {
    const q = search.value.trim().toLowerCase();
    let rows = S.companies.filter((c) => !q || (c.name || "").toLowerCase().includes(q));
    rows = rows.map((c) => {
      const es = empsOf(c.id);
      return { ...c, current: es.filter((e) => !e.endDate).length, past: es.filter((e) => e.endDate).length };
    }).sort((a, b) => (b.current - a.current) || (a.name || "").localeCompare(b.name || ""));

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty"><div class="empty__icon">🏢</div>
        <h2>${S.companies.length ? "No matches" : "No companies yet"}</h2>
        <p class="muted">${S.companies.length ? "Try another name." : "Companies appear as you add people or import LinkedIn."}</p></div>`;
      return;
    }
    wrap.innerHTML = `<table><thead><tr><th>Company</th><th>Current</th><th>Past</th></tr></thead>
      <tbody>${rows.map((c) => `<tr class="row-click" data-id="${c.id}">
        <td style="font-weight:600">${escHtml(c.name)}</td>
        <td>${c.current || "—"}</td><td>${c.past || "—"}</td></tr>`).join("")}</tbody></table>`;
    wrap.querySelectorAll("tr[data-id]").forEach((tr) => tr.onclick = () => S.go("companies", { id: tr.dataset.id }));
  }
  search.oninput = draw; draw();
}

function renderDetail(id) {
  const co = S.companies.find((c) => c.id === id);
  const es = empsOf(id);
  const current = es.filter((e) => !e.endDate).map((e) => ({ ...e, p: S.byId[e.personId] })).filter((e) => e.p);
  const past = es.filter((e) => e.endDate).map((e) => ({ ...e, p: S.byId[e.personId] })).filter((e) => e.p);

  // 1-hop connections: people linked to an employee who aren't employees themselves.
  const empIds = new Set(es.map((e) => e.personId));
  const connMap = new Map(); // otherId → Set(employeeName)
  S.relationships.forEach((r) => {
    const pair = [[r.personA, r.personB], [r.personB, r.personA]];
    for (const [a, b] of pair) {
      if (empIds.has(a) && !empIds.has(b) && S.byId[b]) {
        if (!connMap.has(b)) connMap.set(b, new Set());
        if (S.byId[a]) connMap.get(b).add(dn(S.byId[a]));
      }
    }
  });

  const personLink = (p, sub) => `<div class="spread row-click" data-goto="${p.id}" style="cursor:pointer;padding:6px 0">
    <div class="row">${avatarHtml(p)}<div><div style="font-weight:600">${escHtml(dn(p))}</div>
      <div class="muted small">${escHtml(sub || "")}</div></div></div></div>`;

  S.content.innerHTML = `
    <a class="small muted" href="#companies">← All companies</a>
    <h2 style="font-size:1.6rem;margin:12px 0 4px">${escHtml(co ? co.name : "Company")}</h2>
    <p class="muted small" style="margin-bottom:18px">${current.length} current · ${past.length} past · ${connMap.size} connection${connMap.size === 1 ? "" : "s"}</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">
      <div class="card"><h3 style="font-size:1.05rem">Works here now</h3>
        <div style="margin-top:8px">${current.length ? current.map((e) => personLink(e.p, e.title)).join("") : '<p class="muted small">No one currently.</p>'}</div></div>
      <div class="card"><h3 style="font-size:1.05rem">Worked here before</h3>
        <div style="margin-top:8px">${past.length ? past.map((e) => personLink(e.p, `${e.title || ""}${e.endDate ? " · until " + fmtDate(e.endDate) : ""}`)).join("") : '<p class="muted small">No past employees recorded.</p>'}</div></div>
      <div class="card"><h3 style="font-size:1.05rem">Connected to someone here</h3>
        <div style="margin-top:8px">${connMap.size ? [...connMap].map(([oid, via]) => personLink(S.byId[oid], "via " + [...via].join(", "))).join("") : '<p class="muted small">No indirect connections yet.</p>'}</div></div>
    </div>`;

  S.content.querySelectorAll("[data-goto]").forEach((el) => el.onclick = () => S.go("people", { id: el.dataset.goto }));
}
