// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Import
//  • Connections.csv → people + companies + current experiences (deduped)
//  • messages.csv    → back-fill "last contact" per person by matching the
//    conversation's profile URLs (one summarised interaction per person).
// Both run as background jobs (js/jobs.js) — once started, they keep writing
// to Firestore regardless of which page you're on. A persistent tray in the
// app shell (app.html) shows progress everywhere; this view additionally
// shows live progress inline while you're on it.
// ─────────────────────────────────────────────────────────────────────────
import Papa from "https://esm.sh/papaparse@5.4.1";
import {
  COLLECTIONS, listBySpace, bulkCreate, updateDoc, where,
  canonicalLinkedinUrl, normalizeCompany, dedupeKey, personDedupeKey, escHtml, fmtDate, tsToDate,
} from "../data.js";
import { startJob, isRunning, subscribe as subscribeJobs } from "../jobs.js";
import { toast } from "../ui.js";

export function mount({ content }) {
  content.innerHTML = `
    <div class="stack" style="max-width:780px">
      <div class="card">
        <h3>1 · Connections</h3>
        <ol class="muted small" style="margin:12px 0 16px 18px;line-height:1.8">
          <li>LinkedIn → <strong>Settings &amp; Privacy → Data privacy → Get a copy of your data → Connections</strong>.</li>
          <li>Drop the <code>Connections.csv</code> below. Re-importing is safe — duplicates are skipped.</li>
          <li>Once started, the import keeps running even if you go to another page — check the tray in the corner.</li>
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

  const connFile = content.querySelector("#connFile"), connPreview = content.querySelector("#connPreview");
  const msgFile = content.querySelector("#msgFile"), msgPreview = content.querySelector("#msgPreview");

  const unsubConn = wireSection({ type: "connections", input: connFile, preview: connPreview, onFile: parseConnections });
  const unsubMsg = wireSection({ type: "messages", input: msgFile, preview: msgPreview, onFile: parseMessages });

  return () => { unsubConn(); unsubMsg(); };
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

// Wires a file input to: parse on choose → show a preview with a start button →
// on start, launch a background job. While a job of this type is active/recent,
// show its live progress instead of the upload picker.
function wireSection({ type, input, preview, onFile }) {
  function renderJobState(jobs) {
    const job = jobs.find((j) => j.type === type);
    if (!job) return false;
    const pct = job.total ? Math.round((job.progress / job.total) * 100) : (job.status === "running" ? 20 : 100);
    const icon = job.status === "done" ? "✓" : job.status === "error" ? "✕" : '<span class="spinner spinner--dark"></span>';
    preview.innerHTML = `
      <div class="card" style="background:var(--bg)">
        <div class="row">${icon} <strong>${escHtml(job.label)}</strong></div>
        <div class="job-card__bar" style="margin-top:10px"><div class="job-card__bar-fill" style="width:${pct}%;background:${job.status === "error" ? "var(--danger)" : job.status === "done" ? "var(--ok)" : "var(--primary)"}"></div></div>
        <div class="muted small" style="margin-top:6px">${escHtml(job.message || "")}</div>
        ${job.status === "running" ? '<p class="muted small" style="margin-top:8px">You can switch to other pages — this keeps running.</p>' : ""}
      </div>`;
    input.disabled = job.status === "running";
    return true;
  }

  const unsub = subscribeJobs(renderJobState);

  input.onchange = () => readFile(input, async (text) => {
    if (isRunning(type)) { toast("Already running — wait for it to finish.", true); return; }
    preview.innerHTML = `<span class="spinner spinner--dark"></span> Reading…`;
    try { await onFile(text, preview, type); }
    catch (err) { console.error(err); preview.innerHTML = `<p class="muted">Couldn't read that file: ${escHtml(err.message)}</p>`; }
  });

  return unsub;
}

