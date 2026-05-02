# Huong Dan Free Tung Buoc - Easy Loan Finance Booking

Muc tieu: co link booking online cho khach, co email bao ve cho broker, co Google Calendar xem tren dien thoai, nhung chua mat tien API.

## Tong quan can dung gi

Dung 4 thu:

1. GoDaddy: giu domain, vi du `easyloanfinance.com.au`.
2. Render free: host app booking online.
3. Supabase free: luu broker va booking.
4. Email hien co: gui email bao cho anh khi co khach book.

Google Calendar luc dau dung ICS link mien phi. Chua can bat Google API.

## Buoc 1 - Tao Supabase free de luu booking

1. Vao `https://supabase.com`.
2. Bam `Start your project`.
3. Dang nhap bang Google hoac email.
4. Bam `New project`.
5. Dien:
   - Organization: chon organization mac dinh.
   - Project name: `easy-loan-booking`
   - Database password: tao password manh va luu lai.
   - Region: chon gan Australia nhat neu co.
6. Bam `Create new project`.
7. Doi Supabase tao xong project.
8. Trong menu ben trai, bam `SQL Editor`.
9. Bam `New query`.
10. Mo file `supabase-schema.sql` trong project nay.
11. Copy toan bo noi dung file do.
12. Paste vao SQL Editor.
13. Bam `Run`.

Sau buoc nay Supabase da co bang `brokers` va `bookings`.

## Buoc 2 - Lay Supabase URL va key

1. Trong Supabase, bam icon `Project Settings`.
2. Bam `API`.
3. Copy `Project URL`.
4. Copy `secret` key neu thay key dang `sb_secret_...`.
5. Neu thay tab `Legacy API Keys`, co the copy `service_role` key cung duoc.

Can dung 2 gia tri nay khi setup Render:

```text
SUPABASE_URL=Project URL
SUPABASE_SERVICE_ROLE_KEY=service_role key
```

Neu Supabase cua anh hien key moi dang `sb_secret_...`, dung:

```text
SUPABASE_URL=Project URL
SUPABASE_SECRET_KEY=sb_secret_...
```

Quan trong: `service_role` key khong gui cho ai, khong paste len frontend, chi de trong Render environment variables.

## Buoc 3 - Dua code len GitHub

Neu can huong dan chi tiet tung nut bam va tung lenh, doc file:

```text
HUONG_DAN_GITHUB_RENDER.md
```

Neu project chua co GitHub repo:

1. Vao `https://github.com`.
2. Bam `New repository`.
3. Dat ten repo: `easy-loan-finance-booking`.
4. De private hoac public deu duoc.
5. Tao repo.
6. Lam theo huong dan GitHub de push code tu may len.

Neu anh muon minh lam phan push GitHub, bao minh, minh se lam tiep trong folder nay.

## Buoc 4 - Deploy app free tren Render

1. Vao `https://render.com`.
2. Dang nhap hoac tao account.
3. Bam `New`.
4. Chon `Web Service`.
5. Chon GitHub repo `easy-loan-finance-booking`.
6. O phan setup service, dien:

```text
Name: easy-loan-finance-booking
Region: chon gan Australia neu co
Branch: main hoac master
Root Directory: de trong
Runtime: Node
Build Command: npm install && npm run build
Start Command: npm start
```

7. Chon plan free.
8. Tim phan `Environment Variables`.
9. Them:

```text
PORT=3000
BOOKING_TIME_ZONE=Australia/Adelaide
ADMIN_EMAIL=ryan@easyloanfinance.com.au
ADMIN_PASSWORD=dat-mat-khau-manh-o-day
ADMIN_SESSION_SECRET=dat-chuoi-bi-mat-dai-khac-password
SUPABASE_URL=link Supabase Project URL
SUPABASE_SERVICE_ROLE_KEY=Supabase service_role key
```

Neu khong thay `service_role`, them bien nay thay vao do:

```text
SUPABASE_SECRET_KEY=sb_secret_...
```

10. Tam thoi de Google API trong, dung free ICS truoc:

```text
GOOGLE_CALENDAR_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SERVICE_ACCOUNT_JSON=
```

11. Bam `Create Web Service`.
12. Doi Render build xong.
13. Mo link Render dang tao, vi du:

```text
https://easy-loan-finance-booking.onrender.com
```

Neu thay dashboard Easy Loan Finance la dung.

Quan trong: neu da dat `ADMIN_PASSWORD`, dashboard quan ly se yeu cau login. Link `/book` cho khach van mo public.

## Buoc 5 - Tao link booking de gui khach

Sau khi Render co link online, link gui khach se la:

```text
https://TEN-APP-RENDER.onrender.com/book
```

Link rieng cho Ryan:

```text
https://TEN-APP-RENDER.onrender.com/book/ryan-vu
```

Vi du:

```text
https://easy-loan-finance-booking.onrender.com/book/ryan-vu
```

Khach vao link nay, dien form, booking se vao dashboard.

