# M-Tech POS — Backend Server

This is the sync server that lets your desktop and phone (and Mujahid Comms) share
one live set of inventory, sales, and stock data. The POS frontend talks to this
server instead of storing everything only on one device.

## What's here

- `src/server.js` — the API (login, items, sales, sync)
- `src/schema.sql` — database tables (locations, users, items, sales, sale_lines, stock_adjustments)
- `src/setup.js` — one-time script that creates the tables and your owner login
- `src/auth.js` — login/token handling and location access rules
- `src/db.js` — database connection

## Deploying on Render (free to start)

1. Create a free account at https://render.com (no card needed)
2. Push this folder to a GitHub repo (or use Render's "Upload" option if available)
3. On Render: **New +** → **PostgreSQL** → create a free database, name it `mtech-pos-db`
4. Copy the **Internal Database URL** it gives you
5. **New +** → **Web Service** → connect this repo
   - Build command: `npm install`
   - Start command: `npm start`
   - Add environment variables:
     - `DATABASE_URL` = (the Internal Database URL from step 4)
     - `JWT_SECRET` = any long random string (e.g. generate one at https://generate-secret.vercel.app/32)
6. Once deployed, open the Render **Shell** tab for your web service and run:
   ```
   npm run setup
   ```
   This creates the M-Tech and Mujahid Comms locations and your owner login.
7. Your API is now live at something like `https://mtech-pos-server.onrender.com`

## Default owner login (created by setup script)

- Username: `muhammad`
- Password: `changeme123`

**Change this password immediately** — there's no "change password" screen yet,
so for now that means updating it directly via the `/api/users` endpoint or asking
me to add a password-change feature before you go live.

## Adding staff accounts

Once the server is running, create staff logins by sending a request like this
(I can build a simple admin screen for this instead of doing it by hand, just ask):

```
POST https://your-server.onrender.com/api/users
Authorization: Bearer <owner's login token>
Body: {
  "name": "Aisha",
  "username": "aisha",
  "password": "somepassword",
  "role": "staff",
  "locationId": 1
}
```

## Important free-tier notes

- The free Render database expires after 30 days unless upgraded — for real daily
  use, plan to move to the $7/month tier before that to avoid losing your sales data.
- The free web service "sleeps" after 15 minutes of no use, so the very first sale
  after a quiet period may take about a minute to load. This goes away on the paid tier.
