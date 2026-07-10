// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Background jobs
// A tiny in-memory pub/sub for long-running operations (imports). Jobs live
// here, not in any view's DOM, so they keep running and stay visible (via the
// persistent tray in app.html) no matter which page you navigate to — this is
// a single-page app, so switching views never reloads the page or interrupts
// an in-flight async chain; the only thing that used to break was the
// *progress UI*, which was wired to DOM that got replaced on navigation.
// ─────────────────────────────────────────────────────────────────────────

const jobs = new Map(); // id → { id, type, label, status, progress, total, message }
const listeners = new Set();
let counter = 0;

function emit() { const list = getJobs(); listeners.forEach((fn) => fn(list)); }

export function getJobs() { return [...jobs.values()]; }

export function subscribe(fn) {
  listeners.add(fn);
  fn(getJobs());
  return () => listeners.delete(fn);
}

export function isRunning(type) {
  return getJobs().some((j) => j.type === type && j.status === "running");
}

// Start a job. Returns a handle to update/finish it. `type` lets callers
// avoid starting a duplicate of the same kind of work (see isRunning).
export function startJob(label, type) {
  const id = "job" + (++counter) + "_" + Date.now();
  jobs.set(id, { id, type, label, status: "running", progress: 0, total: 0, message: "Starting…" });
  emit();
  return {
    id,
    update(partial) { const j = jobs.get(id); if (!j) return; Object.assign(j, partial); emit(); },
    done(message) {
      const j = jobs.get(id); if (!j) return;
      j.status = "done"; j.message = message || "Done"; j.progress = j.total || j.progress;
      emit();
      setTimeout(() => { jobs.delete(id); emit(); }, 6000);
    },
    fail(message) {
      const j = jobs.get(id); if (!j) return;
      j.status = "error"; j.message = message || "Failed"; emit();
    },
  };
}

// Safety net: warn before closing/refreshing the tab while a job is running
// (this only protects against an actual tab close — navigating between views
// in the app never triggers it, since that's just a hash change).
window.addEventListener("beforeunload", (e) => {
  if (getJobs().some((j) => j.status === "running")) { e.preventDefault(); e.returnValue = ""; }
});
