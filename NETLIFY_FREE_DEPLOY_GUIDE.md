# Netlify Free Deploy Guide

Use this to move Easy Loan Finance Booking away from Render Free sleep.

Netlify will host:

1. Frontend from `dist`.
2. API through Netlify Functions.
3. Reminder emails through Netlify Scheduled Function every 5 minutes.

Supabase, Google Apps Script email, and Google Calendar sync stay the same.

## 1. Create Netlify Site

1. Open `https://app.netlify.com/`.
2. Sign in with GitHub.
3. Click `Add new site`.
4. Click `Import an existing project`.
5. Choose GitHub.
6. Select:

```text
ryanvufinanceaus-alt/easy-loan-finance-booking
```

7. Netlify should read `netlify.toml` automatically.

Check these values:

```text
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
```

8. Do not deploy yet if environment variables are empty.

## 2. Add Environment Variables

In Netlify:

1. Open the site.
2. Go to `Site configuration`.
3. Go to `Environment variables`.
4. Add the same values currently used in Render.

Required:

```text
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_SESSION_SECRET
BOOKING_NOTIFY_EMAIL
BOOKING_TIME_ZONE
CLIENT_CONFIRMATION_EMAILS
CLIENT_CONFIRMATION_FROM
CLIENT_REPLY_TO
SUPABASE_URL
SUPABASE_SECRET_KEY
GOOGLE_APPS_SCRIPT_EMAIL_URL
GOOGLE_APPS_SCRIPT_EMAIL_TOKEN
GOOGLE_APPS_SCRIPT_CALENDAR_ID
BROKER_GOOGLE_CALENDAR_IDS
```

Set this after Netlify gives you the site URL:

```text
PUBLIC_APP_URL=https://your-netlify-site-name.netlify.app
```

If you are using Apps Script email, you do not need Gmail SMTP on Netlify.

Optional SMTP fallback:

```text
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
SMTP_FROM
```

## 3. Deploy

1. Click `Deploy site`.
2. Wait until deploy is finished.
3. Open:

```text
https://your-netlify-site-name.netlify.app/api/health
```

You should see:

```json
{"ok":true,"app":"easy-loan-finance-booking"}
```

## 4. Test Booking

Open:

```text
https://your-netlify-site-name.netlify.app/book/ryan-vu
```

Create a test booking.

Check:

1. The client sees confirmation.
2. Client email arrives.
3. Ryan/broker notification email arrives.
4. Google Calendar event appears.
5. Dashboard login works.

Dashboard:

```text
https://your-netlify-site-name.netlify.app/
```

## 5. Reminder Emails

The scheduled reminder function is configured in `netlify.toml`:

```text
[functions."reminders"]
  schedule = "*/5 * * * *"
```

Netlify runs this on published deploys only.

To test:

1. Open Netlify site dashboard.
2. Go to `Functions`.
3. Find `reminders`.
4. It should show as scheduled.
5. Use `Run now` if Netlify shows that button.

## 6. Update Desktop Widget

After Netlify works, edit:

```text
C:\Users\User\OneDrive\Documents\New project 2\desktop-widget\widget-url.txt
```

Replace the Render URL with:

```text
https://your-netlify-site-name.netlify.app/widget?desktop=1
```

Then close and reopen:

```text
Start ELF Booking Widget Hidden.vbs
```

## 7. Keep Render As Backup

Do not delete Render immediately.

Recommended:

1. Keep Render for 3-7 days as backup.
2. Use Netlify link for client booking.
3. If Netlify is stable, move the GoDaddy domain to Netlify.
4. Later, pause or remove Render.

## 8. Important Limits

Netlify free has usage limits, but it does not sleep like Render Free web services.

This app should be fine on free while traffic is small because:

1. Supabase stores the data.
2. Email and calendar are handled by Apps Script.
3. API calls are small.
4. Reminder cron runs every 5 minutes.

When the app has regular real client traffic, upgrade to a paid plan on the platform you prefer.