// ── Connections ───────────────────────────────────────────────────────────
async function parseConnections(text, preview) {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /first name/i.test(l) && /url/i.test(l));
  const body = (headerIdx >= 0 ? lines.slice(headerIdx) : lines).join("\n");
  const res = Papa.parse(body, { header: true, skipEmptyLines: true });
  const parsed = res.data.map((r) => ({
    firstName: pick(r, "first name"), lastName: pick(r, "last name"),
    url: pick(r, "url"), email: pick(r, "email address", "email"),
    company: pick(r, "company"), position: pick(r, "position"), connectedOn: pick(r, "connected on"),
  })).filter((r) => r.firstName || r.lastName || r.url);

  const [people, companies] = await Promise.all([listBySpace(COLLECTIONS.people), listBySpace(COLLECTIONS.companies)]);
  const existingKeys = new Set(people.map(personDedupeKey).filter(Boolean));
  const companyMap = new Map(companies.map((c) => [c.normalizedName, c.id]));

  const seen = new Set();
  const news = [];
  for (const r of parsed) {
    const k = dedupeKey({ linkedinUrl: r.url, name: `${r.firstName} ${r.lastName}`, company: r.company, email: r.email });
    if (k && (existingKeys.has(k) || seen.has(k))) continue;
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
  if (btn) btn.onclick = () => {
    runConnectionsJob(news, companyMap);
    toast("Import started — feel free to browse other pages.");
  };
}

function runConnectionsJob(news, companyMap) {
  const job = startJob(`Importing ${news.length} connections`, "connections");
  (async () => {
    try {
      const map = companyMap, toCreate = [];
      for (const r of news) {
        const norm = normalizeCompany(r.company);
        if (norm && !map.has(norm) && !toCreate.find((c) => c.normalizedName === norm))
          toCreate.push({ name: r.company.trim(), normalizedName: norm });
      }
      job.update({ message: `Creating ${toCreate.length} companies…` });
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
      const personIds = await bulkCreate(COLLECTIONS.people, peopleDocs, (done, total) =>
        job.update({ progress: done, total, message: `Creating people… ${done}/${total}` }));

      const exps = [];
      peopleDocs.forEach((p, i) => { if (p.currentCompanyId) exps.push({ personId: personIds[i], companyId: p.currentCompanyId, companyName: p.currentCompanyName, title: p.currentTitle || "", startDate: null, endDate: null }); });
      job.update({ message: `Linking ${exps.length} roles…` });
      await bulkCreate(COLLECTIONS.experiences, exps);

      job.done(`Imported ${personIds.length} people`);
      toast(`Imported ${personIds.length} people`);
    } catch (err) {
      console.error(err); job.fail(err.message); toast("Import failed: " + err.message, true);
    }
  })();
}

// ── Messages (last-contact back-fill) ───────────────────────────────────────
async function parseMessages(text, preview) {
  const res = Papa.parse(text, { header: true, skipEmptyLines: true });
  const people = await listBySpace(COLLECTIONS.people);
  const urlToId = new Map();
  people.forEach((p) => { const u = canonicalLinkedinUrl(p.linkedinUrl); if (u) urlToId.set(u, p.id); });
  if (!urlToId.size) { preview.innerHTML = `<p class="muted">Import your connections first, then messages can match to them.</p>`; return; }

  const agg = new Map();
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
  if (btn) btn.onclick = () => {
    runMessagesJob(agg);
    toast("Back-fill started — feel free to browse other pages.");
  };
}

function runMessagesJob(agg) {
  const job = startJob(`Back-filling ${agg.size} people from messages`, "messages");
  (async () => {
    try {
      const existing = await listBySpace(COLLECTIONS.interactions, where("source", "==", "linkedin_messages"));
      const byPerson = new Map();
      existing.forEach((i) => { const pid = (i.personIds || [])[0]; if (pid) byPerson.set(pid, i.id); });

      const toCreate = [];
      let updated = 0, done = 0;
      const total = agg.size;
      for (const [pid, { count, maxDate }] of agg) {
        const data = { type: "linkedin_message", occurredAt: maxDate, notes: `${count} LinkedIn message${count === 1 ? "" : "s"} · last on ${fmtDate(maxDate)}` };
        if (byPerson.has(pid)) { await updateDoc(COLLECTIONS.interactions, byPerson.get(pid), data); updated++; }
        else toCreate.push({ personIds: [pid], place: "", source: "linkedin_messages", ...data });
        done++;
        if (done % 25 === 0) job.update({ progress: done, total, message: `Updating… ${done}/${total}` });
      }
      job.update({ message: `Creating ${toCreate.length} new log entries…` });
      await bulkCreate(COLLECTIONS.interactions, toCreate);

      job.done(`Back-filled ${agg.size} people`);
      toast(`Back-filled ${agg.size} people (${toCreate.length} new, ${updated} refreshed)`);
    } catch (err) {
      console.error(err); job.fail(err.message); toast("Back-fill failed: " + err.message, true);
    }
  })();
}
