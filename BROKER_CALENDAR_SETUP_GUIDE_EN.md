# Easy Loan Finance Calendar Setup Guide

Goal: bookings from the Easy Loan Finance app should appear on Google Calendar/widgets, and deleting a booking from the dashboard should remove the matching Google Calendar event.

## Main Rule

Do not use ICS for Ryan if you want fast add/delete sync.

Use a real Google Calendar for each broker:

- Ryan has a dedicated calendar: `Ryan - Easy Loan Finance Live`
- Each future broker gets their own dedicated calendar
- The dashboard remains the place where Ryan admin can manage the full team

ICS is only a free fallback for brokers who do not have direct sync yet. ICS can refresh slowly and is not realtime.

## Do Not Confuse These

Do not use a Calendar ID like this for direct sync:

```text
...@import.calendar.google.com
```

That is an imported/subscribed ICS calendar. It is read-only from Google's side.

A correct real Google Calendar ID usually looks like:

```text
abc123xyz@group.calendar.google.com
```

Do not use:

```text
GOOGLE_APPS_SCRIPT_CALENDAR_ID=primary
```

`primary` sends bookings to the main `Ryan Vu` calendar, which gets messy.

## Current Ryan Setup

### 1. Create A Real Calendar For Ryan

1. Open Google Calendar.
2. Click the gear icon, then `Settings`.
3. On the left, click `Add calendar`.
4. Click `Create new calendar`.
5. Name:

```text
Ryan - Easy Loan Finance Live
```

6. Time zone: `Australia/Adelaide`.
7. Click `Create calendar`.
8. Open the new calendar in Settings.
9. Scroll to `Integrate calendar`.
10. Copy `Calendar ID`.

The correct Calendar ID usually ends with:

```text
@group.calendar.google.com
```

### 2. Update Render Environment Variables

Keep these Apps Script variables:

```text
GOOGLE_APPS_SCRIPT_EMAIL_URL=Apps Script email + calendar URL
GOOGLE_APPS_SCRIPT_EMAIL_TOKEN=Apps Script token
```

Set:

```text
GOOGLE_APPS_SCRIPT_CALENDAR_ID=Ryan calendar ID
```

Add broker mapping:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:Ryan calendar ID
```

Example:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:abc123xyz@group.calendar.google.com
```

Click `Save Changes` and wait for Render to redeploy.

### 3. Clean Old Calendars

In Google Calendar:

1. Untick or unsubscribe from the old ICS calendar `Ryan - Easy Loan Finance ...` if its ID contains `@import.calendar.google.com`.
2. Turn off or delete `Booking pages -> (No title)` if it creates long blue blocks.
3. Keep only `Ryan - Easy Loan Finance Live` ticked for booking sync.

### 4. Test Ryan

1. Create a test booking for Ryan from the client booking page.
2. Open Google Calendar web.
3. The booking should appear in `Ryan - Easy Loan Finance Live`, not `Ryan Vu`.
4. Delete the booking in the dashboard.
5. The event should disappear from `Ryan - Easy Loan Finance Live`.

If deletion does not work, check that Apps Script was redeployed as a `New version`.

## Adding A New Broker

Example: Mia Nguyen.

### 1. Create The Broker In The Dashboard

1. Login as Ryan admin.
2. Open `Broker Management`.
3. Add the broker.
4. Note the broker ID.

Example broker ID:

```text
mia-nguyen
```

### 2. Create A Real Google Calendar For That Broker

In Google Calendar:

1. Go to `Settings`.
2. Click `Add calendar`.
3. Click `Create new calendar`.
4. Name:

```text
Mia Nguyen - Easy Loan Finance Live
```

5. Time zone: `Australia/Adelaide`.
6. Create calendar.
7. Open `Integrate calendar`.
8. Copy `Calendar ID`.

### 3. Share The Calendar With The Broker

In the broker calendar settings:

1. Find `Share with specific people or groups`.
2. Add the broker email, for example:

```text
mia@easyloanfinance.com.au
```

3. Permission:

```text
See all event details
```

Use higher permissions only if the broker should edit events directly in Google Calendar.

### 4. Update Render

Find:

```text
BROKER_GOOGLE_CALENDAR_IDS
```

Append the new broker mapping with a comma.

Before:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:abc123@group.calendar.google.com
```

After:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:abc123@group.calendar.google.com,mia-nguyen:def456@group.calendar.google.com
```

Do not add line breaks inside the value.

Click `Save Changes` and wait for Render to redeploy.

### 5. Test The New Broker

1. Create a test booking for the new broker.
2. Open that broker's Google Calendar.
3. The booking should appear in the broker's calendar.
4. Delete the test booking in the dashboard.
5. The event should disappear from Google Calendar.

## Phone Widget

On the broker's phone:

1. Install or open Google Calendar.
2. Login with the broker's Google account.
3. Make sure the broker calendar has been shared with that account.
4. Tick the broker calendar in Google Calendar.
5. Add the Google Calendar widget to the home screen.

If bookings do not show:

1. Open the Google Calendar app.
2. Open the left menu.
3. Tick the broker calendar.
4. In app settings, enable sync for that calendar.

## PC Widget

Google Calendar does not have a strong native Windows widget.

Best free option:

1. Open https://calendar.google.com/ in Chrome or Edge.
2. Login with the right account.
3. Install it as an app:
   - Chrome: three-dot menu -> `Save and share` -> `Install page as app` or `Create shortcut`.
   - Edge: three-dot menu -> `Apps` -> `Install this site as an app`.
4. Pin it to the taskbar.

If you want a real Windows widget:

- You can use Outlook/Windows widget with an ICS feed.
- ICS refreshes slowly and is not realtime.
- Do not use it as Ryan's main source.

## When To Use ICS

Use ICS only when:

- The broker does not need realtime sync.
- The broker does not want a shared Google Calendar.
- They only need read-only viewing and can accept slow refresh.

Ryan ICS:

```text
https://easy-loan-finance-booking.onrender.com/calendar/broker/ryan-vu.ics
```

Team ICS:

```text
https://easy-loan-finance-booking.onrender.com/calendar/team.ics
```

Other broker:

```text
https://easy-loan-finance-booking.onrender.com/calendar/broker/BROKER-ID.ics
```

ICS limitations:

- Google decides when to refresh.
- Deleted bookings may remain visible for a while.
- Duplicates happen if ICS and direct sync are both enabled.

## Troubleshooting

### Booking Goes To `Ryan Vu`

Render is probably set to:

```text
GOOGLE_APPS_SCRIPT_CALENDAR_ID=primary
```

Replace it with the Calendar ID of `Ryan - Easy Loan Finance Live`.

### Calendar ID Contains `@import.calendar.google.com`

You are viewing an old ICS/import calendar. Do not use it.

Create a new real Google Calendar and copy the ID ending in `@group.calendar.google.com`.

### Booking Does Not Show In Google Calendar

Check:

1. Apps Script URL/token are correct in Render.
2. Apps Script was deployed through `Deploy -> Manage deployments -> New version -> Deploy`.
3. Render redeployed after saving variables.
4. `BROKER_GOOGLE_CALENDAR_IDS` has the correct broker ID and calendar ID.

### Dashboard Delete Does Not Remove Calendar Event

Possible causes:

- The event is in an old ICS/import calendar.
- The booking was created before direct sync worked.
- Apps Script was not redeployed with `calendar_delete`.

Best test: create a new booking after direct sync is set up, then delete that booking.
