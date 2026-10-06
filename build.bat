@echo off
chcp 65001 >nul
title Win11 PDF Print Helper - 자동 빌드 매니저 (버전 자동 후부착)

setlocal enabledelayedexpansion

:: 색상 정의 (Windows Command Prompt)
set "ESC= "
set "GREEN=%ESC%[92m"
set "CYAN=%ESC%[96m"
set "YELLOW=%ESC%[93m"
set "RED=%ESC%[91m"
set "RESET=%ESC%[0m"

echo %CYAN%===========================================================%RESET%
echo %CYAN%      Win11 PDF Print Helper - 자동 빌드 매니저      %RESET%
echo %CYAN%===========================================================%RESET%
echo.

:: package.json에서 버전 번호 추출
set "APP_VERSION=1.4.0"
for /f "tokens=2 delims=:," %%A in ('findstr /c:"\"version\"" package.json') do (
    set "RAW_VER=%%~A"
    set "RAW_VER=!RAW_VER: =!"
    set "RAW_VER=!RAW_VER:"=!"
    if not "!RAW_VER!"=="" set "APP_VERSION=!RAW_VER!"
)

echo %GREEN%[패치 정보] 현재 패치노트 적용 버전: v%APP_VERSION%%RESET%
echo.

:: Node.js 설치 확인
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo %RED%[오류] Node.js가 설치되어 있지 않거나 PATH에 등록되지 않았습니다.%RESET%
    echo Node.js(v18 이상)를 설치한 후 다시 실행해 주세요.
    pause
    exit /b 1
)

:: node_modules 확인
if not exist "node_modules\" (
    echo %YELLOW%[안내] node_modules 폴더가 없습니다. 의존성 패키지를 설치합니다...%RESET%
    call npm install
    if %errorlevel% neq 0 (
        echo %RED%[오류] npm install 실패! 네트워크 상태를 확인하세요.%RESET%
        pause
        exit /b 1
    )
)

:: 포트 설정 처리 (%2로 인자가 들어오거나 프롬프트 입력을 받음)
set "TARGET_PORT=%~2"
if "%TARGET_PORT%"=="" set "TARGET_PORT=3000"

:: CLI 매개변수(%1)가 있을 경우 바로 지정된 빌드로 이동
if /i "%~1"=="web" (
    set "PORT=%TARGET_PORT%"
    goto BUILD_WEB
)
if /i "%~1"=="app" (
    set "PORT=%TARGET_PORT%"
    goto BUILD_ELECTRON
)
if /i "%~1"=="electron" (
    set "PORT=%TARGET_PORT%"
    goto BUILD_ELECTRON
)
if /i "%~1"=="all" (
    set "PORT=%TARGET_PORT%"
    goto BUILD_ALL
)

:GET_PORT
echo %YELLOW%[포트 설정]%RESET%
echo 기본 포트 번호는 3000입니다. 다른 포트를 사용할 경우 번호를 입력하세요.
set "INPUT_PORT="
set /p "INPUT_PORT=사용할 포트 번호 입력 (기본값: 3000): "
if not "%INPUT_PORT%"=="" (
    set "TARGET_PORT=%INPUT_PORT%"
) else (
    set "TARGET_PORT=3000"
)
set "PORT=%TARGET_PORT%"
echo %GREEN%=> 적용된 빌드 포트: %PORT%%RESET%
echo.

:MENU
echo %CYAN%원하시는 빌드 작업을 선택하세요:%RESET%
echo.
echo   [1] 전체 자동 빌드 (Type Check + Web + Electron v%APP_VERSION% 설치 파일) [포트: %PORT%]
echo   [2] Web PWA 전용 빌드 (dist/ 폴더 생성) [포트: %PORT%]
echo   [3] Electron 데스크톱 앱 v%APP_VERSION% 설치 파일 생성 (release/ 폴더) [포트: %PORT%]
echo   [4] 포트 번호 변경하기
echo   [5] 의존성 패키지 전체 재설치 (npm clean-install)
echo   [0] 종료
echo.
set /p CHOICE="선택 (0-5): "

if "%CHOICE%"=="1" goto BUILD_ALL
if "%CHOICE%"=="2" goto BUILD_WEB
if "%CHOICE%"=="3" goto BUILD_ELECTRON
if "%CHOICE%"=="4" goto GET_PORT
if "%CHOICE%"=="5" goto INSTALL_DEPS
if "%CHOICE%"=="0" goto END

echo %RED%잘못된 입력입니다. 다시 선택해주세요.%RESET%
echo.
goto MENU

