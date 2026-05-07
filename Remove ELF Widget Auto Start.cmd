@echo off
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ELF Booking Widget.lnk"
set "TASKNAME=ELF Booking Widget"
if exist "%SHORTCUT%" del "%SHORTCUT%"
schtasks /delete /tn "%TASKNAME%" /f >nul 2>&1
echo ELF Booking Widget auto-start has been removed.
echo You can close this window.
pause
