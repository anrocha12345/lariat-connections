// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — People view
// List, detail (with the self-logging interaction timeline), add/edit, and
// group-meeting auto-linking of relationships.
// ─────────────────────────────────────────────────────────────────────────
import {
  COLLECTIONS, watchBySpace, createDoc, updateDoc, deleteDoc, getDocById,
  upsertCompany, setCurrentExperience, linkAttendees,
  escHtml, fmtDate, fmtDateTime, tsToDate,
} from "../data.js";
import { toast, openModal, confirmDialog, avatarHtml, colorFor } from "../ui.js";

// Interaction types → label + icon. Contact types count toward "last touch".
const TYPES = {
  note:          { label: "Note",            icon: "📝", contact: false },
  call:          { label: "Call",            icon: "📞", contact: true  },
  email:         { label: "Email",           icon: "✉️", contact: true  },
  meeting:       { label: "Meeting",         icon: "🤝", contact: true  },
  met_in_person: { label: "Met in person",   icon: "👥", contact: true  },
  coffee:        { label: "Coffee / meal",   icon: "☕", contact: true  },
  event:         { label: "Event",           icon: "🎉", contact: true  },
  linkedin_message: { label: "LinkedIn message", icon: "💬", contact: true },
  other:         { label: "Other",           icon: "•",  contact: false },
};

let S = null; // shared view state

export function mount({ content, actions, ctx, go, param }) {
  S = { content, go, people: [], byId: {}, companies: [], interactions: [], relationships: [], ready: 0 };

  actions.innerHTML = `<button class="btn" id="addPersonBtn">＋ Add person</button>`;
  actions.querySelector("#addPersonBtn").onclick = () => openPersonModal();

  const need = 4;
  const bump = () => { if (++S.ready >= need) render(); };

  const unsubs = [
    watchBySpace(COLLECTIONS.people, (rows) => {
      S.people = rows; S.byId = Object.fromEntries(rows.map((r) => [r.id, r])); bump();
    }),
    watchBySpace(COLLECTIONS.companies, (rows) => { S.companies = rows; bump(); }),
    watchBySpace(COLLECTIONS.interactions, (rows) => { S.interactions = rows; bump(); }),
    watchBySpace(COLLECTIONS.relationships, (rows) => { S.relationships = rows; bump(); }),
  ];

  function render() {
    const [, id] = (location.hash.replace("#", "")).split("/");
    if (id && S.byId[id]) renderDetail(id);
    else renderList();
  }
  S.render = render;

  return () => unsubs.forEach((u) => u && u());
}

// ── Derived data ────────────────────────────────────────────────────────────
function interactionsFor(personId) {
  return S.interactions
    .filter((i) => (i.personIds || []).includes(personId))
    .sort((a, b) => (tsToDate(b.occurredAt) || 0) - (tsToDate(a.occurredAt) || 0));
}
function lastTouch(personId) {
  const now = Date.now();
  const dates = interactionsFor(personId)
    .filter((i) => TYPES[i.type]?.contact)
    .map((i) => tsToDate(i.occurredAt))
    .filter((d) => d && d.getTime() <= now + 864e5);
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}
function nextContact(person) {
  const now = Date.now();
  const cands = [];
  if (person.nextContactAt && (tsToDate(person.nextContactAt)?.getTime() ?? 0) > now)
    cands.push(tsToDate(person.nextContactAt));
  interactionsFor(person.id).forEach((i) => {
    const d = tsToDate(i.occurredAt);
    if (d && d.getTime() > now) cands.push(d);
  });
  return cands.length ? new Date(Math.min(...cands.map((d) => d.getTime()))) : null;
}
function allTags() {
  return [...new Set(S.people.flatMap((p) => p.tags || []))].sort((a, b) => a.localeCompare(b));
}
function displayName(p) {
  return p.displayName || `${p.firstName || ""} ${p.lastName || ""}`.trim() || "(no name)";
}

