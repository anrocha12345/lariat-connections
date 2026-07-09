// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Data layer
// ─────────────────────────────────────────────────────────────────────────
// All reads/writes are scoped to the active `spaceId`. A space is the unit of
// access control: today one space with just André in it, but the shape supports
// adding members (share a network) or new spaces (others' networks) later with
// no data migration.
// ─────────────────────────────────────────────────────────────────────────

import { auth, db } from "./firebase-config.js";
import {
  collection, doc, addDoc, setDoc, updateDoc as fbUpdate, deleteDoc as fbDelete,
  getDoc, getDocs, query, where, orderBy, onSnapshot, serverTimestamp,
  writeBatch, arrayUnion, arrayRemove, limit,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

export const COLLECTIONS = {
  spaces:        "spaces",
  people:        "people",
  experiences:   "experiences",
  companies:     "companies",
  interactions:  "interactions",
  relationships: "relationships",
  events:        "events",
  tags:          "tags",
  userConfig:    "userConfig",
};

// ── Active space ──────────────────────────────────────────────────────────
let ACTIVE_SPACE = null;
export function setActiveSpace(spaceId) { ACTIVE_SPACE = spaceId; }
export function getActiveSpace() { return ACTIVE_SPACE; }
function requireSpace() {
  if (!ACTIVE_SPACE) throw new Error("No active space set — auth bootstrap did not run.");
  return ACTIVE_SPACE;
}
function uid() { return auth.currentUser ? auth.currentUser.uid : null; }

// ── Generic CRUD (all space-scoped) ──────────────────────────────────────
export async function createDoc(col, data) {
  const ref = await addDoc(collection(db, col), {
    ...data,
    spaceId:   requireSpace(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid(),
  });
  return ref.id;
}

export async function updateDoc(col, id, data) {
  await fbUpdate(doc(db, col, id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteDoc(col, id) {
  await fbDelete(doc(db, col, id));
}

export async function getDocById(col, id) {
  const snap = await getDoc(doc(db, col, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// One-shot list of a collection for the active space, with optional extra
// query constraints (where/orderBy/limit built with the re-exports below).
export async function listBySpace(col, ...constraints) {
  const q = query(collection(db, col), where("spaceId", "==", requireSpace()), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Realtime listener for a collection scoped to the active space.
// Returns the unsubscribe fn.
export function watchBySpace(col, cb, ...constraints) {
  const q = query(collection(db, col), where("spaceId", "==", requireSpace()), ...constraints);
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Create many docs efficiently in batches (≤450/commit). Returns new ids in
// the same order as `items`. Used by the LinkedIn importer.
export async function bulkCreate(col, items) {
  const ids = [];
  let batch = writeBatch(db), n = 0;
  const space = requireSpace(), by = uid();
  for (const item of items) {
    const ref = doc(collection(db, col));
    batch.set(ref, { ...item, spaceId: space, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: by });
    ids.push(ref.id);
    if (++n >= 450) { await batch.commit(); batch = writeBatch(db); n = 0; }
  }
  if (n) await batch.commit();
  return ids;
}

// ── Spaces (bootstrap) ────────────────────────────────────────────────────
// Find the space this user belongs to, or create one on first login.
export async function findOrCreateSpaceForUser(user) {
  const q = query(
    collection(db, COLLECTIONS.spaces),
    where("members", "array-contains", user.uid),
    limit(1)
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  }
  // No space yet → create a personal one owned by this user.
  const ref = await addDoc(collection(db, COLLECTIONS.spaces), {
    name:      (user.displayName || user.email || "My") + " Network",
    ownerUid:  user.uid,
    members:   [user.uid],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const created = await getDoc(ref);
  return { id: created.id, ...created.data() };
}

// ── Domain helpers ─────────────────────────────────────────────────────────

// Canonicalise a LinkedIn URL so re-imports dedup reliably.
export function canonicalLinkedinUrl(url) {
  if (!url) return "";
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^https?:\/\//, "").replace(/^www\./, "");
  u = u.replace(/\/+$/, "").split("?")[0];
  return u; // e.g. "linkedin.com/in/andre-rocha"
}

// Normalise a company name for dedup/search matching.
export function normalizeCompany(name) {
  if (!name) return "";
  return String(name).trim().toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|ltd|limited|gmbh|sa|lda|s\.a\.|corp|co|company|group|holdings?)\b/g, "")
    .replace(/\s+/g, " ").trim();
}

// Stable, order-independent key for a relationship between two people.
export function pairKey(a, b) {
  return [a, b].sort().join("__");
}

// ── Relationships ───────────────────────────────────────────────────────────
// Create or strengthen an edge between two people. Deduped by pairKey so
// re-linking the same pair bumps its weight instead of duplicating.
export async function upsertRelationship(a, b, { type = "met_together", source = "manual", context = "" } = {}) {
  if (!a || !b || a === b) return;
  const key = pairKey(a, b);
  const q = query(
    collection(db, COLLECTIONS.relationships),
    where("spaceId", "==", requireSpace()),
    where("pairKey", "==", key),
    limit(1)
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    const d = snap.docs[0];
    await fbUpdate(doc(db, COLLECTIONS.relationships, d.id), {
      weight: (d.data().weight || 1) + 1,
      updatedAt: serverTimestamp(),
    });
    return d.id;
  }
  return createDoc(COLLECTIONS.relationships, {
    pairKey: key, personA: [a, b].sort()[0], personB: [a, b].sort()[1],
    type, source, context, weight: 1,
  });
}

// Link every pair among a set of attendees (a group meeting / same call).
export async function linkAttendees(personIds, opts = {}) {
  const ids = [...new Set(personIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      await upsertRelationship(ids[i], ids[j], opts);
}

// ── Companies & experiences ──────────────────────────────────────────────────
// Find a company by normalised name within the space, or create it.
export async function upsertCompany(name) {
  const norm = normalizeCompany(name);
  if (!norm) return null;
  const q = query(
    collection(db, COLLECTIONS.companies),
    where("spaceId", "==", requireSpace()),
    where("normalizedName", "==", norm),
    limit(1)
  );
  const snap = await getDocs(q);
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  const id = await createDoc(COLLECTIONS.companies, { name: name.trim(), normalizedName: norm });
  return { id, name: name.trim(), normalizedName: norm };
}

// Ensure a person's *current* experience matches (companyId, title). Closes a
// previous current role if the company changed (keeps work history for lookup).
export async function setCurrentExperience(personId, { companyId, companyName, title }) {
  const q = query(
    collection(db, COLLECTIONS.experiences),
    where("spaceId", "==", requireSpace()),
    where("personId", "==", personId),
    where("endDate", "==", null)
  );
  const snap = await getDocs(q);
  const current = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const match = current.find((e) => e.companyId === companyId);
  if (match) {
    if (title && title !== match.title) await updateDoc(COLLECTIONS.experiences, match.id, { title });
    return match.id;
  }
  // Company changed → close previous current roles.
  for (const e of current) await updateDoc(COLLECTIONS.experiences, e.id, { endDate: serverTimestamp() });
  return createDoc(COLLECTIONS.experiences, { personId, companyId, companyName, title: title || "", startDate: null, endDate: null });
}

// ── Formatting / safety helpers (lessons from Douro) ────────────────────────

// Escape user/imported text before injecting into innerHTML (Douro #4/#8).
export function escHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Neutralise CSV formula injection on export (Douro #11): prefix a cell that
// starts with = + - @ (or control chars) and is not a plain number.
export function csvCell(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(filename, rows) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Date helpers ────────────────────────────────────────────────────────────
export function tsToDate(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate();          // Firestore Timestamp
  if (v instanceof Date) return v;
  return new Date(v);                        // ISO string / millis
}

export function fmtDate(v) {
  const d = tsToDate(v);
  if (!d || isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(v) {
  const d = tsToDate(v);
  if (!d || isNaN(d)) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Re-export the Firestore query builders so views can pass constraints
// without importing the SDK directly.
export { where, orderBy, limit, serverTimestamp, writeBatch, arrayUnion, arrayRemove,
         collection, doc, getDocs, getDoc };
