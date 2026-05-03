# Calendar Widget Setup

Best free setup:

1. The booking app creates Ryan's events directly in a separate Google Calendar through Google Apps Script.
2. Phone shows those events through the Google Calendar widget.
3. PC shows the same calendar through Google Calendar in Chrome/Edge as an app, or Outlook/Windows widgets if you prefer Microsoft.

This is better than only using the `.ics` feed because `.ics` subscriptions can refresh slowly.

## 1. Turn On Direct Google Calendar Sync

Do this after `GOOGLE_APPS_SCRIPT_EMAIL_SETUP.md` has been updated with the calendar code.

In Render, open the Easy Loan Finance Booking web service:

1. Click `Environment`.
2. Add:

```text
GOOGLE_APPS_SCRIPT_CALENDAR_ID=primary
```

3. Make sure these already exist:

```text
GOOGLE_APPS_SCRIPT_EMAIL_URL=your Apps Script web app URL
GOOGLE_APPS_SCRIPT_EMAIL_TOKEN=your Apps Script secret token
```

4. Click `Save Changes`.
5. Wait for Render to redeploy.

Recommended calendar:

1. In Google Calendar, create a new calendar called `Ryan - Easy Loan Finance`.
2. Open that calendar's settings.
3. Copy its `Calendar ID`.
4. In Render, use that ID:

```text
GOOGLE_APPS_SCRIPT_CALENDAR_ID=the Ryan - Easy Loan Finance calendar ID
```

If you use `primary`, bookings go into the main Google calendar. A separate calendar is cleaner because you can show/hide it on PC and phone widgets.

Now new Ryan bookings should go straight into that Google Calendar.

For future brokers, add broker-specific calendar IDs in Render:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:ryan-calendar-id,broker-id:broker-calendar-id
```

If a broker does not have a direct calendar ID yet, they can still use their broker ICS link as a free fallback.

## 2. Phone Widget

### iPhone

1. Install or open `Google Calendar`.
2. Sign in with `ryan.vufinanceaus@gmail.com`.
3. Open Google Calendar once and confirm bookings appear.
4. Long press the iPhone home screen.
5. Tap `+`.
6. Search `Google Calendar`.
7. Choose a widget size.
8. Tap `Add Widget`.

### Android

1. Install or open `Google Calendar`.
2. Sign in with `ryan.vufinanceaus@gmail.com`.
3. Long press the home screen.
4. Tap `Widgets`.
5. Choose `Google Calendar`.
6. Drag `Schedule` or `Month` to the home screen.

## 3. PC Option A: Google Calendar App Shortcut

This is the cleanest free PC option.

### Chrome

1. Open https://calendar.google.com/
2. Sign in with `ryan.vufinanceaus@gmail.com`.
3. Click the three dots in Chrome.
4. Click `Save and share`.
5. Click `Install page as app` or `Create shortcut`.
6. Tick `Open as window` if shown.
7. Pin it to the taskbar.

### Microsoft Edge

1. Open https://calendar.google.com/
2. Sign in with `ryan.vufinanceaus@gmail.com`.
3. Click the three dots in Edge.
4. Click `Apps`.
5. Click `Install this site as an app`.
6. Pin it to the taskbar.

## 4. PC Option B: Windows/Outlook Widget

Use this only if you specifically want Windows widget-style viewing.

1. Open https://outlook.live.com/calendar/
2. Sign in with the Microsoft account used on the PC.
3. Add/subscribe to the Easy Loan Finance calendar feed:

```text
https://easy-loan-finance-booking.onrender.com/calendar/team.ics
```

4. Open Windows Widgets.
5. Add or pin Outlook Calendar.

Note: this can update slower than direct Google Calendar sync. Use Google Calendar direct sync as the main source of truth.

## 5. Test

1. Create a test booking on the client page.
2. Wait 10-30 seconds.
3. Check Google Calendar on the phone.
4. Check the PC Google Calendar app shortcut.

If it does not appear, open the dashboard and check `Alerts & Sync`. `Google direct sync` should show `On`.

If you are using direct sync for Ryan, unsubscribe from the old Ryan ICS calendar in Google Calendar. Keeping both direct sync and ICS on will make duplicates.

## 6. Delete Sync

After the Apps Script code includes `calendar_delete` and you redeploy the Apps Script web app, deleting a booking from the dashboard also deletes the linked Google Calendar event.

If an old booking was created before Google direct sync was turned on, the app will still try to find the matching Google Calendar event by title and time. If the event title/time was manually changed, delete that old calendar event manually once.
