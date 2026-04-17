@echo off
:start
cls
node index.js
timeout /t 5 /nobreak >nul
goto start