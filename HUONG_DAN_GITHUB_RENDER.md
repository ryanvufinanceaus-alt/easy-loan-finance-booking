# Huong Dan GitHub + Render Tung Buoc

Muc tieu: dua code app booking tu may len GitHub, sau do Render moi deploy duoc.

## Phan A - Tao repo tren GitHub

1. Vao `https://github.com`.
2. Dang nhap account GitHub cua anh.
3. Bam nut `+` goc tren ben phai.
4. Chon `New repository`.
5. O `Repository name`, dien:

```text
easy-loan-finance-booking
```

6. Chon `Private` neu khong muon ai thay code.
7. Khong tick `Add a README file`.
8. Khong tick `.gitignore`.
9. Khong chon license.
10. Bam `Create repository`.

Sau khi tao xong, GitHub se hien trang co cac lenh push. Giu trang do mo.

## Phan B - Push code tu may len GitHub

Mo PowerShell trong folder app:

```powershell
cd "C:\Users\User\OneDrive\Documents\New project 2"
```

Kiem tra file:

```powershell
git status
```

Neu Git chua co ten/email, chay:

```powershell
git config user.name "Ryan Vu"
git config user.email "ryan@easyloanfinance.com.au"
```

Add file vao commit:

```powershell
git add .
```

Commit:

```powershell
git commit -m "Build Easy Loan Finance booking app"
```

Dat branch thanh `main`:

```powershell
git branch -M main
```

Them GitHub remote. Thay `YOUR_GITHUB_USERNAME` bang username GitHub cua anh:

```powershell
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/easy-loan-finance-booking.git
```

Push len GitHub:

```powershell
git push -u origin main
```

Neu GitHub hoi login:

- Username: username GitHub.
- Password: khong dung password binh thuong.
- Dung GitHub Personal Access Token neu no yeu cau.

## Phan C - Neu bi loi remote da ton tai

Neu chay `git remote add origin...` bi loi:

```text
remote origin already exists
```

Thi chay:

```powershell
git remote -v
```

Neu remote sai, doi lai:

```powershell
git remote set-url origin https://github.com/YOUR_GITHUB_USERNAME/easy-loan-finance-booking.git
```

Sau do push:

```powershell
git push -u origin main
```

## Phan D - Connect Render voi GitHub

1. Vao `https://render.com`.
2. Dang nhap.
3. Bam `New`.
4. Chon `Web Service`.
5. Chon `Build and deploy from a Git repository`.
6. Neu Render chua ket noi GitHub, bam `Connect GitHub`.
7. Cho phep Render truy cap repo.
8. Chon repo:

```text
easy-loan-finance-booking
```

9. Dien setup:

```text
Name: easy-loan-finance-booking
Runtime: Node
Branch: main
Root Directory: de trong
Build Command: npm install && npm run build
Start Command: npm start
```

10. Chon Free plan.
11. Them Environment Variables.

## Phan E - Render Environment Variables can co

Bat buoc:

```text
PORT=3000
BOOKING_TIME_ZONE=Australia/Adelaide
ADMIN_EMAIL=ryan@easyloanfinance.com.au
ADMIN_PASSWORD=mat-khau-dashboard-cua-anh
ADMIN_SESSION_SECRET=chuoi-bi-mat-dai-khac-password
SUPABASE_URL=https://fmjjtajccryyabnvvzev.supabase.co
SUPABASE_SECRET_KEY=sb_secret_cua_anh
```

Neu da co email SMTP:

```text
BOOKING_NOTIFY_EMAIL=ryan@easyloanfinance.com.au
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=ryan@easyloanfinance.com.au
SMTP_PASS=mat-khau-hoac-app-password
SMTP_FROM=Easy Loan Finance <ryan@easyloanfinance.com.au>
```

Google API de trong luc dau:

```text
GOOGLE_CALENDAR_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_SERVICE_ACCOUNT_JSON=
```

## Phan F - Deploy

1. Sau khi dien xong env vars, bam `Create Web Service`.
2. Doi Render build.
3. Neu build thanh cong, Render se cho link dang:

```text
https://easy-loan-finance-booking.onrender.com
```

4. Mo link do.
5. Neu co login page, dang nhap bang `ADMIN_PASSWORD`.
6. Test tao broker va booking.
7. Test link public:

```text
https://easy-loan-finance-booking.onrender.com/book/ryan-vu
```

## Phan G - Moi lan sua code sau nay

Sau khi minh sua app trong may, day len GitHub bang:

```powershell
git add .
git commit -m "Update booking app"
git push
```

Render se tu deploy neu auto deploy dang bat. Neu khong, vao Render bam:

```text
Manual Deploy > Deploy latest commit
```

## Phan H - Loi hay gap

### Loi: src refspec main does not match any

Thuong la chua commit duoc. Chay:

```powershell
git status
git add .
git commit -m "Build Easy Loan Finance booking app"
git branch -M main
git push -u origin main
```

### Loi: Please tell me who you are

Chua set Git user:

```powershell
git config user.name "Ryan Vu"
git config user.email "ryan@easyloanfinance.com.au"
```

Sau do commit lai.

### Loi: Authentication failed

GitHub khong nhan password binh thuong nua. Can dung Personal Access Token hoac dang nhap GitHub Desktop.

### Render deploy xong nhung booking mat sau refresh

Chua ket noi Supabase dung. Kiem tra Render env vars:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

Sau khi sua env vars, bam:

```text
Manual Deploy > Deploy latest commit
```
