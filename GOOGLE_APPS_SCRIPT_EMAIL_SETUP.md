# Free Email And Calendar Fix: Gmail via Google Apps Script

Render free can time out on Gmail SMTP ports `465` and `587`. This setup sends email and creates Google Calendar events through HTTPS instead, so the booking app does not depend on blocked SMTP ports or slow `.ics` refresh.

## 1. Create Apps Script

1. Open https://script.google.com/
2. Click `New project`.
3. Name it `Easy Loan Finance Booking Email Calendar`.
4. Delete the sample code.
5. Paste this code:

```javascript
const SECRET_TOKEN = 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET';
const DEFAULT_FROM = 'hello@easyloanfinance.com.au';
const DEFAULT_NAME = 'Easy Loan Finance';

function doGet() {
  return json({
    ok: true,
    email: Session.getActiveUser().getEmail(),
    aliases: GmailApp.getAliases(),
    calendar: CalendarApp.getDefaultCalendar().getName()
  });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (payload.token !== SECRET_TOKEN) {
      return json({ ok: false, error: 'Unauthorized token' });
    }

    if (payload.type === 'calendar') {
      return syncCalendarEvent(payload);
    }

    if (payload.type === 'calendar_delete') {
      return deleteCalendarEvent(payload);
    }

    if (!payload.to || !payload.subject) {
      return json({ ok: false, error: 'Missing to or subject' });
    }

    const aliases = GmailApp.getAliases();
    const from = String(payload.from || DEFAULT_FROM).trim();
    const options = {
      name: payload.name || DEFAULT_NAME,
      htmlBody: payload.html || undefined,
      replyTo: payload.replyTo || undefined
    };

    if (from && aliases.indexOf(from) !== -1) {
      options.from = from;
    }

    GmailApp.sendEmail(
      payload.to,
      String(payload.subject).slice(0, 250),
      payload.text || stripHtml(payload.html || ''),
      options
    );

    return json({
      ok: true,
      sentFrom: options.from || Session.getActiveUser().getEmail(),
      aliases
    });
  } catch (error) {
    return json({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function syncCalendarEvent(payload) {
  const calendar = getCalendar(payload.calendarId);
  const data = payload.event || {};
  const start = new Date(data.start.dateTime);
  const end = new Date(data.end.dateTime);
  const options = {
    description: data.description || '',
    location: data.location || ''
  };

  let event = payload.eventId ? calendar.getEventById(payload.eventId) : null;
  if (event) {
    event.setTitle(data.summary || 'Easy Loan Finance booking');
    event.setTime(start, end);
    event.setDescription(options.description);
    event.setLocation(options.location);
  } else {
    event = calendar.createEvent(data.summary || 'Easy Loan Finance booking', start, end, options);
  }

  return json({
    ok: true,
    eventId: event.getId(),
    htmlLink: event.getHtmlLink()
  });
}

function deleteCalendarEvent(payload) {
  const calendar = getCalendar(payload.calendarId);
  const data = payload.event || {};
  let event = payload.eventId ? calendar.getEventById(payload.eventId) : null;

  if (!event && data.start && data.end) {
    const start = new Date(data.start.dateTime);
    const end = new Date(data.end.dateTime);
    const title = data.summary || '';
    const events = calendar.getEvents(
      new Date(start.getTime() - 5 * 60 * 1000),
      new Date(end.getTime() + 5 * 60 * 1000)
    );
    event = events.find(function(item) {
      return item.getTitle() === title;
    }) || null;
  }

  if (event) {
    event.deleteEvent();
  }
  return json({ ok: true, deleted: Boolean(event) });
}

function getCalendar(calendarId) {
  if (!calendarId || calendarId === 'primary') {
    return CalendarApp.getDefaultCalendar();
  }
  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    throw new Error('Calendar not found: ' + calendarId);
  }
  return calendar;
}

function testAuth() {
  const aliases = GmailApp.getAliases();
  Logger.log(aliases);
  const options = { name: DEFAULT_NAME };
  if (aliases.indexOf(DEFAULT_FROM) !== -1) {
    options.from = DEFAULT_FROM;
  }
  GmailApp.sendEmail(
    Session.getActiveUser().getEmail(),
    'Easy Loan Finance email test',
    'Apps Script email is working.',
    options
  );

  CalendarApp.getDefaultCalendar().createEvent(
    'Easy Loan Finance calendar test',
    new Date(Date.now() + 60 * 60 * 1000),
    new Date(Date.now() + 90 * 60 * 1000),
    { description: 'Apps Script calendar sync is working.' }
  );
}

function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function json(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 2. Set Secret Token

Change this line:

```javascript
const SECRET_TOKEN = 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET';
```

Use any long private text, for example:

```text
elf-booking-email-2026-ryan-private
```

Use the exact same value in Render later as `GOOGLE_APPS_SCRIPT_EMAIL_TOKEN`.

## 3. Authorise Gmail And Calendar

1. In Apps Script, choose function `testAuth`.
2. Click `Run`.
3. Google will ask permission.
4. Choose the Gmail account `ryan.vufinanceaus@gmail.com`.
5. Click `Advanced` if Google shows a warning.
6. Click `Go to Easy Loan Finance Booking Email`.
7. Allow Gmail and Calendar access.

Check your Gmail inbox. You should receive `Easy Loan Finance email test`.
Check Google Calendar. You should see `Easy Loan Finance calendar test`.

Important: `hello@easyloanfinance.com.au` must appear in `GmailApp.getAliases()`. If it does not, Apps Script will send from the Gmail account instead.

## 4. Deploy Web App

1. Click `Deploy`.
2. Click `New deployment`.
3. Select type `Web app`.
4. Description: `Booking email and calendar sender`.
5. Execute as: `Me`.
6. Who has access: `Anyone`.
7. Click `Deploy`.
8. Copy the `Web app URL`.

It should look like:

```text
https://script.google.com/macros/s/AKfycb.../exec
```

## 5. Add Render Environment Variables

In Render, open the booking web service:

1. Go to `Environment`.
2. Add:

```text
GOOGLE_APPS_SCRIPT_EMAIL_URL=your Web app URL
GOOGLE_APPS_SCRIPT_EMAIL_TOKEN=the same SECRET_TOKEN
GOOGLE_APPS_SCRIPT_CALENDAR_ID=primary
SMTP_FROM=Easy Loan Finance <hello@easyloanfinance.com.au>
CLIENT_CONFIRMATION_FROM=Easy Loan Finance <hello@easyloanfinance.com.au>
CLIENT_REPLY_TO=hello@easyloanfinance.com.au
BOOKING_NOTIFY_EMAIL=ryan.vufinanceaus@gmail.com
```

3. Click `Save Changes`.
4. Render will redeploy.

You can leave the old `SMTP_*` variables there. The app will use Apps Script first when the Apps Script URL and token are present.

`GOOGLE_APPS_SCRIPT_CALENDAR_ID=primary` means bookings go into the main Google Calendar of `ryan.vufinanceaus@gmail.com`. If you later create a separate Google calendar called `Easy Loan Finance Bookings`, use that calendar ID instead.

## 6. Test

1. Open the Easy Loan Finance dashboard.
2. Go to email/integration settings.
3. Click `Send Test Email`.
4. Expected result: success.

If it fails with `Unauthorized token`, the token in Apps Script and Render does not match.

If it sends from Gmail instead of `hello@easyloanfinance.com.au`, open Gmail settings and confirm `hello@easyloanfinance.com.au` is listed under `Send mail as`, then run `testAuth` again and check the Apps Script logs.

After this setup, new confirmed bookings will create Google Calendar events directly. Your phone widget and PC Google Calendar view should follow the same Google Calendar account.
