# The Cup — Web (frontend)

The link version of the app. React + Vite PWA, Clerk phone-OTP sign-in, talking
to the Render API. This first build covers the **gate flow only**: sign in →
(admin) mint a pass → (organizer) redeem a pass and create a tournament →
(player) join against the roster. Scoring + live board + push come next.

## Stack

- React + Vite, deployed to **Netlify**
- **Clerk** for auth (phone OTP — same as the backend)
- Calls the Render API (`the-cup-api`) with the Clerk session token

## Environment variables

Copy `.env.example` to `.env` (local) and set the same two in Netlify:

| Var | Value |
| --- | --- |
| `VITE_API_URL` | Your Render API URL, e.g. `https://the-cup-api.onrender.com` (no trailing slash) |
| `VITE_CLERK_PUBLISHABLE_KEY` | The `pk_...` key from Clerk |

## Run locally

```bash
npm install
npm run dev
```
Open the printed localhost URL. (Your local origin needs to be allowed by the
API's `CORS_ORIGIN` — during building it's set to `*`, so this just works.)

## Deploy to Netlify

1. Push this folder to a GitHub repo named `the-cup-web`.
2. In Netlify: **Add new site → Import from Git**, pick the repo.
3. Build settings are auto-detected from `netlify.toml` (build `npm run build`,
   publish `dist`).
4. Add the two environment variables above under **Site settings → Environment**.
5. Deploy. You'll get a URL like `the-cup.netlify.app`.
6. **Back in Render**, change `CORS_ORIGIN` from `*` to that exact Netlify URL so
   only your site can call the API.

## Making yourself admin

The admin card only appears for users whose Clerk `publicMetadata` is
`{ "role": "admin" }`.

1. Sign in once (so your Clerk user exists).
2. In the Clerk dashboard → Users → your user → edit **Public metadata** to:
   ```json
   { "role": "admin" }
   ```
3. Refresh the app — the "Admin — gate passes" card appears.

## Testing the full gate flow

1. **Admin:** mint a gate pass (note the 5-digit code).
2. **Organizer:** Home → Create a tournament → enter that pass → set teams →
   create. You'll get a tournament code. On the success screen, add a player
   phone number to the roster (use a real number you can receive SMS on, or a
   Clerk test number).
3. **Player:** sign in with that phone number, Home → Join a tournament → enter
   the tournament code → your name → Join. You should land on "You're in" with
   your team.

> Clerk test mode: any fictional phone number can be verified with code
> **424242**, so you can exercise the player path without real SMS. Make sure the
> roster number you add matches the test number you sign in with.

## Notes

- Sign-in uses Clerk's prebuilt component with `routing="hash"`, so no router is
  needed and the Netlify SPA redirect in `netlify.toml` covers deep links.
- First API call after the service has been idle can take ~30–50s on Render's
  free web tier (cold start). Paid instances remove this.
