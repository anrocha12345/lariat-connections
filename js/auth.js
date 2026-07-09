// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Auth guard + space bootstrap
// ─────────────────────────────────────────────────────────────────────────
import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { findOrCreateSpaceForUser, setActiveSpace } from "./data.js";

const LOGIN_PAGE = "login.html";

// Gate a protected page. Resolves with { user, space } once signed in and the
// active space is set. If not signed in, redirects to the login page.
export function requireAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = LOGIN_PAGE;
        return;
      }
      try {
        const space = await findOrCreateSpaceForUser(user);
        setActiveSpace(space.id);
        resolve({ user, space });
      } catch (err) {
        console.error("Space bootstrap failed:", err);
        // A signed-in user with no space access (e.g. a stranger who magic-linked
        // in) hits this — rules deny space creation for non-owners of their own
        // uid only in edge cases; surface a clear message rather than a blank app.
        document.body.innerHTML =
          '<div style="max-width:520px;margin:15vh auto;font-family:system-ui;text-align:center;color:#2A2723">' +
          '<h2>Access unavailable</h2>' +
          '<p>Your account isn\'t part of a network on Lariat Connections.</p>' +
          '<p><a href="' + LOGIN_PAGE + '">Return to sign in</a></p></div>';
      }
    });
  });
}

export async function doSignOut() {
  await signOut(auth);
  window.location.href = LOGIN_PAGE;
}
