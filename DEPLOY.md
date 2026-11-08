# Deploying The Traitors on Railway

Three Railway services from this one repo: **MongoDB**, the **backend**
(FastAPI), and the **frontend** (Expo web). No App Store involved — players
open the frontend URL in Safari and tap **Share → Add to Home Screen**.

Deploy order matters: **Mongo → backend → frontend**, because the frontend
bakes the backend's URL in at build time.

---

## 1. MongoDB

In your Railway project: **New → Database → Add MongoDB**.

Railway creates the DB and a connection string variable (shown on the Mongo
service's **Variables** tab, usually `MONGO_URL`, e.g.
`mongodb://mongo:...@...railway.internal:27017`).

> Alternative: a free **MongoDB Atlas** M0 cluster works too — just copy its
> `mongodb+srv://...` connection string for the step below.

## 2. Backend (FastAPI)

**New → GitHub Repo →** this repo. Then on the service:

- **Settings → Root Directory:** `backend`
  (Railway auto-detects `backend/Dockerfile`.)
- **Variables:**
  | Name | Value |
  |------|-------|
  | `MONGO_URL` | reference the Mongo service's connection string (`${{ MongoDB.MONGO_URL }}`) or paste your Atlas URI |
  | `DB_NAME` | `traitors` |

  `server.py` reads both at startup, so **the service won't boot without
  them.** `PORT` is provided by Railway automatically — don't set it.
- **Settings → Networking → Generate Domain.** Copy this URL
  (e.g. `https://traitors-backend-production.up.railway.app`) — the frontend
  needs it next.
- Health check path: `/health` (optional but recommended).

Verify: open `https://<backend-url>/api/` — you should see
`{"message":"The Traitors"}`.

## 3. Frontend (Expo web)

**New → GitHub Repo →** the same repo again (a second service). Then:

- **Settings → Root Directory:** `frontend`
  (auto-detects `frontend/Dockerfile`.)
- **Variables:**
  | Name | Value |
  |------|-------|
  | `EXPO_PUBLIC_BACKEND_URL` | the backend URL from step 2, **no trailing slash**, e.g. `https://traitors-backend-production.up.railway.app` |

  This is inlined into the JS bundle during `expo export`, so **changing it
  later requires a redeploy** (rebuild), not just a restart.
- **Settings → Networking → Generate Domain.** This is the URL you share with
  players.

## 4. Put it on iPhones

Open the frontend URL in **Safari** → **Share → Add to Home Screen**. It
installs full-screen with the app icon (PWA bits live in `frontend/app/+html.tsx`
and `frontend/public/`). Share the same link with everyone; each phone joins a
game with the 5-character code.

---

## Notes & gotchas

- **CORS** is already wide open in `server.py` (`allow_origins=["*"]`), so the
  two separate domains talk fine.
- **Backend deps:** the Dockerfile installs `requirements-railway.txt` (slim),
  not `requirements.txt` — the full file includes `emergentintegrations`, a
  private package not on public PyPI that would break the build. `server.py`
  needs nothing from it.
- **In-memory game locks:** `server.py` serialises writes per game with
  in-process `asyncio.Lock`s. That is correct for a **single** backend instance.
  If you ever scale the backend to more than one replica, two replicas could
  resolve the same day concurrently — keep it at one instance (the default).
- **No offline mode:** the app polls the backend every ~4s, so it needs a
  connection; Add-to-Home-Screen gives the app-like shell, not offline play.
- **One combined service?** You can't — a static Expo export and a Python
  server are different runtimes. Keep them as two services (plus Mongo).
