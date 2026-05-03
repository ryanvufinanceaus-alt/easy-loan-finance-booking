# Easy Loan Finance Calendar Setup Guide

Muc tieu: booking trong app Easy Loan Finance tu hien tren Google Calendar/widget, va khi xoa booking trong dashboard thi event tren Google Calendar cung mat.

## Nguyen tac chinh

Khong dung ICS cho Ryan neu muon add/xoa nhanh.

Dung calendar that cua Google cho tung broker:

- Ryan co calendar rieng: `Ryan - Easy Loan Finance Live`
- Broker khac sau nay cung co calendar rieng
- Dashboard app van la noi Ryan admin xem toan team

ICS chi dung lam fallback mien phi cho broker nao chua setup direct sync. ICS co the update cham, xoa cham, va khong realtime.

## Khong dung nham

Khong dung Calendar ID kieu nay cho direct sync:

```text
...@import.calendar.google.com
```

Cai nay la ICS/import calendar, chi doc feed.

Calendar ID dung thuong giong:

```text
abc123xyz@group.calendar.google.com
```

Khong dung:

```text
GOOGLE_APPS_SCRIPT_CALENDAR_ID=primary
```

vi `primary` se day booking vao calendar chinh `Ryan Vu`, de roi.

## Setup Ryan hien tai

### 1. Tao calendar that cho Ryan

1. Mo Google Calendar.
2. Bam banh rang `Settings`.
3. Ben trai bam `Add calendar`.
4. Bam `Create new calendar`.
5. Name:

```text
Ryan - Easy Loan Finance Live
```

6. Time zone: `Australia/Adelaide`.
7. Bam `Create calendar`.
8. Vao calendar moi do trong Settings.
9. Keo xuong `Integrate calendar`.
10. Copy `Calendar ID`.

Calendar ID dung thuong co duoi:

```text
@group.calendar.google.com
```

### 2. Sua Render Environment Variables

Trong Render web service, giu cac bien Apps Script:

```text
GOOGLE_APPS_SCRIPT_EMAIL_URL=URL Apps Script email + calendar
GOOGLE_APPS_SCRIPT_EMAIL_TOKEN=token trong Apps Script
```

Doi hoac them:

```text
GOOGLE_APPS_SCRIPT_CALENDAR_ID=calendar-id-cua-Ryan-Easy-Loan-Finance-Live
```

Them map broker:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:calendar-id-cua-Ryan-Easy-Loan-Finance-Live
```

Vi du:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:abc123xyz@group.calendar.google.com
```

Sau do bam `Save Changes` va cho Render deploy.

### 3. Don calendar cu

Trong Google Calendar:

1. Bo tick hoac unsubscribe calendar ICS cu `Ryan - Easy Loan Finance ...` neu no co ID `@import.calendar.google.com`.
2. Tat hoac xoa `Booking pages -> (No title)` neu con block xanh duong dai.
3. Chi tick calendar moi `Ryan - Easy Loan Finance Live`.

### 4. Test Ryan

1. Tao booking test cho Ryan trong client booking page.
2. Mo Google Calendar web.
3. Booking phai hien trong `Ryan - Easy Loan Finance Live`, khong phai `Ryan Vu`.
4. Xoa booking trong dashboard.
5. Event trong `Ryan - Easy Loan Finance Live` phai mat.

Neu event khong mat, kiem tra Apps Script da deploy `New version` chua.

## Khi them broker moi

Vi du them broker ten Mia Nguyen.

### 1. Tao broker trong dashboard

1. Login dashboard bang Ryan admin.
2. Vao `Broker Management`.
3. Add broker.
4. Ghi nho broker ID sau khi tao.

Broker ID thuong la dang:

```text
mia-nguyen
```

### 2. Tao calendar that cho broker do

Trong Google Calendar:

1. `Settings`.
2. `Add calendar`.
3. `Create new calendar`.
4. Name:

```text
Mia Nguyen - Easy Loan Finance Live
```

5. Time zone: `Australia/Adelaide`.
6. Create calendar.
7. Vao `Integrate calendar`.
8. Copy `Calendar ID`.

### 3. Share calendar cho broker

