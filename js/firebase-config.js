// ─────────────────────────────────────────────────────────────────────────
// Lariat Connections — Firebase configuration
// ─────────────────────────────────────────────────────────────────────────
// TODO(André): paste the config from your NEW Firebase project here.
//   Firebase console → Project settings → General → Your apps → Web app → Config.
// Until this is filled in, the app will show a friendly "not configured" notice
// instead of crashing.
//
// This is a *new, dedicated* project (e.g. "lariat-connections") — do NOT reuse
// the douro-partners project.
// ─────────────────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-storage.js";

export const firebaseConfig = {
  apiKey:            "PASTE_API_KEY",
  authDomain:        "PASTE_PROJECT.firebaseapp.com",
  projectId:         "PASTE_PROJECT",
  storageBucket:     "PASTE_PROJECT.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId:             "PASTE_APP_ID",
};

// True once real values are in place. Pages check this to show a setup notice.
export const IS_CONFIGURED = !firebaseConfig.apiKey.startsWith("PASTE_");

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Firestore with offline persistence (IndexedDB) + multi-tab support.
// Serves repeat page loads from local cache and only fetches changed docs from
// the server — keeps reads low at scale and makes navigation fast. Falls back
// to memory cache automatically if IndexedDB is unavailable.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);
