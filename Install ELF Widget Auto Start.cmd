@echo off
setlocal
set "ROOT=%~dp0"
set "TARGET=%ROOT%Start ELF Booking Widget Hidden.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP%\ELF Booking Widget.lnk"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%SHORTCUT%'); $shortcut.TargetPath = '%TARGET%'; $shortcut.WorkingDirectory = '%ROOT%'; $shortcut.IconLocation = '%ROOT%public\elf-logo.png'; $shortcut.Save()"

echo ELF Booking Widget will now open automatically when Windows starts.
echo You can close this window.
pause
