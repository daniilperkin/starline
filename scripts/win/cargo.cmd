@echo off
rem Runs cargo inside the VS 2022 x64 developer environment so that link.exe
rem and the Windows SDK libraries are on PATH/LIB. Locates VS via vswhere.
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%i"
if not defined VSPATH (echo vswhere: no Visual Studio C++ toolchain found 1>&2 & exit /b 1)
call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
if errorlevel 1 (echo vcvars64.bat failed 1>&2 & exit /b 1)
cargo %*
exit /b %errorlevel%
