@echo off
echo 💕 Running tests with 30s hard timeout...

:: Start the killer in background FIRST
start "" /b cmd /c "timeout /t 30 /nobreak >nul & taskkill /f /t /im node.exe >nul 2>&1 & taskkill /f /t /im tsx.exe >nul 2>&1"

:: Run tests synchronously with output to file
tsx --test tests/server.test.ts > test-output.txt 2>&1

echo ✨ Tests finished or killed! Check test-output.txt~ 💖