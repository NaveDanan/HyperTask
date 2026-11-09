@echo off
setlocal
cd /d "%~dp0.."
set "taskFlutter=D:\Tools\flutter\bin\flutter.bat"
if not exist "%taskFlutter%" (
  echo Flutter was not found at D:\Tools\flutter\bin\flutter.bat.
  exit /b 1
)
if not exist "build\windows\x64\runner\Debug\AppFlowy.exe" (
  call "%taskFlutter%" build windows --debug --no-pub
  if errorlevel 1 exit /b 1
)
call "%taskFlutter%" run -d windows --no-pub --use-application-binary="%cd%\build\windows\x64\runner\Debug\AppFlowy.exe"