## Buoc 6 - Gan domain GoDaddy cho dep

Vi du anh muon link la:

```text
https://booking.easyloanfinance.com.au/book/ryan-vu
```

Lam nhu sau:

1. Vao Render.
2. Mo service `easy-loan-finance-booking`.
3. Vao `Settings`.
4. Tim `Custom Domains`.
5. Bam `Add Custom Domain`.
6. Nhap:

```text
booking.easyloanfinance.com.au
```

7. Render se hien ra record can them, thuong la CNAME.
8. Vao GoDaddy.
9. Vao `My Products`.
10. Chon domain `easyloanfinance.com.au`.
11. Vao `DNS`.
12. Bam `Add New Record`.
13. Chon type `CNAME`.
14. Dien:

```text
Name: booking
Value: gia tri Render dua cho anh
TTL: Default
```

15. Save.
16. Quay lai Render, doi domain verify.

DNS co the mat vai phut den vai gio. Khi xong, link khach se la:

```text
https://booking.easyloanfinance.com.au/book/ryan-vu
```

## Buoc 7 - Bat email bao ve cho anh

Neu anh co email Microsoft 365, them vao Render Environment Variables:

```text
BOOKING_NOTIFY_EMAIL=ryan@easyloanfinance.com.au
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=ryan@easyloanfinance.com.au
SMTP_PASS=mat-khau-email-hoac-app-password
SMTP_FROM=Easy Loan Finance <ryan@easyloanfinance.com.au>
```

Neu dung Gmail:

```text
BOOKING_NOTIFY_EMAIL=ryan@easyloanfinance.com.au
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=yourgmail@gmail.com
SMTP_PASS=gmail-app-password
SMTP_FROM=Easy Loan Finance <yourgmail@gmail.com>
```

Sau khi them env var:

1. Trong Render, bam `Manual Deploy`.
2. Chon `Deploy latest commit`.
3. Doi app restart.
4. Test dat booking bang link `/book/ryan-vu`.
5. Kiem tra email co bao ve khong.

## Buoc 8 - Xem booking tren Google Calendar dien thoai mien phi

Chua bat Google API. Dung ICS feed truoc.

Link team:

```text
https://booking.easyloanfinance.com.au/calendar/team.ics
```

Link Ryan:

```text
https://booking.easyloanfinance.com.au/calendar/broker/ryan-vu.ics
```

Cach add vao Google Calendar:

1. Mo Google Calendar tren may tinh, khong phai dien thoai.
2. Ben trai, tim `Other calendars`.
3. Bam dau `+`.
4. Chon `From URL`.
5. Paste ICS link, vi du:

```text
https://booking.easyloanfinance.com.au/calendar/broker/ryan-vu.ics
```

6. Bam `Add calendar`.
7. Mo Google Calendar tren dien thoai.
8. Vao Settings.
9. Tim calendar vua add.
10. Bat `Sync`.

Luu y: ICS mien phi co the khong cap nhat ngay lap tuc. Google tu refresh. Neu sau nay can booking hien ngay trong Google Calendar, luc do moi bat Google Calendar API direct sync.

## Buoc 9 - Cach dung hang ngay

1. Gui khach link:

```text
https://booking.easyloanfinance.com.au/book/ryan-vu
```

2. Khach dat lich.
3. Anh nhan email bao ve.
4. Anh vao dashboard de confirm, doi status, hoac chuyen booking cho broker khac.
5. Google Calendar tren dien thoai se hien booking qua ICS feed.

## Buoc 10 - Khi nao moi can tra tien

Chua can tra tien neu:

- Moi co vai broker.
- Moi co vai chuc booking moi thang.
- Chap nhan Google Calendar sync cham mot chut.
- Chap nhan Render free lan dau mo co the hoi cham.

Nen tra tien khi:

- Khach than link booking mo cham.
- Can Google Calendar cap nhat ngay lap tuc.
- Email bao bi spam hoac qua gioi han.
- Co nhieu broker can phan quyen rieng.
- Can SMS reminder, payment, automation nang cao.

Thu tu nang cap nen la:

1. Hosting Render paid.
2. Email provider chuyen nghiep.
3. Google Calendar API direct sync.
4. SMS/payment API.

## Ban free nen de nhu nay

Trong Render environment:

```text
SUPABASE_URL=co dien
SUPABASE_SERVICE_ROLE_KEY=co dien
BOOKING_NOTIFY_EMAIL=co dien
SMTP_HOST=co dien
SMTP_USER=co dien
SMTP_PASS=co dien
GOOGLE_CALENDAR_ID=de trong
GOOGLE_SERVICE_ACCOUNT_EMAIL=de trong
GOOGLE_PRIVATE_KEY=de trong
GOOGLE_SERVICE_ACCOUNT_JSON=de trong
```

Ket luan: chi can Supabase free + Render free + GoDaddy domain + email SMTP la chay duoc ban free dep va chuyen nghiep.
