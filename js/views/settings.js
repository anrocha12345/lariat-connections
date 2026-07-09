// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Settings
// Space name, stats, CSV export (formula-injection safe), and sharing info.
// ─────────────────────────────────────────────────────────────────────────
import {
  COLLECTIONS, listBySpace, updateDoc, getActiveSpace, downloadCsv, escHtml, fmtDate, tsToDate,
} from "../data.js";
import { toast } from "../ui.js";

export async function mount({ content, ctx }) {
  content.innerHTML = `<div class="empty"><span class="spinner spinner--dark"></span> Loading…</div>`;

  const [people, companies, interactions, relationships] = await Promise.all([
    listBySpace(COLLECTIONS.people),
    listBySpace(COLLECTIONS.companies),
    listBySpace(COLLECTIONS.interactions),
    listBySpace(COLLECTIONS.relationships),
  ]);

  content.innerHTML = `
    <div class="stack" style="max-width:680px">
      <div class="card">
        <h3>Your space</h3>
        <p class="muted small" style="margin:6px 0 14px">This is your private network. Everything is locked to your account until you choose to share.</p>
        <div class="form-group"><label>Space name</label>
          <div class="row"><input id="spaceName" value="${escHtml(ctx.space.name || "")}"><button class="btn" id="saveSpace">Save</button></div></div>
        <div class="muted small">Signed in as <strong>${escHtml(ctx.user.email || "")}</strong></div>
      </div>

      <div class="card">
        <h3>At a glance</h3>
        <div class="grid grid--stats" style="margin-top:12px">
          <div class="stat"><div class="stat__num">${people.length}</div><div class="stat__label">People</div></div>
          <div class="stat"><div class="stat__num">${companies.length}</div><div class="stat__label">Companies</div></div>
          <div class="stat"><div class="stat__num">${interactions.length}</div><div class="stat__label">Interactions</div></div>
          <div class="stat"><div class="stat__num">${relationships.length}</div><div class="stat__label">Links</div></div>
        </div>
      </div>

      <div class="card">
        <h3>Export</h3>
        <p class="muted small" style="margin:6px 0 14px">Download your people as a spreadsheet (safe against CSV formula injection).</p>
        <button class="btn btn--ghost" id="exportPeople">⬇ Export people (CSV)</button>
      </div>

      <div class="card">
        <h3>Sharing <span class="badge">coming later</span></h3>
        <p class="muted small" style="margin-top:6px">Your data model is already multi-user ready: a space has members. When you want to share this
        network with a trusted friend, we add their account to this space — no migration needed. Or they start their own space.</p>
      </div>
    </div>`;

  content.querySelector("#saveSpace").onclick = async (e) => {
    const btn = e.target, name = content.querySelector("#spaceName").value.trim();
    btn.disabled = true;
    try { await updateDoc(COLLECTIONS.spaces, getActiveSpace(), { name }); toast("Saved"); }
    catch (err) { toast("Failed: " + err.message, true); }
    finally { btn.disabled = false; }
  };

  content.querySelector("#exportPeople").onclick = () => {
    const rows = [["Name", "Company", "Title", "Emails", "Phones", "Location", "Tags", "LinkedIn", "How we met", "Where we met", "Added"]];
    people.forEach((p) => rows.push([
      p.displayName || `${p.firstName || ""} ${p.lastName || ""}`.trim(),
      p.currentCompanyName || "", p.currentTitle || "",
      (p.emails || []).join("; "), (p.phones || []).join("; "),
      p.location || "", (p.tags || []).join("; "),
      p.linkedinUrl || "", p.howWeMet || "", p.metPlace || "",
      p.createdAt ? fmtDate(tsToDate(p.createdAt)) : "",
    ]));
    downloadCsv(`lariat-people-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast("Exported");
  };
}