:BUILD_ALL
echo.
echo %CYAN%[포트 %PORT%] 설정으로 빌드를 진행합니다.%RESET%
echo %CYAN%[1/3] TypeScript 타입 및 코드 검사 (npm run lint)...%RESET%
call npm run lint
if %errorlevel% neq 0 (
    echo %RED%[경고] 타입 검사 중 경고/오류가 발견되었습니다. 빌드를 계속 진행합니다.%RESET%
) else (
    echo %GREEN%[성공] 타입 검사 완료!%RESET%
)

echo.
echo %CYAN%[2/3] Web 번들링 및 PWA 빌드 (PORT=%PORT%)...%RESET%
call npm run build
if %errorlevel% neq 0 (
    echo %RED%[오류] Web 빌드 실패!%RESET%
    goto FAIL
)
echo %GREEN%[성공] Web 빌드 완료 (dist/)%RESET%

echo.
echo %CYAN%[3/3] Electron 패키징 및 NSIS 설치 파일 생성 (버전: v%APP_VERSION%)...%RESET%
call npm run electron:build
if %errorlevel% neq 0 (
    echo %RED%[오류] Electron 패키징 실패!%RESET%
    goto FAIL
)

call :RENAME_EXE_VERSION

echo.
echo %GREEN%===========================================================%RESET%
echo %GREEN%   🎉 모든 빌드가 성공적으로 완료되었습니다!               %RESET%
echo %GREEN%   - 사용 지정 포트 : %PORT%                              %RESET%
echo %GREEN%   - 버전 정보      : v%APP_VERSION%                            %RESET%
echo %GREEN%   - Web 결과물     : ./dist/                             %RESET%
echo %GREEN%   - Electron 설치  : ./release/ (버전명 자동 포함)         %RESET%
echo %GREEN%===========================================================%RESET%
goto SUCCESS

:BUILD_WEB
echo.
echo %CYAN%[포트 %PORT%] 설정으로 Web PWA 전용 빌드를 시작합니다...%RESET%
call npm run build
if %errorlevel% neq 0 (
    echo %RED%[오류] Web 빌드 실패!%RESET%
    goto FAIL
)
echo.
echo %GREEN%===========================================================%RESET%
echo %GREEN%   🎉 Web PWA 빌드 성공! (지정 포트: %PORT%, 경로: ./dist/)  %RESET%
echo %GREEN%===========================================================%RESET%
goto SUCCESS

:BUILD_ELECTRON
echo.
echo %CYAN%[포트 %PORT%] 설정으로 Electron 설치 파일(v%APP_VERSION%) 빌드를 시작합니다...%RESET%
call npm run electron:build
if %errorlevel% neq 0 (
    echo %RED%[오류] Electron 패키징 실패!%RESET%
    goto FAIL
)

call :RENAME_EXE_VERSION

echo.
echo %GREEN%===========================================================%RESET%
echo %GREEN%   🎉 Electron 앱 빌드 성공! (버전: v%APP_VERSION%, 경로: ./release/) %RESET%
echo %GREEN%===========================================================%RESET%
goto SUCCESS

:RENAME_EXE_VERSION
if exist "release\" (
    for %%F in (release\*.exe) do (
        set "FILENAME=%%~nxF"
        echo !FILENAME! | findstr /i "v%APP_VERSION%" >nul
        if errorlevel 1 (
            if not "%%~nxF"=="builder-effective-config.yaml" (
                echo %YELLOW%[결과물 이름 변경] %%~nxF -> %%~nF-v%APP_VERSION%%%~xF%RESET%
                ren "%%F" "%%~nF-v%APP_VERSION%%%~xF" 2>nul
            )
        )
    )
)
exit /b 0

:INSTALL_DEPS
echo.
echo %CYAN%node_modules 및 패키지 재설치를 진행합니다...%RESET%
if exist "node_modules\" rmdir /s /q "node_modules"
call npm install
if %errorlevel% neq 0 (
    echo %RED%[오류] 패키지 설치 실패!%RESET%
    goto FAIL
)
echo %GREEN%[성공] 패키지 재설치 완료!%RESET%
echo.
goto MENU

:SUCCESS
echo.
echo 아무 키나 누르면 종료합니다...
pause >nul
exit /b 0

:FAIL
echo.
echo %RED%===========================================================%RESET%
echo %RED%   ❌ 빌드 도중 오류가 발생하였습니다. 로그를 확인하세요. %RESET%
echo %RED%===========================================================%RESET%
echo.
pause
exit /b 1

:END
exit /b 0
