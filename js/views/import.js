// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — LinkedIn import
// Parses a LinkedIn "Connections.csv" (handling its Notes preamble), previews
// new vs duplicate rows, and imports people + companies + current experiences.
// ─────────────────────────────────────────────────────────────────────────
import Papa from "https://esm.sh/papaparse@5.4.1";
import {
  COLLECTIONS, listBySpace, bulkCreate,
  canonicalLinkedinUrl, normalizeCompany, escHtml,
} from "../data.js";
import { toast } from "../ui.js";

export function mount({ content }) {
  let parsed = [];   // cleaned rows from the CSV
  let existing = null; // { urls:Set, companyMap:Map<normalized,id> }

  content.innerHTML = `
    <div class="card" style="max-width:760px">
      <h3>Import LinkedIn connections</h3>
      <ol class="muted small" style="margin:12px 0 18px 18px;line-height:1.8">
        <li>On LinkedIn: <strong>Settings &amp; Privacy → Data privacy → Get a copy of your data → Connections</strong>.</li>
        <li>Download the <code>Connections.csv</code> file LinkedIn emails you.</li>
        <li>Drop it below. Re-importing is safe — duplicates (same profile URL) are skipped.</li>
      </ol>
      <input type="file" id="csvFile" accept=".csv,text/csv">
      <div id="preview" style="margin-top:18px"></div>
    </div>`;

  const fileInput = content.querySelector("#csvFile");
  const preview = content.querySelector("#preview");

  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleText(reader.result);
    reader.readAsText(file);
  };

  async function handleText(text) {
    preview.innerHTML = `<span class="spinner spinner--dark"></span> Reading…`;
    // LinkedIn prepends a "Notes:" preamble before the real header row.
    const lines = text.split(/\r?\n/);
    const headerIdx = lines.findIndex((l) => /first name/i.test(l) && /url/i.test(l));
    const body = (headerIdx >= 0 ? lines.slice(headerIdx) : lines).join("\n");
    const res = Papa.parse(body, { header: true, skipEmptyLines: true });

    const pick = (row, ...keys) => {
      for (const k of Object.keys(row)) if (keys.some((want) => k.trim().toLowerCase() === want)) return (row[k] || "").trim();
      return "";
    };
    parsed = res.data.map((r) => ({
      firstName: pick(r, "first name"),
      lastName:  pick(r, "last name"),
      url:       pick(r, "url"),
      email:     pick(r, "email address", "email"),
      company:   pick(r, "company"),
      position:  pick(r, "position"),
      connectedOn: pick(r, "connected on"),
    })).filter((r) => r.firstName || r.lastName || r.url);

    // Load existing data to dedup against
    const [people, companies] = await Promise.all([
      listBySpace(COLLECTIONS.people),
      listBySpace(COLLECTIONS.companies),
    ]);
    existing = {
      urls: new Set(people.map((p) => canonicalLinkedinUrl(p.linkedinUrl)).filter(Boolean)),
      companyMap: new Map(companies.map((c) => [c.normalizedName, c.id])),
    };

    const news = parsed.filter((r) => { const u = canonicalLinkedinUrl(r.url); return !u || !existing.urls.has(u); });
    const dups = parsed.length - news.length;

    preview.innerHTML = `
      <div class="grid grid--stats" style="margin-bottom:16px">
        <div class="stat"><div class="stat__num">${parsed.length}</div><div class="stat__label">Rows in file</div></div>
        <div class="stat"><div class="stat__num">${news.length}</div><div class="stat__label">New to import</div></div>
        <div class="stat"><div class="stat__num">${dups}</div><div class="stat__label">Already in Lariat</div></div>
      </div>
      ${news.length ? `<button class="btn" id="doImport">Import ${news.length} ${news.length === 1 ? "person" : "people"}</button>` : '<p class="muted">Nothing new to import.</p>'}
      <div class="card" style="padding:0;margin-top:16px;max-height:320px;overflow:auto">
        <table><thead><tr><th>Name</th><th>Company</th><th>Position</th><th></th></tr></thead>
        <tbody>${parsed.slice(0, 50).map((r) => {
          const dup = existing.urls.has(canonicalLinkedinUrl(r.url));
          return `<tr><td>${escHtml(`${r.firstName} ${r.lastName}`.trim())}</td><td>${escHtml(r.company)}</td>
            <td class="small">${escHtml(r.position)}</td>
            <td>${dup ? '<span class="badge">dup</span>' : '<span class="badge badge--ok">new</span>'}</td></tr>`;
        }).join("")}</tbody></table>
      </div>
      ${parsed.length > 50 ? `<p class="muted small" style="margin-top:8px">Showing first 50 of ${parsed.length}.</p>` : ""}`;

    const btn = preview.querySelector("#doImport");
    if (btn) btn.onclick = () => runImport(news, btn);
  }

  async function runImport(news, btn) {
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing…';
    try {
      // 1) Companies: create any not already known, build normalized→id map.
      const map = existing.companyMap;
      const toCreate = [];
      for (const r of news) {
        const norm = normalizeCompany(r.company);
        if (norm && !map.has(norm) && !toCreate.find((c) => c.normalizedName === norm))
          toCreate.push({ name: r.company.trim(), normalizedName: norm });
      }
      const newCoIds = await bulkCreate(COLLECTIONS.companies, toCreate);
      toCreate.forEach((c, i) => map.set(c.normalizedName, newCoIds[i]));

      // 2) People
      const peopleDocs = news.map((r) => {
        const norm = normalizeCompany(r.company);
        return {
          firstName: r.firstName, lastName: r.lastName,
          displayName: `${r.firstName} ${r.lastName}`.trim(),
          linkedinUrl: canonicalLinkedinUrl(r.url),
          emails: r.email ? [r.email] : [],
          phones: [], tags: [], location: "",
          currentCompanyName: r.company.trim(),
          currentCompanyId: norm ? map.get(norm) || null : null,
          currentTitle: r.position,
          howWeMet: "", metPlace: "", birthday: null, nextContactAt: null,
          source: "linkedin",
          connectedOn: r.connectedOn || "",
        };
      });
      const personIds = await bulkCreate(COLLECTIONS.people, peopleDocs);

      // 3) Current experiences (powers company lookup)
      const exps = [];
      peopleDocs.forEach((p, i) => {
        if (p.currentCompanyId) exps.push({
          personId: personIds[i], companyId: p.currentCompanyId, companyName: p.currentCompanyName,
          title: p.currentTitle || "", startDate: null, endDate: null,
        });
      });
      await bulkCreate(COLLECTIONS.experiences, exps);

      toast(`Imported ${personIds.length} people`);
      btn.textContent = `✓ Imported ${personIds.length}`;
    } catch (err) {
      console.error(err); toast("Import failed: " + err.message, true);
      btn.disabled = false; btn.textContent = "Retry import";
    }
  }
}
