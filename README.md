# Lariat Connections

A private CRM for your **whole** network — professional, family and friends. Import your
LinkedIn connections, keep notes and meeting history, track birthdays and follow-ups, look up
who you know at any company, and explore a living relationship map.

Independent project. Inspired by the Douro Partners stack (static site + Firebase) but shares
no code, repo, or Firebase project with it.

## Stack
- **Static site** — vanilla HTML/CSS/JS, Firebase modular SDK via CDN. No build step.
- **Firebase** — Auth (passwordless magic link), Firestore (data), Storage (photos).
- **Hosting** — GitHub Pages (`aninse123.github.io/lariat-connections/`).
- **Libraries (CDN)** — PapaParse (CSV import), Cytoscape.js (map), FullCalendar (calendar).

## One-time setup

### 1. Firebase (~5 min)
1. Create a **new** Firebase project, e.g. `lariat-connections`.
2. **Authentication** → Sign-in method → enable **Email link (passwordless sign-in)**.
3. **Firestore Database** → create (production mode), region `eur3`.
4. **Storage** → create, region `europe-west1`.
5. Project settings → **Your apps** → add a **Web app** → copy the config object into
   [`js/firebase-config.js`](js/firebase-config.js) (replace the `PASTE_*` values).
6. **Authentication → Settings → Authorized domains** → add `aninse123.github.io`
   (and `localhost` for local testing; it's usually there by default).
7. Publish the security rules: paste [`firestore.rules`](firestore.rules) into
   Firestore → Rules, and [`storage.rules`](storage.rules) into Storage → Rules.
   *(Optional: set a €1 Google Cloud billing alert as a safety net.)*

### 2. GitHub Pages
1. Create a repo named **`lariat-connections`** and push this folder to `main`.
2. Repo → Settings → **Pages** → Source: **Deploy from a branch**, branch **main / root**.
3. Live at `https://aninse123.github.io/lariat-connections/`.

## Local development
Serve the folder over http (module scripts need it — `file://` won't work):

```bash
cd C:/Users/andre/Network_CRM
python -m http.server 8000
#   → open http://localhost:8000
```

Local dev talks to the same live Firebase project; the security rules protect the data.

## Import your LinkedIn connections
LinkedIn → **Settings & Privacy → Data privacy → Get a copy of your data → Connections** →
download `Connections.csv`. In Lariat, go to **Import** and upload it. Re-imports are safe
(deduplicated by LinkedIn profile URL).

## Project layout
```
index.html      Landing page
login.html      Magic-link sign-in
app.html        The app shell (routes to the views below)
js/
  firebase-config.js   Firebase project config (edit this)
  data.js              Firestore data layer (space-scoped CRUD + helpers)
  auth.js              Auth guard + space bootstrap
  ui.js                Toast / modal / avatar helpers
  views/               dashboard · people · companies · calendar · map · import · settings
firestore.rules storage.rules firebase.json   Security rules (keep in sync with console)
```

## Data model (Firestore)
Every doc carries a `spaceId`. A `spaces/{id}` doc lists `members[]`. Today there's one space
(just you). Adding a friend later = adding their UID to `members` — no data migration.

Collections: `spaces`, `people`, `experiences`, `companies`, `interactions`, `relationships`,
`events`, `tags`, `userConfig`.
