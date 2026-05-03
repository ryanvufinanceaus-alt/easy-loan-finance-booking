@echo off
cd /d "%~dp0"
cd desktop-widget
if not exist node_modules\electron (
  npm install
)
npm start
