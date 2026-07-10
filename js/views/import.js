// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Import
//  • Connections.csv → people + companies + current experiences (deduped by URL)
//  • messages.csv    → back-fill "last contact" per person by matching the
//    conversation's profile URLs (one summarised interaction per person).
// ─────────────────────────────────────────────────────────────────────────
import Papa from "https://esm.sh/papaparse@5.4.1";
import {
  COLLECTIONS, listBySpace, bulkCreate, updateDoc, where,
  canonicalLinkedinUrl, normalizeCompany, dedupeKey, personDedupeKey, escHtml, fmtDate, tsToDate,
} from "../data.js";
import { toast } from "../ui.js";

export function mount({ content }) {
  content.innerHTML = `
    <div class="stack" style="max-width:780px">
      <div class="card">
        <h3>1 · Connections</h3>
        <ol class="muted small" style="margin:12px 0 16px 18px;line-height:1.8">
          <li>LinkedIn → <strong>Settings &amp; Privacy → Data privacy → Get a copy of your data → Connections</strong>.</li>
          <li>Drop the <code>Connections.csv</code> below. Re-importing is safe — duplicates (same profile URL) are skipped.</li>
        </ol>
        <input type="file" id="connFile" accept=".csv,text/csv">
        <div id="connPreview" style="margin-top:16px"></div>
      </div>

      <div class="card">
        <h3>2 · Messages <span class="badge">optional</span></h3>
        <p class="muted small" style="margin:8px 0 14px">
          Drop <code>messages.csv</code> from the same LinkedIn export. Lariat matches each conversation to
          people by profile URL and back-fills <strong>"last contact"</strong> (date + message count) — no message text is stored.
          Import your connections first.
        </p>
        <input type="file" id="msgFile" accept=".csv,text/csv">
        <div id="msgPreview" style="margin-top:16px"></div>
      </div>
    </div>`;

  wireConnections(content.querySelector("#connFile"), content.querySelector("#connPreview"));
  wireMessages(content.querySelector("#msgFile"), content.querySelector("#msgPreview"));
}

function readFile(input, cb) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => cb(reader.result);
  reader.readAsText(file);
}
const pick = (row, ...keys) => {
  for (const k of Object.keys(row)) if (keys.some((w) => k.trim().toLowerCase() === w)) return (row[k] || "").trim();
  return "";
};

// ── Connections ───────────────────────────────────────────────────────────
function wireConnections(input, preview) {
  let parsed = [], existing = null;
  input.onchange = () => readFile(input, async (text) => {
    preview.innerHTML = `<span class="spinner spinner--dark"></span> Reading…`;
    const lines = text.split(/\r?\n/);
    const headerIdx = lines.findIndex((l) => /first name/i.test(l) && /url/i.test(l));
    const body = (headerIdx >= 0 ? lines.slice(headerIdx) : lines).join("\n");
    const res = Papa.parse(body, { header: true, skipEmptyLines: true });
    parsed = res.data.map((r) => ({
      firstName: pick(r, "first name"), lastName: pick(r, "last name"),
      url: pick(r, "url"), email: pick(r, "email address", "email"),
      company: pick(r, "company"), position: pick(r, "position"), connectedOn: pick(r, "connected on"),
    })).filter((r) => r.firstName || r.lastName || r.url);

    const [people, companies] = await Promise.all([listBySpace(COLLECTIONS.people), listBySpace(COLLECTIONS.companies)]);
    existing = {
      keys: new Set(people.map(personDedupeKey).filter(Boolean)),
      companyMap: new Map(companies.map((c) => [c.normalizedName, c.id])),
    };
    // Dedupe against what's already imported AND within this file. URL-less rows
    // fall back to name+company+email so they don't re-import as duplicates.
    const seen = new Set();
    const news = [];
    for (const r of parsed) {
      const k = dedupeKey({ linkedinUrl: r.url, name: `${r.firstName} ${r.lastName}`, company: r.company, email: r.email });
      if (k && (existing.keys.has(k) || seen.has(k))) continue;
      if (k) seen.add(k);
      news.push(r);
    }
    const dups = parsed.length - news.length;

    preview.innerHTML = `
      <div class="grid grid--stats" style="margin-bottom:14px">
        <div class="stat"><div class="stat__num">${parsed.length}</div><div class="stat__label">Rows</div></div>
        <div class="stat"><div class="stat__num">${news.length}</div><div class="stat__label">New</div></div>
        <div class="stat"><div class="stat__num">${dups}</div><div class="stat__label">Already in</div></div>
      </div>
      ${news.length ? `<button class="btn" id="doImport">Import ${news.length} ${news.length === 1 ? "person" : "people"}</button>` : '<p class="muted">Nothing new to import.</p>'}`;
    const btn = preview.querySelector("#doImport");
    if (btn) btn.onclick = () => runConnections(news, existing, btn);
  });
}

