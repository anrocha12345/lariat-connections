// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Network map
// Cytoscape graph of people (nodes). Relationships you log appear as edges.
// "Group by company" adds a hub node per company (≥2 contacts) with each
// contact linked to it — clean clusters (one edge per person, no giant cliques)
// so you immediately see "everyone I know at X". Person labels show on hover to
// keep large graphs readable. Plus a "may know each other" suggestion panel.
// ─────────────────────────────────────────────────────────────────────────
import cytoscape from "https://esm.sh/cytoscape@3.30.2";
import fcose from "https://esm.sh/cytoscape-fcose@2.2.0";
import { COLLECTIONS, watchBySpace, upsertRelationship, pairKey, escHtml } from "../data.js";
import { toast, colorFor } from "../ui.js";

cytoscape.use(fcose);

let S = null;

export function mount({ content, go }) {
  S = { content, go, people: [], byId: {}, relationships: [], ready: 0, cy: null,
        tag: "", company: "", groupByCompany: true };
  const need = 2, bump = () => { if (++S.ready >= need) render(); };
  const unsubs = [
    watchBySpace(COLLECTIONS.people, (r) => { S.people = r; S.byId = Object.fromEntries(r.map((x) => [x.id, x])); bump(); }),
    watchBySpace(COLLECTIONS.relationships, (r) => { S.relationships = r; bump(); }),
  ];
  return () => { unsubs.forEach((u) => u && u()); if (S.cy) { S.cy.destroy(); S.cy = null; } };
}

function dn(p) { return p.displayName || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "?"; }
function tagsList() { return [...new Set(S.people.flatMap((p) => p.tags || []))].sort(); }
function nodeColor(p) { return colorFor((p.tags && p.tags[0]) || p.currentCompanyName || dn(p)); }

// Companies with ≥2 contacts → [{id,name,count}] sorted by size
function companyGroups(people) {
  const m = new Map();
  people.forEach((p) => {
    if (!p.currentCompanyId) return;
    if (!m.has(p.currentCompanyId)) m.set(p.currentCompanyId, { id: p.currentCompanyId, name: p.currentCompanyName || "—", members: [] });
    m.get(p.currentCompanyId).members.push(p.id);
  });
  return [...m.values()].filter((g) => g.members.length >= 2).sort((a, b) => b.members.length - a.members.length);
}

function render() {
  const tags = tagsList();
  const allGroups = companyGroups(S.people);
  S.content.innerHTML = `
    <div class="toolbar">
      <select id="mapTag" style="max-width:180px"><option value="">All tags</option>
        ${tags.map((t) => `<option value="${escHtml(t)}" ${S.tag === t ? "selected" : ""}>${escHtml(t)}</option>`).join("")}</select>
      <select id="mapCompany" style="max-width:240px"><option value="">All companies</option>
        ${allGroups.map((g) => `<option value="${g.id}" ${S.company === g.id ? "selected" : ""}>${escHtml(g.name)} (${g.members.length})</option>`).join("")}</select>
      <label class="row small" style="text-transform:none;font-weight:500;gap:5px"><input type="checkbox" id="grpChk" style="width:auto" ${S.groupByCompany ? "checked" : ""}> Group by company</label>
      <button class="btn btn--ghost btn--sm" id="fitBtn">Fit</button>
      <button class="btn btn--ghost btn--sm" id="relayoutBtn">Re-layout</button>
      <div class="toolbar__spacer"></div>
      <span class="muted small" id="mapStat"></span>
    </div>
    <div class="grid" style="grid-template-columns:1fr 300px;align-items:start">
      <div class="card" style="padding:0;overflow:hidden">
        <div id="cy" style="height:calc(100vh - 210px);min-height:440px;background:var(--surface)"></div>
      </div>
      <div class="card" id="suggestPanel"></div>
    </div>`;

  // Apply filters
  let visible = S.people;
  if (S.tag) visible = visible.filter((p) => (p.tags || []).includes(S.tag));
  if (S.company) visible = visible.filter((p) => p.currentCompanyId === S.company);
  const visIds = new Set(visible.map((p) => p.id));

  const el = S.content.querySelector("#cy");
  const stat = S.content.querySelector("#mapStat");

  if (!visible.length) {
    el.innerHTML = `<div class="empty"><div class="empty__icon">🕸️</div><h2>No one to map</h2>
      <p class="muted">Adjust the filters, or add people and log meetings.</p></div>`;
    stat.textContent = "";
  } else {
    const groups = S.groupByCompany ? companyGroups(visible) : [];
    const groupIds = new Set(groups.map((g) => g.id));

    const elements = [];
    visible.forEach((p) => elements.push({ data: { id: p.id, label: dn(p), color: nodeColor(p) }, classes: "person" }));

    if (S.groupByCompany) {
      groups.forEach((g) => {
        elements.push({ data: { id: "co_" + g.id, label: g.name }, classes: "company" });
        g.members.forEach((pid) => elements.push({ data: { source: pid, target: "co_" + g.id }, classes: "colleague" }));
      });
    }
    // Real relationships you've logged
    S.relationships
      .filter((r) => visIds.has(r.personA) && visIds.has(r.personB))
      .forEach((r) => elements.push({ data: { id: r.id, source: r.personA, target: r.personB, w: 1 + Math.min(r.weight || 1, 5) }, classes: "rel" }));

    if (S.cy) S.cy.destroy();
    S.cy = cytoscape({
      container: el,
      elements,
      style: [
        { selector: "node.person", style: {
          "background-color": "data(color)", width: 20, height: 20,
          "border-width": 2, "border-color": "#fff", label: "",
        } },
        { selector: "node.person.hl, node.person:selected", style: {
          label: "data(label)", "font-size": 11, color: "#2A2723", "font-family": "Inter, sans-serif",
          "text-valign": "bottom", "text-margin-y": 3, "z-index": 99,
          "text-background-color": "#fff", "text-background-opacity": 0.85, "text-background-padding": 2,
        } },
        { selector: "node.company", style: {
          shape: "round-rectangle", "background-color": "#2E5E4E", label: "data(label)",
          "font-size": 11, "font-weight": "bold", color: "#fff", "text-valign": "center", "text-wrap": "wrap",
          "text-max-width": 90, width: 30, height: 30, padding: 6, "font-family": "Inter, sans-serif",
        } },
        { selector: "edge.colleague", style: { width: 1, "line-color": "#CFC0AE", opacity: 0.5, "curve-style": "haystack" } },
        { selector: "edge.rel", style: { width: "data(w)", "line-color": "#C25E3C", opacity: 0.85, "curve-style": "bezier" } },
      ],
      layout: { name: "fcose", quality: "default", animate: false, nodeRepulsion: 5500, idealEdgeLength: 70, packComponents: true },
    });
    S.cy.on("tap", "node.person", (e) => S.go("people", { id: e.target.id() }));
    S.cy.on("mouseover", "node.person", (e) => e.target.addClass("hl"));
    S.cy.on("mouseout", "node.person", (e) => e.target.removeClass("hl"));

    stat.textContent = `${visible.length} shown · ${groups.length} company clusters · ${S.relationships.length} logged links`;
  }

  renderSuggestions();

  S.content.querySelector("#mapTag").onchange = (e) => { S.tag = e.target.value; render(); };
  S.content.querySelector("#mapCompany").onchange = (e) => { S.company = e.target.value; render(); };
  S.content.querySelector("#grpChk").onchange = (e) => { S.groupByCompany = e.target.checked; render(); };
  S.content.querySelector("#fitBtn").onclick = () => S.cy && S.cy.fit(undefined, 40);
  S.content.querySelector("#relayoutBtn").onclick = () => S.cy && S.cy.layout({ name: "fcose", animate: true }).run();
}