Trong settings cua calendar broker:

1. Tim `Share with specific people or groups`.
2. Add email broker, vi du:

```text
mia@easyloanfinance.com.au
```

3. Permission nen de:

```text
See all event details
```

Neu broker can tu chinh event tren Google Calendar thi chon quyen cao hon, nhung mac dinh nen de chi xem.

### 4. Update Render variable

Tim bien:

```text
BROKER_GOOGLE_CALENDAR_IDS
```

Noi them broker moi bang dau phay.

Vi du ban dau:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:abc123@group.calendar.google.com
```

Sau khi them Mia:

```text
BROKER_GOOGLE_CALENDAR_IDS=ryan-vu:abc123@group.calendar.google.com,mia-nguyen:def456@group.calendar.google.com
```

Khong xuong dong trong value nay.

Sau do bam `Save Changes`, cho Render deploy.

### 5. Test broker moi

1. Tao booking test cho broker moi.
2. Mo calendar cua broker do.
3. Booking phai hien trong calendar rieng cua broker.
4. Xoa booking test trong dashboard.
5. Event phai mat khoi Google Calendar.

## Phone widget

Tren dien thoai broker:

1. Cai hoac mo Google Calendar.
2. Login dung Google account cua broker.
3. Dam bao calendar broker da duoc share cho account do.
4. Tick calendar broker trong Google Calendar.
5. Add Google Calendar widget ra man hinh chinh.

Neu khong thay booking tren widget:

1. Mo Google Calendar app.
2. Menu trai.
3. Tick calendar broker.
4. Vao app settings, bat sync cho calendar do.

## PC widget

Google Calendar khong co Windows widget native that su tot.

Phuong an tot nhat:

1. Mo https://calendar.google.com/ bang Chrome hoac Edge.
2. Login dung account.
3. Install thanh app:
   - Chrome: menu ba cham -> `Save and share` -> `Install page as app` hoac `Create shortcut`.
   - Edge: menu ba cham -> `Apps` -> `Install this site as an app`.
4. Pin app vao taskbar.

Neu muon Windows Widget that:

- Co the dung Outlook/Windows widget voi ICS feed.
- Nhung ICS update cham, khong realtime.
- Khong nen dung lam nguon chinh cho Ryan.

## Khi nao dung ICS

Dung ICS khi:

- Broker chua can realtime.
- Broker khong muon cap/share Google Calendar.
- Chi can xem lich, chap nhan update cham.

Link Ryan ICS:

```text
https://easy-loan-finance-booking.onrender.com/calendar/broker/ryan-vu.ics
```

Team ICS:

```text
https://easy-loan-finance-booking.onrender.com/calendar/team.ics
```

Broker khac:

```text
https://easy-loan-finance-booking.onrender.com/calendar/broker/BROKER-ID.ics
```

Nhuoc diem ICS:

- Google tu quyet dinh refresh.
- Xoa booking co the khong mat ngay.
- De trung neu bat cung luc direct sync.

## Troubleshooting

### Booking nhay vao `Ryan Vu`

Render dang de:

```text
GOOGLE_APPS_SCRIPT_CALENDAR_ID=primary
```

Doi sang Calendar ID cua calendar rieng `Ryan - Easy Loan Finance Live`.

### Calendar ID co `@import.calendar.google.com`

Ban dang mo ICS/import calendar cu. Khong dung ID nay.

Tao calendar moi that roi copy ID co dang `@group.calendar.google.com`.

### Booking khong hien tren Google Calendar

Kiem tra:

1. Apps Script URL/token dung trong Render.
2. Apps Script da `Deploy -> Manage deployments -> New version -> Deploy`.
3. Render da deploy xong sau khi save variables.
4. `BROKER_GOOGLE_CALENDAR_IDS` co dung broker ID va calendar ID.

### Xoa dashboard nhung calendar van con

Co the la:

- Event do nam trong ICS/import calendar cu.
- Booking cu tao truoc khi direct sync hoat dong.
- Apps Script chua deploy version co `calendar_delete`.

Cach test chuan la tao booking moi sau khi setup direct sync, roi xoa booking do.