async function runConnections(news, existing, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing…';
  try {
    const map = existing.companyMap, toCreate = [];
    for (const r of news) {
      const norm = normalizeCompany(r.company);
      if (norm && !map.has(norm) && !toCreate.find((c) => c.normalizedName === norm))
        toCreate.push({ name: r.company.trim(), normalizedName: norm });
    }
    const newCoIds = await bulkCreate(COLLECTIONS.companies, toCreate);
    toCreate.forEach((c, i) => map.set(c.normalizedName, newCoIds[i]));

    const peopleDocs = news.map((r) => {
      const norm = normalizeCompany(r.company);
      return {
        firstName: r.firstName, lastName: r.lastName, displayName: `${r.firstName} ${r.lastName}`.trim(),
        linkedinUrl: canonicalLinkedinUrl(r.url), emails: r.email ? [r.email] : [], phones: [], tags: [], location: "",
        currentCompanyName: r.company.trim(), currentCompanyId: norm ? map.get(norm) || null : null,
        currentTitle: r.position, howWeMet: "", metPlace: "", birthday: null, nextContactAt: null,
        source: "linkedin", connectedOn: r.connectedOn || "",
      };
    });
    const personIds = await bulkCreate(COLLECTIONS.people, peopleDocs);
    const exps = [];
    peopleDocs.forEach((p, i) => { if (p.currentCompanyId) exps.push({ personId: personIds[i], companyId: p.currentCompanyId, companyName: p.currentCompanyName, title: p.currentTitle || "", startDate: null, endDate: null }); });
    await bulkCreate(COLLECTIONS.experiences, exps);
    toast(`Imported ${personIds.length} people`);
    btn.textContent = `✓ Imported ${personIds.length}`;
  } catch (err) { console.error(err); toast("Import failed: " + err.message, true); btn.disabled = false; btn.textContent = "Retry import"; }
}

// ── Messages (last-contact back-fill) ───────────────────────────────────────
function wireMessages(input, preview) {
  let agg = null; // personId → { count, maxDate }
  input.onchange = () => readFile(input, async (text) => {
    preview.innerHTML = `<span class="spinner spinner--dark"></span> Matching conversations…`;
    const res = Papa.parse(text, { header: true, skipEmptyLines: true });

    const people = await listBySpace(COLLECTIONS.people);
    const urlToId = new Map();
    people.forEach((p) => { const u = canonicalLinkedinUrl(p.linkedinUrl); if (u) urlToId.set(u, p.id); });
    if (!urlToId.size) { preview.innerHTML = `<p class="muted">Import your connections first, then messages can match to them.</p>`; return; }

    agg = new Map();
    let matchedMsgs = 0;
    res.data.forEach((row) => {
      if (["true", "yes"].includes(String(pick(row, "is message draft")).toLowerCase())) return;
      const date = new Date(pick(row, "date"));
      if (isNaN(date)) return;
      const urls = [pick(row, "sender profile url"), ...pick(row, "recipient profile urls").split(/[\s,;]+/)]
        .map(canonicalLinkedinUrl).filter(Boolean);
      const ids = new Set(urls.map((u) => urlToId.get(u)).filter(Boolean));
      if (ids.size) matchedMsgs++;
      ids.forEach((id) => {
        const cur = agg.get(id) || { count: 0, maxDate: null };
        cur.count++; if (!cur.maxDate || date > cur.maxDate) cur.maxDate = date;
        agg.set(id, cur);
      });
    });

    preview.innerHTML = `
      <div class="grid grid--stats" style="margin-bottom:14px">
        <div class="stat"><div class="stat__num">${res.data.length}</div><div class="stat__label">Messages in file</div></div>
        <div class="stat"><div class="stat__num">${matchedMsgs}</div><div class="stat__label">Matched to people</div></div>
        <div class="stat"><div class="stat__num">${agg.size}</div><div class="stat__label">People to update</div></div>
      </div>
      ${agg.size ? `<button class="btn" id="doMsg">Back-fill ${agg.size} people</button>` : '<p class="muted">No conversations matched your contacts.</p>'}`;
    const btn = preview.querySelector("#doMsg");
    if (btn) btn.onclick = () => runMessages(agg, btn);
  });
}

async function runMessages(agg, btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Updating…';
  try {
    // Existing summary interactions from a previous run → update instead of duplicate.
    const existing = await listBySpace(COLLECTIONS.interactions, where("source", "==", "linkedin_messages"));
    const byPerson = new Map();
    existing.forEach((i) => { const pid = (i.personIds || [])[0]; if (pid) byPerson.set(pid, i.id); });

    const toCreate = [];
    let updated = 0;
    for (const [pid, { count, maxDate }] of agg) {
      const data = {
        type: "linkedin_message", occurredAt: maxDate,
        notes: `${count} LinkedIn message${count === 1 ? "" : "s"} · last on ${fmtDate(maxDate)}`,
      };
      if (byPerson.has(pid)) { await updateDoc(COLLECTIONS.interactions, byPerson.get(pid), data); updated++; }
      else toCreate.push({ personIds: [pid], place: "", source: "linkedin_messages", ...data });
    }
    await bulkCreate(COLLECTIONS.interactions, toCreate);
    toast(`Back-filled ${agg.size} people`);
    btn.textContent = `✓ Updated ${agg.size} (${toCreate.length} new, ${updated} refreshed)`;
  } catch (err) { console.error(err); toast("Back-fill failed: " + err.message, true); btn.disabled = false; btn.textContent = "Retry"; }
}
