@echo off
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ELF Booking Widget.lnk"
if exist "%SHORTCUT%" del "%SHORTCUT%"
echo ELF Booking Widget auto-start has been removed.
echo You can close this window.
pause
