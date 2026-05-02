# Free-First Setup for Easy Loan Finance Booking

This setup keeps the booking system as close to $0 as possible until the broker team has enough volume to justify paid APIs or paid hosting.

## Recommended free stack

| Need | Free-first choice | Upgrade later when |
| --- | --- | --- |
| Website hosting | Render free web service | Cold starts hurt client conversion or traffic grows |
| Database | Supabase free Postgres | Storage, traffic, backups, or team access needs grow |
| Email alerts to broker | Existing Microsoft 365/Gmail SMTP | Sending limits or deliverability become a problem |
| Google Calendar visibility | ICS subscription feed | You need instant two-way sync or high booking volume |
| Client booking page | `/book` and `/book/ryan-vu` | Add custom domain, SMS reminders, payments |
| Admin security | `ADMIN_PASSWORD` login | Add full multi-user roles later |

## Zero-paid-API mode

Protect the dashboard first:

```text
ADMIN_EMAIL=ryan@easyloanfinance.com.au
ADMIN_PASSWORD=use-a-strong-password
ADMIN_SESSION_SECRET=use-a-long-random-secret
```

The client booking pages stay public. The dashboard and management APIs require login.

Use this first:

```text
GOOGLE_CALENDAR_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SERVICE_ACCOUNT_JSON=
```

Then use the ICS links already built into the dashboard:

```text
/calendar/team.ics
/calendar/broker/ryan-vu.ics
```

Google Calendar can subscribe to those URLs after the app is deployed publicly. This avoids Google Calendar API setup and avoids any direct API dependency.

## Email alert mode

Email alerts do not need a paid API. Use the SMTP account you already have.

Microsoft 365 example:

```text
BOOKING_NOTIFY_EMAIL=ryan@easyloanfinance.com.au
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@easyloanfinance.com.au
SMTP_PASS=your-password-or-app-password
SMTP_FROM=Easy Loan Finance <your-email@easyloanfinance.com.au>
```

Gmail example:

```text
BOOKING_NOTIFY_EMAIL=ryan@easyloanfinance.com.au
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM=Easy Loan Finance <your-gmail@gmail.com>
```

Keep email alerts to brokers/admins only at first. Avoid sending many client reminder emails until deliverability is tested.

## Supabase free mode

Use Supabase only for the database at first. Do not add Edge Functions, paid storage, or realtime features until needed.

Required env vars:

```text
SUPABASE_URL=your-project-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Paste `supabase-schema.sql` into Supabase SQL Editor once.

## Render free mode

Render free web services can sleep after inactivity. That is acceptable while testing, but the first client request after sleep may be slow.

Recommended settings:

```text
Build command: npm install && npm run build
Start command: npm start
Health check: /api/health
```

Do not add paid background workers yet.

## Cost-control rules

1. Keep Google direct sync off until ICS delay becomes a real problem.
2. Send only broker notification emails at first.
3. Keep client reminders manual until booking volume is consistent.
4. Use Supabase database only, not extra paid services.
5. Add rate limiting before sharing the booking link widely.
6. Upgrade hosting before buying APIs if the problem is slow page load.
7. Upgrade email provider before buying automation APIs if the problem is delivery.

## When to upgrade

Upgrade from free mode only when one of these becomes true:

- Clients complain that the booking page is slow because the free host sleeps.
- Google Calendar ICS refresh delay is hurting operations.
- Email notifications hit sending limits or land in spam.
- More brokers need permissions, audit logs, or proper admin roles.
- You need SMS reminders, two-way calendar availability, or payment collection.

The first paid upgrade should usually be hosting, then email deliverability, then direct calendar API, in that order.