// Shared-connection heuristic on your *logged* relationships.
function renderSuggestions() {
  const panel = S.content.querySelector("#suggestPanel");
  const adj = new Map();
  const linked = new Set(S.relationships.map((r) => pairKey(r.personA, r.personB)));
  S.relationships.forEach((r) => {
    if (!adj.has(r.personA)) adj.set(r.personA, new Set());
    if (!adj.has(r.personB)) adj.set(r.personB, new Set());
    adj.get(r.personA).add(r.personB); adj.get(r.personB).add(r.personA);
  });
  const seen = new Set(), suggestions = [];
  for (const [a, na] of adj) {
    for (const mid of na) {
      for (const b of (adj.get(mid) || [])) {
        if (a === b) continue;
        const key = pairKey(a, b);
        if (linked.has(key) || seen.has(key)) continue;
        const shared = [...na].filter((x) => (adj.get(b) || new Set()).has(x));
        if (shared.length >= 2 && S.byId[a] && S.byId[b]) { seen.add(key); suggestions.push({ a, b, shared: shared.length }); }
      }
    }
  }
  suggestions.sort((x, y) => y.shared - x.shared);
  panel.innerHTML = `<h3 style="font-size:1.05rem">May know each other</h3>
    <p class="muted small" style="margin:4px 0 12px">Pairs with mutual logged connections but no link yet.</p>
    ${suggestions.length ? suggestions.slice(0, 15).map((s) => `
      <div class="spread" style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div class="small">${escHtml(dn(S.byId[s.a]))} ↔ ${escHtml(dn(S.byId[s.b]))}
          <div class="muted" style="font-size:.72rem">${s.shared} mutual</div></div>
        <button class="btn btn--sm btn--ghost" data-link="${s.a}|${s.b}">Link</button>
      </div>`).join("") : '<p class="muted small">No suggestions yet. Log who you meet together, and links will grow here.</p>'}`;
  panel.querySelectorAll("[data-link]").forEach((btn) => btn.onclick = async () => {
    const [a, b] = btn.dataset.link.split("|");
    btn.disabled = true; btn.textContent = "…";
    try { await upsertRelationship(a, b, { type: "met_together", source: "confirmed", context: "Confirmed from suggestion" }); toast("Linked"); }
    catch (err) { toast("Failed: " + err.message, true); btn.disabled = false; btn.textContent = "Link"; }
  });
}
