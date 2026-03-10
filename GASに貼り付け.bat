@echo off
chcp 65001 >nul
echo GAS貼り付け用_index.html をクリップボードにコピーしています...
powershell -Command "Get-Content -Path 'GAS貼り付け用_index.html' -Raw -Encoding UTF8 | Set-Clipboard"
echo.
echo 完了！ script.google.com で Index.html を開き、Ctrl+V で貼り付けてください。
echo.
pause