// ── List ─────────────────────────────────────────────────────────────────────
const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "tags", label: "Tags" },
  { key: "lastContact", label: "Last contact" },
  { key: "nextContact", label: "Next contact" },
];

function sortValue(row, key) {
  switch (key) {
    case "name": return displayName(row.p).toLowerCase();
    case "company": return (row.p.currentCompanyName || "").toLowerCase();
    case "tags": return (row.p.tags || []).join(", ").toLowerCase();
    case "lastContact": return row.lt ? row.lt.getTime() : null;
    case "nextContact": return row.nc ? row.nc.getTime() : null;
    default: return "";
  }
}

function renderList() {
  const tags = allTags();
  S.sortField = S.sortField || "name";
  S.sortDir = S.sortDir || 1;
  S.content.innerHTML = `
    <div class="toolbar">
      <input class="search-input" id="peopleSearch" placeholder="Search name, company, email…">
      <select id="tagFilter" style="max-width:200px"><option value="">All tags</option>
        ${tags.map((t) => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join("")}</select>
      <div class="toolbar__spacer"></div>
      <span class="muted small">${S.people.length} contact${S.people.length === 1 ? "" : "s"}</span>
    </div>
    <div class="card table-scroll" style="padding:0" id="peopleTableWrap"></div>`;

  const wrap = S.content.querySelector("#peopleTableWrap");
  const search = S.content.querySelector("#peopleSearch");
  const tagFilter = S.content.querySelector("#tagFilter");

  function draw() {
    const q = search.value.trim().toLowerCase();
    const tf = tagFilter.value;
    const filtered = S.people.filter((p) => {
      if (tf && !(p.tags || []).includes(tf)) return false;
      if (!q) return true;
      const hay = [displayName(p), p.currentCompanyName, p.currentTitle, (p.emails || []).join(" "), (p.tags || []).join(" ")]
        .join(" ").toLowerCase();
      return hay.includes(q);
    });
    const rows = filtered.map((p) => ({ p, lt: lastTouch(p.id), nc: nextContact(p) }));

    rows.sort((a, b) => {
      const av = sortValue(a, S.sortField), bv = sortValue(b, S.sortField);
      // Rows with no value for the sorted column (e.g. no last-contact date)
      // always sink to the bottom, regardless of sort direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number") return (av - bv) * S.sortDir;
      return av.localeCompare(bv) * S.sortDir;
    });

    if (!rows.length) {
      wrap.innerHTML = `<div class="empty"><div class="empty__icon">👋</div>
        <h2>${S.people.length ? "No matches" : "No people yet"}</h2>
        <p class="muted">${S.people.length ? "Try a different search." : "Add someone, or import your LinkedIn connections."}</p></div>`;
      return;
    }

    const arrow = (key) => S.sortField === key ? `<span class="sort-arrow">${S.sortDir === 1 ? "▲" : "▼"}</span>` : "";
    wrap.innerHTML = `<table><thead><tr>
        ${COLUMNS.map((c) => `<th class="sortable" data-sort="${c.key}">${escHtml(c.label)}${arrow(c.key)}</th>`).join("")}
      </tr></thead><tbody>${rows.map(rowHtml).join("")}</tbody></table>`;

    wrap.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.onclick = () => S.go("people", { id: tr.dataset.id }));
    wrap.querySelectorAll("th[data-sort]").forEach((th) =>
      th.onclick = () => {
        const key = th.dataset.sort;
        if (S.sortField === key) S.sortDir *= -1; else { S.sortField = key; S.sortDir = 1; }
        draw();
      });
  }

  function rowHtml({ p, lt, nc }) {
    return `<tr class="row-click" data-id="${p.id}">
      <td><div class="row">${avatarHtml(p)}<div>
        <div style="font-weight:600">${escHtml(displayName(p))}</div>
        <div class="muted small">${escHtml(p.currentTitle || "")}</div></div></div></td>
      <td>${escHtml(p.currentCompanyName || "—")}</td>
      <td>${(p.tags || []).slice(0, 3).map((t) => tagChip(t)).join(" ") || "—"}</td>
      <td class="small">${lt ? fmtDate(lt) : '<span class="muted">—</span>'}</td>
      <td class="small">${nc ? fmtDate(nc) : '<span class="muted">—</span>'}</td>
    </tr>`;
  }
  search.oninput = draw;
  tagFilter.onchange = draw;
  draw();
}

