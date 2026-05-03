# Calendar Widget Setup

Best free setup:

1. The booking app creates events directly in a real Google Calendar through Google Apps Script.
2. Phone shows those events through the Google Calendar widget.
3. PC can use the new Easy Loan Finance desktop widget page: `/widget`.

This is better than only using the `.ics` feed because `.ics` subscriptions can refresh slowly.

## 1. Direct Google Calendar Sync

Use a real Google Calendar ID ending in:

```text
@group.calendar.google.com
```

Do not use:

```text
primary
@import.calendar.google.com
```

In Render, use:

```text
GOOGLE_APPS_SCRIPT_CALENDAR_ID=ryan-real-google-calendar-id
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:ryan-real-google-calendar-id
```

For future brokers:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:ryan-calendar-id,broker-id:broker-calendar-id
```

If a broker does not have a direct calendar ID yet, they can still use their broker ICS link as a backup fallback.

## 2. PC Desktop Widget

Open:

```text
https://easy-loan-finance-booking.onrender.com/widget
```

The widget page shows:

1. Next appointment.
2. Today's bookings.
3. Upcoming bookings.
4. Broker colours and broker initials.
5. Ryan admin can switch between all brokers or one broker.
6. It auto refreshes every 8 seconds.

To make it float like a widget:

1. Install `Microsoft PowerToys`.
2. Open the Easy Loan Finance widget page in Chrome or Edge.
3. Make the browser window small.
4. Click the widget window.
5. Press:

```text
Windows + Ctrl + T
```

That pins the widget above other windows.

## 3. Phone Widget

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

## 4. PC Option B: Google Calendar App Shortcut

Use this if you prefer to view the native Google Calendar instead of the ELF widget.

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

## 5. PC Option C: Windows/Outlook Widget

Use this only if you specifically want Windows widget-style viewing.

1. Open https://outlook.live.com/calendar/
2. Sign in with the Microsoft account used on the PC.
3. Add/subscribe to the Easy Loan Finance calendar feed:

```text
https://easy-loan-finance-booking.onrender.com/calendar/team.ics
```

4. Open Windows Widgets.
5. Add or pin Outlook Calendar.

Note: this can update slower if it uses ICS. Use Google Calendar direct sync or the ELF `/widget` page as the main source of truth.

## 6. Test

1. Create a test booking on the client page.
2. Wait 10-30 seconds.
3. Check Google Calendar on the phone.
4. Check the ELF desktop widget:

```text
https://easy-loan-finance-booking.onrender.com/widget
```

If it does not appear, open the dashboard and check `Alerts & Sync`. `Google direct sync` should show `On`.

If you are using direct sync for Ryan, unsubscribe from the old Ryan ICS calendar in Google Calendar. Keeping both direct sync and ICS on will make duplicates.

## 7. Delete Sync

After the Apps Script code includes `calendar_delete` and you redeploy the Apps Script web app, deleting a booking from the dashboard also deletes the linked Google Calendar event.

If an old booking was created before Google direct sync was turned on, the app will still try to find the matching Google Calendar event by title and time. If the event title/time was manually changed, delete that old calendar event manually once.
