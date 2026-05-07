@echo off
cd /d "%~dp0"

set "LOG=%~dp0widget-launch.log"
set "NPM=C:\Program Files\nodejs\npm.cmd"
if not exist "%NPM%" set "NPM=npm.cmd"

echo [%date% %time%] Starting ELF Booking Widget > "%LOG%"
echo Using npm: %NPM% >> "%LOG%"

if not exist node_modules\electron (
  echo Installing Electron... >> "%LOG%"
  call "%NPM%" install >> "%LOG%" 2>&1
)

echo Launching widget... >> "%LOG%"
call "%NPM%" start >> "%LOG%" 2>&1
