@echo off
setlocal
set "ROOT=%~dp0"
set "TARGET=%ROOT%Start ELF Booking Widget Hidden.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\ELF Booking Widget.lnk"
set "TASKNAME=ELF Booking Widget"

schtasks /delete /tn "%TASKNAME%" /f >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%SHORTCUT%'); $shortcut.TargetPath = '%TARGET%'; $shortcut.Arguments = '/delay'; $shortcut.WorkingDirectory = '%ROOT%'; $shortcut.IconLocation = '%ROOT%public\elf-logo.png'; $shortcut.Save()"

echo ELF Booking Widget will now open automatically 30 seconds after Windows login.
echo It will run hidden, without a command window.
echo You can close this window.
pause
