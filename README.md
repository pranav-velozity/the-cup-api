# The Cup — API

Backend for the team match-play golf scorer. Express + PostgreSQL (Render) +
Clerk auth. This is the **foundation**: the two-code gate flow (admin mints a
pass → organizer redeems it → player joins against the roster). Scoring, live
board (sockets), and push notifications layer on top of this later.

## What's here

```
server.js            App entry — middleware, routes, error handling
schema.sql           The database (run once via npm run migrate)
db/pool.js           Postgres pool + query/transaction helpers
db/migrate.js        Applies schema.sql
lib/codes.js         Unique 5-digit code generator
lib/phone.js         E.164 phone normalization (roster matching)
middleware/auth.js   Clerk requireAuth / requireAdmin + phone/email helpers
routes/admin.js      Mint / list / revoke gate passes  (admin only)
routes/organizer.js  Redeem pass, manage tournament / roster / matches
routes/player.js     Join via roster check, view + update registration
routes/public.js     Tournament summary for the join screen
render.yaml          One-click Render blueprint (web service + Postgres)
```

## Identity model

All three personas authenticate through **Clerk**:

- **Admin (you):** email sign-in. Mark yourself admin by setting
  `publicMetadata = { "role": "admin" }` on your user in the Clerk dashboard.
- **Organizer:** email sign-in. Becomes the owner of any tournament they create.
- **Player:** phone sign-in with **SMS OTP**, so their number is verified. The
  roster is then an *authorization* check — is this verified number invited, and
  on which team?

The API never stores passwords or OTPs — only Clerk user ids.

## Local setup

1. **Install**
   ```bash
   npm install
   ```
2. **Configure** — copy `.env.example` to `.env` and fill in your Render
   `DATABASE_URL` and Clerk keys.
3. **Create the tables**
   ```bash
   npm run migrate
   ```
4. **Run**
   ```bash
   npm run dev      # auto-reload
   # or
   npm start
   ```
   Health check: `GET http://localhost:3001/health`

## Deploy to Render

**Option A — Blueprint (easiest).** Push this repo to GitHub, then in Render
choose *New → Blueprint* and point it at the repo. `render.yaml` provisions the
web service *and* a free Postgres instance and wires `DATABASE_URL`
automatically. After the first deploy, add your `CLERK_*` keys and `CORS_ORIGIN`
in the service's Environment tab, then run the migration once from the Render
shell:
```bash
npm run migrate
```

**Option B — Manual.** Create a Render Postgres instance, create a Web Service
from the repo (`npm install` / `npm start`), set all env vars from
`.env.example`, deploy, then `npm run migrate` from the shell.

## Frontend wiring (next build)

The Netlify PWA will attach the Clerk session token to each request:

```js
const token = await window.Clerk.session.getToken();
fetch(`${API_URL}/api/organizer/tournaments`, {
  headers: { Authorization: `Bearer ${token}` },
});
```

Set `CORS_ORIGIN` to include the Netlify URL so the browser is allowed to call
the API.

## Endpoints

### Admin (requires `role: admin`)
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/admin/gate-passes` | Mint a pass. Body: `{ note? }` |
| GET | `/api/admin/gate-passes` | List all passes + status |
| POST | `/api/admin/gate-passes/:id/revoke` | Revoke an unused pass |

### Organizer (any signed-in user)
| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/organizer/redeem` | Redeem a pass → new tournament. Body: `{ code, name, teamA, teamB, singlesCount?, scrambleCount? }` |
| GET | `/api/organizer/tournaments` | My tournaments |
| GET | `/api/organizer/tournaments/:id` | Full detail (roster, matches, registrations) |
| PATCH | `/api/organizer/tournaments/:id` | Update teams / notify settings / status |
| POST | `/api/organizer/tournaments/:id/roster` | Add roster entries. Body: `{ entries: [{ team, planned_name?, phone }] }` |
| DELETE | `/api/organizer/tournaments/:id/roster/:entryId` | Remove a roster entry |
| PATCH | `/api/organizer/tournaments/:id/matches/:matchId` | Set match label / `sideA` / `sideB` |

### Player (signed-in via phone OTP)
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/tournaments/:code/summary` | Basic info to render the join screen |
| POST | `/api/player/join` | Join. Body: `{ code, name? }` — phone must be on the roster |
| GET | `/api/player/me?code=XXXXX` | My registration |
| PATCH | `/api/player/registrations/:id` | Update `{ name?, notifyEnabled? }` |

## Quick smoke test (after deploy)

1. In Clerk, set your user's `publicMetadata.role` to `"admin"`.
2. Mint a pass (with your Clerk token):
   ```bash
   curl -X POST $API/api/admin/gate-passes \
     -H "Authorization: Bearer $CLERK_TOKEN" \
     -H "Content-Type: application/json" -d '{"note":"first pass"}'
   ```
3. Redeem it as an organizer to create a tournament, add a roster entry with
   your own phone, then join as a player with that same number.
