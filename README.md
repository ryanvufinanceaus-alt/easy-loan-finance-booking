# Easy Loan Finance Booking

A professional broker booking calendar for Easy Loan Finance. It runs free locally with JSON storage, then scales to Supabase free tier by adding two environment variables.

For the lowest-cost operating plan, start with [FREE_FIRST_SETUP.md](./FREE_FIRST_SETUP.md).
For a Vietnamese click-by-click setup guide, read [HUONG_DAN_FREE_TUNG_BUOC.md](./HUONG_DAN_FREE_TUNG_BUOC.md).
For GitHub and Render deployment steps, read [HUONG_DAN_GITHUB_RENDER.md](./HUONG_DAN_GITHUB_RENDER.md).

## What is included

- Team and per-broker calendar views: month, week, and day.
- Multi-broker filtering for Easy Loan Finance staff.
- Broker management: add brokers, view broker booking counts, and remove brokers by moving their bookings to another broker first.
- Appointment form with client, broker, service, channel, duration, status, and notes.
- Booking management: filter by broker, update status, open in Google, copy Google link, and delete bookings.
- Ryan admin login: set `ADMIN_PASSWORD` to protect the dashboard while public booking links stay open.
- Dashboard auto-refreshes bookings while open; use the Refresh button for an instant manual pull.
- Replace `public/elf-logo.png` with your real local ELF logo file to update the brand everywhere.
- Public client booking pages:
  - Team page: `/book`
  - Broker page: `/book/ryan-vu`
- Public availability picker: clients choose fixed 30-minute weekday slots, Monday-Friday from 9:30 AM to 5:00 PM, and booked slots are crossed out.
- Email notifications for every new booking when SMTP settings are configured.
- Google Calendar support without paid APIs:
  - Team feed: `/calendar/team.ics`
  - Broker feed: `/calendar/broker/ryan-vu.ics`
  - One-click Google event links from each appointment.
- Optional instant Google Calendar API sync using a free Google service account.
- Production server with `/api/health`, `/api/brokers`, `/api/bookings`, and ICS endpoints.
- Optional Supabase storage for many brokers using `supabase-schema.sql`.

## Run locally

```powershell
npm install
npm run build
npm start
```

Open:

```text
http://localhost:3000
```

Client booking link:

```text
http://localhost:3000/book
http://localhost:3000/book/ryan-vu
```

## Email alerts

Current free email setup: Gmail sends as the verified alias `hello@easyloanfinance.com.au`, internal alerts go to `ryan.vufinanceaus@gmail.com`, and `ryan@easyloanfinance.com.au` stays reserved for settled clients.

```text
BOOKING_NOTIFY_EMAIL=ryan.vufinanceaus@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=ryan.vufinanceaus@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM=Easy Loan Finance <hello@easyloanfinance.com.au>
CLIENT_CONFIRMATION_EMAILS=true
CLIENT_CONFIRMATION_FROM=Easy Loan Finance <hello@easyloanfinance.com.au>
CLIENT_REPLY_TO=hello@easyloanfinance.com.au
```

Use a Gmail app password, not the normal Gmail login password.

## Google Calendar on phone

For local testing, use the "Open in Google" button on any booking.

For live phone sync:

1. Deploy the app to a public URL.
2. Send clients the public booking URL, for example `https://your-domain.com/book/ryan-vu`.
3. Copy the Team ICS or Broker ICS link from the app.
4. In Google Calendar desktop web, add calendar by URL.
5. On your phone, open Google Calendar settings and enable the subscribed calendar.

This avoids Google OAuth costs and keeps the workflow simple.

## Instant Google Calendar sync

The ICS feed is free and automatic after you subscribe, but Google decides how often to refresh it. For faster event creation, use the optional Google service account sync:

1. Go to Google Cloud Console.
2. Create a project.
3. Enable Google Calendar API.
4. Create a Service Account.
5. Create a JSON key for that service account.
6. In Google Calendar, create a calendar such as `Easy Loan Finance Bookings`.
7. Share that calendar with the service account email and give it permission to make changes.
8. Add these environment variables:

```text
GOOGLE_CALENDAR_ID=your-calendar-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account-name@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
```

You can also paste the full JSON key into `GOOGLE_SERVICE_ACCOUNT_JSON` instead of using `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY`.

Once configured, new booking requests are created directly in that Google Calendar and still remain in the app dashboard.

## Scale with Supabase

1. Create a Supabase project.
2. Open SQL Editor.
3. Paste the contents of `supabase-schema.sql`.
4. Add these environment variables to your hosting provider:

```text
SUPABASE_URL=your-project-url
SUPABASE_SECRET_KEY=sb_secret_...
```

If those variables are present, the server uses Supabase. If they are blank, it uses local JSON storage in `data/`.

Keep the service role key only in server environment variables. Do not paste it into frontend code.

## Deploy

Recommended free-first setup:

```text
Build command: npm install && npm run build
Start command: npm start
Health check: /api/health
```

Keep the root directory blank unless this app is inside a subfolder of a larger repository.
