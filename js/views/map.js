// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Network map
// Cytoscape graph of people (nodes) and relationships (edges), with a
// "people who may know each other" panel (shared-connection heuristic) that
// lets you confirm new edges — the foundation for future social bubbles.
// ─────────────────────────────────────────────────────────────────────────
import cytoscape from "https://esm.sh/cytoscape@3.30.2";
import fcose from "https://esm.sh/cytoscape-fcose@2.2.0";
import { COLLECTIONS, watchBySpace, upsertRelationship, pairKey, escHtml } from "../data.js";
import { toast, colorFor } from "../ui.js";

cytoscape.use(fcose);

let S = null;

export function mount({ content, go }) {
  S = { content, go, people: [], byId: {}, relationships: [], ready: 0, cy: null, tag: "" };
  const need = 2, bump = () => { if (++S.ready >= need) render(); };
  const unsubs = [
    watchBySpace(COLLECTIONS.people, (r) => { S.people = r; S.byId = Object.fromEntries(r.map((x) => [x.id, x])); bump(); }),
    watchBySpace(COLLECTIONS.relationships, (r) => { S.relationships = r; bump(); }),
  ];
  return () => { unsubs.forEach((u) => u && u()); if (S.cy) S.cy.destroy(); };
}

function dn(p) { return p.displayName || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "?"; }
function tagsList() { return [...new Set(S.people.flatMap((p) => p.tags || []))].sort(); }
function nodeColor(p) { return colorFor((p.tags && p.tags[0]) || p.currentCompanyName || dn(p)); }

function render() {
  const tags = tagsList();
  S.content.innerHTML = `
    <div class="toolbar">
      <select id="mapTag" style="max-width:220px"><option value="">All tags</option>
        ${tags.map((t) => `<option value="${escHtml(t)}" ${S.tag === t ? "selected" : ""}>${escHtml(t)}</option>`).join("")}</select>
      <button class="btn btn--ghost btn--sm" id="fitBtn">Fit</button>
      <button class="btn btn--ghost btn--sm" id="relayoutBtn">Re-layout</button>
      <div class="toolbar__spacer"></div>
      <span class="muted small">${S.people.length} people · ${S.relationships.length} links</span>
    </div>
    <div class="grid" style="grid-template-columns:1fr 300px;align-items:start">
      <div class="card" style="padding:0;overflow:hidden">
        <div id="cy" style="height:calc(100vh - 210px);min-height:420px;background:var(--surface)"></div>
      </div>
      <div class="card" id="suggestPanel"></div>
    </div>`;

  const el = S.content.querySelector("#cy");
  const visible = S.people.filter((p) => !S.tag || (p.tags || []).includes(S.tag));
  const visIds = new Set(visible.map((p) => p.id));

  if (!visible.length) {
    el.innerHTML = `<div class="empty"><div class="empty__icon">🕸️</div><h2>No one to map yet</h2>
      <p class="muted">Add people and log meetings together to grow the web.</p></div>`;
  } else {
    const elements = [
      ...visible.map((p) => ({ data: { id: p.id, label: dn(p), color: nodeColor(p) } })),
      ...S.relationships
        .filter((r) => visIds.has(r.personA) && visIds.has(r.personB))
        .map((r) => ({ data: { id: r.id, source: r.personA, target: r.personB, w: 1 + Math.min(r.weight || 1, 6) } })),
    ];
    if (S.cy) S.cy.destroy();
    S.cy = cytoscape({
      container: el,
      elements,
      style: [
        { selector: "node", style: {
          "background-color": "data(color)", label: "data(label)", color: "#2A2723",
          "font-size": 10, "font-family": "Inter, sans-serif", "text-margin-y": 4,
          "text-valign": "bottom", width: 26, height: 26, "border-width": 2, "border-color": "#fff",
        } },
        { selector: "edge", style: {
          width: "data(w)", "line-color": "#D9C9B8", "curve-style": "bezier", opacity: 0.7,
        } },
        { selector: "node:selected", style: { "border-color": "#C25E3C", "border-width": 3 } },
      ],
      layout: { name: "fcose", quality: "default", animate: false, nodeRepulsion: 6000, idealEdgeLength: 90 },
    });
    S.cy.on("tap", "node", (evt) => S.go("people", { id: evt.target.id() }));
  }

  renderSuggestions();

  S.content.querySelector("#mapTag").onchange = (e) => { S.tag = e.target.value; render(); };
  S.content.querySelector("#fitBtn").onclick = () => S.cy && S.cy.fit(undefined, 40);
  S.content.querySelector("#relayoutBtn").onclick = () => S.cy && S.cy.layout({ name: "fcose", animate: true }).run();
}

// Shared-connection heuristic: pairs not yet linked that share ≥2 mutual
// connections are surfaced as "may know each other".
function renderSuggestions() {
  const panel = S.content.querySelector("#suggestPanel");
  const adj = new Map(); // id → Set(neighbourId)
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
        if (shared.length >= 2 && S.byId[a] && S.byId[b]) {
          seen.add(key);
          suggestions.push({ a, b, shared: shared.length });
        }
      }
    }
  }
  suggestions.sort((x, y) => y.shared - x.shared);

  panel.innerHTML = `<h3 style="font-size:1.05rem">May know each other</h3>
    <p class="muted small" style="margin:4px 0 12px">Pairs with mutual connections but no link yet.</p>
    ${suggestions.length ? suggestions.slice(0, 15).map((s) => `
      <div class="spread" style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div class="small">${escHtml(dn(S.byId[s.a]))} ↔ ${escHtml(dn(S.byId[s.b]))}
          <div class="muted" style="font-size:.72rem">${s.shared} mutual</div></div>
        <button class="btn btn--sm btn--ghost" data-link="${s.a}|${s.b}">Link</button>
      </div>`).join("") : '<p class="muted small">No suggestions yet. Keep logging who you meet together.</p>'}`;

  panel.querySelectorAll("[data-link]").forEach((btn) => btn.onclick = async () => {
    const [a, b] = btn.dataset.link.split("|");
    btn.disabled = true; btn.textContent = "…";
    try { await upsertRelationship(a, b, { type: "met_together", source: "confirmed", context: "Confirmed from suggestion" }); toast("Linked"); }
    catch (err) { toast("Failed: " + err.message, true); btn.disabled = false; btn.textContent = "Link"; }
  });
}