function tagChip(t) {
  const c = colorFor(t);
  return `<span class="chip" style="background:${c}22;color:${c}">${escHtml(t)}</span>`;
}

// ── Detail ────────────────────────────────────────────────────────────────────
function renderDetail(id) {
  const p = S.byId[id];
  if (!p) { S.go("people"); return; }
  const inters = interactionsFor(id);
  const lt = lastTouch(id), nc = nextContact(p);
  const rels = S.relationships
    .filter((r) => r.personA === id || r.personB === id)
    .map((r) => ({ other: r.personA === id ? r.personB : r.personA, type: r.type, weight: r.weight }))
    .filter((r) => S.byId[r.other])
    .sort((a, b) => (b.weight || 0) - (a.weight || 0));

  const bday = p.birthday && p.birthday.month
    ? new Date(2000, p.birthday.month - 1, p.birthday.day).toLocaleDateString(undefined, { month: "long", day: "numeric" })
      + (p.birthday.year ? ` (${p.birthday.year})` : "")
    : null;

  S.content.innerHTML = `
    <a class="small muted" href="#people">← All people</a>
    <div class="grid" style="grid-template-columns:1.6fr 1fr;margin-top:14px;align-items:start">
      <div class="stack">
        <div class="card">
          <div class="spread" style="align-items:flex-start">
            <div class="row" style="align-items:flex-start">
              ${avatarHtml(p, true)}
              <div>
                <h2 style="font-size:1.5rem">${escHtml(displayName(p))}</h2>
                <div class="muted">${escHtml([p.currentTitle, p.currentCompanyName].filter(Boolean).join(" · ")) || ""}</div>
                <div class="muted small">${escHtml(p.location || "")}</div>
                ${p.linkedinUrl ? `<a class="small" href="https://${escHtml(p.linkedinUrl)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : ""}
              </div>
            </div>
            <div class="row">
              <button class="btn btn--sm" id="editBtn">✎ Edit</button>
              <button class="btn btn--ghost btn--sm btn--danger" id="delBtn">Delete</button>
            </div>
          </div>
          <div style="margin-top:14px">${(p.tags || []).map(tagChip).join(" ")}</div>
        </div>

        <div class="card">
          <div class="spread"><h3>Activity log</h3>
            <button class="btn btn--sm" id="logBtn">＋ Log interaction</button></div>
          <p class="muted small" style="margin:4px 0 14px">Every entry is timestamped — this is your record of when things happened and when you logged them.</p>
          <div id="timeline">${inters.length ? inters.map(interHtml).join("") : '<p class="muted">No interactions logged yet.</p>'}</div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="spread"><h3 style="font-size:1.05rem">Snapshot</h3>
            <button class="btn btn--ghost btn--sm" id="editSnapshotBtn" title="Edit next contact, how/where you met, birthday…">✎ Edit</button></div>
          <div class="stack" style="margin-top:10px">
            ${infoRow("Last contact", lt ? fmtDate(lt) : "—")}
            ${infoRow("Next contact", nc ? fmtDate(nc) : "—")}
            ${infoRow("How we met", p.howWeMet || "—")}
            ${infoRow("Where we met", p.metPlace || "—")}
            ${infoRow("Birthday", bday || "—")}
            ${infoRow("Source", p.source || "manual")}
          </div>
        </div>
        <div class="card">
          <div class="spread"><h3 style="font-size:1.05rem">Contact</h3>
            <button class="btn btn--ghost btn--sm" id="editContactBtn" title="Edit emails and phone numbers">✎ Edit</button></div>
          <div class="stack" style="margin-top:10px">
            ${(p.emails || []).map((e) => infoRow("Email", `<a href="mailto:${escHtml(e)}">${escHtml(e)}</a>`)).join("") || infoRow("Email", "—")}
            ${(p.phones || []).map((ph) => infoRow("Phone", escHtml(ph))).join("") || ""}
          </div>
        </div>
        <div class="card">
          <h3 style="font-size:1.05rem">Connections <span class="muted small">(${rels.length})</span></h3>
          <div class="stack" style="margin-top:10px">
            ${rels.length ? rels.map((r) => `
              <div class="spread row-click" data-goto="${r.other}" style="cursor:pointer">
                <div class="row">${avatarHtml(S.byId[r.other])}<span>${escHtml(displayName(S.byId[r.other]))}</span></div>
                <span class="badge">${escHtml((r.type || "").replace(/_/g, " "))}</span>
              </div>`).join("") : '<p class="muted small">No connections yet. Log a meeting with several people to link them.</p>'}
          </div>
        </div>
      </div>
    </div>`;

  S.content.querySelector("#editBtn").onclick = () => openPersonModal(p);
  S.content.querySelector("#editSnapshotBtn").onclick = () => openPersonModal(p);
  S.content.querySelector("#editContactBtn").onclick = () => openPersonModal(p);
  S.content.querySelector("#logBtn").onclick = () => openInteractionModal([id]);
  S.content.querySelector("#delBtn").onclick = async () => {
    if (await confirmDialog(`Delete ${displayName(p)}? This removes their profile.`, { danger: true, okLabel: "Delete" })) {
      await deleteDoc(COLLECTIONS.people, id);
      toast("Person deleted"); S.go("people");
    }
  };
  S.content.querySelectorAll("[data-goto]").forEach((el) =>
    el.onclick = () => S.go("people", { id: el.dataset.goto }));
  S.content.querySelectorAll("[data-edit-inter]").forEach((el) =>
    el.onclick = () => { const it = S.interactions.find((x) => x.id === el.dataset.editInter); if (it) openInteractionModal(it.personIds, it); });
  S.content.querySelectorAll("[data-del-inter]").forEach((el) =>
    el.onclick = async () => { if (await confirmDialog("Delete this log entry?", { danger: true, okLabel: "Delete" })) { await deleteDoc(COLLECTIONS.interactions, el.dataset.delInter); toast("Entry deleted"); } });
}

function infoRow(label, valueHtml) {
  return `<div><div class="muted small" style="text-transform:uppercase;letter-spacing:.05em;font-size:.7rem">${escHtml(label)}</div>
    <div>${valueHtml}</div></div>`;
}

function interHtml(i) {
  const t = TYPES[i.type] || TYPES.other;
  const others = (i.personIds || []).filter((x) => x !== null);
  const withText = others.length > 1
    ? ` · with ${others.filter((x) => S.byId[x]).map((x) => escHtml(displayName(S.byId[x]))).join(", ")}`
    : "";
  return `<div style="border-left:2px solid var(--border);padding:0 0 16px 14px;position:relative">
    <div style="position:absolute;left:-9px;top:0;font-size:1rem">${t.icon}</div>
    <div class="spread">
      <div><strong>${escHtml(t.label)}</strong> <span class="muted small">${fmtDate(i.occurredAt)}${escHtml(i.place ? " · " + i.place : "")}</span></div>
      <div class="row"><button class="btn btn--ghost btn--sm" data-edit-inter="${i.id}">Edit</button>
        <button class="btn btn--ghost btn--sm" data-del-inter="${i.id}">✕</button></div>
    </div>
    ${i.notes ? `<div style="margin-top:4px;white-space:pre-wrap">${escHtml(i.notes)}</div>` : ""}
    <div class="muted small" style="margin-top:4px">Logged ${fmtDateTime(i.createdAt)}${withText}</div>
  </div>`;
}

// ── Add / edit person ─────────────────────────────────────────────────────────
function openPersonModal(person = null) {
  const p = person || {};
  const bdayVal = p.birthday && p.birthday.month
    ? `${p.birthday.year || 2000}-${String(p.birthday.month).padStart(2, "0")}-${String(p.birthday.day).padStart(2, "0")}` : "";
  const m = openModal(`
    <div class="modal__head"><h3>${person ? "Edit person" : "Add person"}</h3><button class="modal__close" data-x>×</button></div>
    <form id="personForm" class="stack">
      <div class="form-row">
        <div class="form-group"><label>First name</label><input name="firstName" value="${escHtml(p.firstName || "")}"></div>
        <div class="form-group"><label>Last name</label><input name="lastName" value="${escHtml(p.lastName || "")}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Company</label><input name="company" value="${escHtml(p.currentCompanyName || "")}"></div>
        <div class="form-group"><label>Title</label><input name="title" value="${escHtml(p.currentTitle || "")}"></div>
      </div>
      <div class="form-group"><label>LinkedIn URL</label><input name="linkedinUrl" placeholder="linkedin.com/in/…" value="${escHtml(p.linkedinUrl || "")}"></div>
      <div class="form-row">
        <div class="form-group"><label>Emails (comma-separated)</label><input name="emails" value="${escHtml((p.emails || []).join(", "))}"></div>
        <div class="form-group"><label>Phones (comma-separated)</label><input name="phones" value="${escHtml((p.phones || []).join(", "))}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Location</label><input name="location" value="${escHtml(p.location || "")}"></div>
        <div class="form-group"><label>Birthday</label><input type="date" name="birthday" value="${bdayVal}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>How we met</label><input name="howWeMet" value="${escHtml(p.howWeMet || "")}"></div>
        <div class="form-group"><label>Where we met</label><input name="metPlace" value="${escHtml(p.metPlace || "")}"></div>
      </div>
      <div class="form-group"><label>Tags (comma-separated)</label><input name="tags" value="${escHtml((p.tags || []).join(", "))}"></div>
      <div class="form-group"><label>Next contact (optional)</label><input type="date" name="nextContact" value="${p.nextContactAt ? (tsToDate(p.nextContactAt)?.toISOString().slice(0, 10)) : ""}"></div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn btn--ghost" data-x>Cancel</button>
        <button type="submit" class="btn" id="saveBtn">${person ? "Save" : "Add person"}</button>
      </div>
    </form>`, { wide: true });

  m.root.querySelectorAll("[data-x]").forEach((b) => b.onclick = m.close);
  m.root.querySelector("#personForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = m.root.querySelector("#saveBtn");
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      const parseList = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
      const companyName = f.company.value.trim();
      const title = f.title.value.trim();
      const bd = f.birthday.value ? f.birthday.value.split("-") : null;
      const data = {
        firstName: f.firstName.value.trim(),
        lastName: f.lastName.value.trim(),
        displayName: `${f.firstName.value.trim()} ${f.lastName.value.trim()}`.trim(),
        currentCompanyName: companyName,
        currentTitle: title,
        linkedinUrl: f.linkedinUrl.value.trim().replace(/^https?:\/\//, "").replace(/^www\./, ""),
        emails: parseList(f.emails.value),
        phones: parseList(f.phones.value),
        location: f.location.value.trim(),
        tags: parseList(f.tags.value),
        howWeMet: f.howWeMet.value.trim(),
        metPlace: f.metPlace.value.trim(),
        birthday: bd ? { year: bd[0] === "2000" ? null : Number(bd[0]), month: Number(bd[1]), day: Number(bd[2]) } : null,
        nextContactAt: f.nextContact.value ? new Date(f.nextContact.value) : null,
        source: p.source || "manual",
      };
      let personId = person ? person.id : null;
      if (person) await updateDoc(COLLECTIONS.people, person.id, data);
      else personId = await createDoc(COLLECTIONS.people, data);

      // Company + current experience (powers company lookup)
      if (companyName) {
        const co = await upsertCompany(companyName);
        if (co) {
          await updateDoc(COLLECTIONS.people, personId, { currentCompanyId: co.id });
          await setCurrentExperience(personId, { companyId: co.id, companyName: co.name, title });
        }
      }
      toast(person ? "Saved" : "Person added");
      m.close();
    } catch (err) { console.error(err); toast("Save failed: " + err.message, true); btn.disabled = false; btn.textContent = "Save"; }
  };
}

// ── Log interaction ───────────────────────────────────────────────────────────
function openInteractionModal(preselectIds = [], existing = null) {
  const i = existing || {};
  const sel = new Set(existing ? (existing.personIds || []) : preselectIds);
  const dateVal = existing && existing.occurredAt ? tsToDate(existing.occurredAt)?.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  const m = openModal(`
    <div class="modal__head"><h3>${existing ? "Edit interaction" : "Log interaction"}</h3><button class="modal__close" data-x>×</button></div>
    <form id="interForm" class="stack">
      <div class="form-row">
        <div class="form-group"><label>Type</label><select name="type">
          ${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${i.type === k ? "selected" : ""}>${v.icon} ${v.label}</option>`).join("")}
        </select></div>
        <div class="form-group"><label>Date</label><input type="date" name="date" value="${dateVal}"></div>
      </div>
      <div class="form-group"><label>Place (optional)</label><input name="place" value="${escHtml(i.place || "")}"></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" placeholder="What happened, what to remember…">${escHtml(i.notes || "")}</textarea></div>
      <div class="form-group">
        <label>People involved <span class="muted" style="text-transform:none">— tick 2+ to link them on the map</span></label>
        <input id="attFilter" placeholder="Filter people…" style="margin-bottom:8px">
        <div id="attList" style="max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px"></div>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn btn--ghost" data-x>Cancel</button>
        <button type="submit" class="btn" id="saveInter">Save</button>
      </div>
    </form>`, { wide: true });

  const attList = m.root.querySelector("#attList");
  const attFilter = m.root.querySelector("#attFilter");
  function drawAtt() {
    const q = attFilter.value.trim().toLowerCase();
    const rows = S.people
      .filter((p) => !q || displayName(p).toLowerCase().includes(q))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));
    attList.innerHTML = rows.map((p) => `<label style="display:flex;align-items:center;gap:8px;text-transform:none;font-weight:400;padding:3px 0">
      <input type="checkbox" style="width:auto" value="${p.id}" ${sel.has(p.id) ? "checked" : ""}> ${escHtml(displayName(p))}</label>`).join("")
      || '<p class="muted small">No people.</p>';
    attList.querySelectorAll("input").forEach((cb) =>
      cb.onchange = () => cb.checked ? sel.add(cb.value) : sel.delete(cb.value));
  }
  attFilter.oninput = drawAtt; drawAtt();

  m.root.querySelectorAll("[data-x]").forEach((b) => b.onclick = m.close);
  m.root.querySelector("#interForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = m.root.querySelector("#saveInter");
    const ids = [...sel];
    if (!ids.length) { toast("Pick at least one person", true); return; }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving…';
    try {
      const data = {
        personIds: ids, type: f.type.value, occurredAt: new Date(f.date.value),
        notes: f.notes.value.trim(), place: f.place.value.trim(),
      };
      if (existing) await updateDoc(COLLECTIONS.interactions, existing.id, data);
      else await createDoc(COLLECTIONS.interactions, data);
      // Auto-link everyone who was there together
      if (ids.length >= 2) {
        const relType = f.type.value === "call" ? "same_call" : f.type.value === "event" ? "same_event" : "met_together";
        await linkAttendees(ids, { type: relType, source: "inferred", context: data.notes || TYPES[data.type].label });
      }
      toast("Interaction logged"); m.close();
    } catch (err) { console.error(err); toast("Save failed: " + err.message, true); btn.disabled = false; btn.textContent = "Save"; }
  };
}
