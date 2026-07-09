// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — small UI helpers (toast, modal, DOM builder)
// ─────────────────────────────────────────────────────────────────────────
import { escHtml } from "./data.js";

export { escHtml };

// Toast notification
let toastEl = null;
export function toast(message, isError = false) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.className = "toast show" + (isError ? " toast--err" : "");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.className = "toast"; }, 2800);
}

// Modal. `contentHtml` is trusted markup you build; escape data inside it.
// Returns { close } and resolves interactions via your own listeners.
export function openModal(contentHtml, { wide = false } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal ${wide ? "modal--wide" : ""}">${contentHtml}</div>`;
  document.body.appendChild(backdrop);
  document.body.style.overflow = "hidden";
  const close = () => { backdrop.remove(); document.body.style.overflow = ""; };
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });
  return { el: backdrop, root: backdrop.querySelector(".modal"), close };
}

// Simple confirm dialog → Promise<boolean>
export function confirmDialog(message, { danger = false, okLabel = "Confirm" } = {}) {
  return new Promise((resolve) => {
    const m = openModal(`
      <div class="modal__head"><h3>Please confirm</h3></div>
      <p style="margin-bottom:22px;color:var(--text-light)">${escHtml(message)}</p>
      <div class="row" style="justify-content:flex-end">
        <button class="btn btn--ghost" data-act="cancel">Cancel</button>
        <button class="btn ${danger ? "btn--danger" : ""}" data-act="ok">${escHtml(okLabel)}</button>
      </div>`);
    m.root.querySelector('[data-act="cancel"]').onclick = () => { m.close(); resolve(false); };
    m.root.querySelector('[data-act="ok"]').onclick = () => { m.close(); resolve(true); };
  });
}

// Initials for avatar fallback
export function initials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Avatar markup (photo or initials)
export function avatarHtml(person, lg = false) {
  const cls = "avatar" + (lg ? " avatar--lg" : "");
  const name = person.displayName || `${person.firstName || ""} ${person.lastName || ""}`.trim();
  if (person.photoURL) return `<span class="${cls}"><img src="${escHtml(person.photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`;
  return `<span class="${cls}">${escHtml(initials(name))}</span>`;
}

// Deterministic pleasant colour from a string (for tags / graph nodes)
export function colorFor(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return `hsl(${h}, 45%, 55%)`;
}
