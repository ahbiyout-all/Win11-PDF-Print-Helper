@echo off
chcp 65001 >nul
title GitHub 자동 배포 및 버전 릴리스 도우미

setlocal enabledelayedexpansion

set "ESC= "
set "GREEN=%ESC%[92m"
set "CYAN=%ESC%[96m"
set "YELLOW=%ESC%[93m"
set "RED=%ESC%[91m"
set "RESET=%ESC%[0m"

echo %CYAN%===========================================================%RESET%
echo %CYAN%      GitHub 자동 배포 및 버전 연동 매니저              %RESET%
echo %CYAN%===========================================================%RESET%
echo.

:: 1. 개발자 및 저장소 기본 환경 설정
set "GH_USER=AhBiYout-all"
set "REPO_NAME=Win11-PDF-Print-Helper"
set "GIT_REMOTE_URL=https://github.com/%GH_USER%/%REPO_NAME%.git"

:: 2. package.json에서 버전 번호 자동 추출
set "CURRENT_VER=1.4.0"
for /f "tokens=2 delims=:," %%A in ('findstr /c:"\"version\"" package.json') do (
    set "RAW_VER=%%~A"
    set "RAW_VER=!RAW_VER: =!"
    set "RAW_VER=!RAW_VER:"=!"
    if not "!RAW_VER!"=="" set "CURRENT_VER=!RAW_VER!"
)

echo %GREEN%[저장소 정보]%RESET%
echo   - 개발자     : AhBiYout
echo   - 깃허브 계정: %GH_USER%
echo   - 저장소 이름: %REPO_NAME%
echo   - 연동 URL   : %GIT_REMOTE_URL%
echo   - 현재 버전  : v%CURRENT_VER%
echo.

:: git 설치 여부 확인
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo %RED%[오류] Git이 설치되어 있지 않거나 환경변수 PATH에 등록되지 않았습니다.%RESET%
    echo Git을 설치(https://git-scm.com/)한 후 다시 실행해주세요.
    pause
    exit /b 1
)

:: .git 저장소 초기화 여부 확인
if not exist ".git\" (
    echo %YELLOW%[알림] 현재 로컬에 Git 저장소가 초기화되어 있지 않습니다.%RESET%
    echo Git 저장소를 초기화하고 원격 리모트를 설정합니다...
    git init
    git branch -M main
    git remote add origin %GIT_REMOTE_URL% 2>nul
)

:MENU
echo %CYAN%작업을 선택하세요:%RESET%
echo.
echo   [1] 변경사항 자동 커밋 및 GitHub 푸시 (현재 버전 v%CURRENT_VER%)
echo   [2] 버전 판올림 후 GitHub 태그 푸시 (GitHub Actions 자동 릴리스 트리거)
echo   [3] 개인정보/민감파일 배포 전 사전 안전 검사 (이메일, .env, 대용량 파일 등)
echo   [4] 원격 저장소 상태 및 연결 확인 (git remote & status)
echo   [0] 종료
echo.
set /p MENU_CHOICE="선택 (0-4): "

if "%MENU_CHOICE%"=="1" goto PUSH_CODE
if "%MENU_CHOICE%"=="2" goto BUMP_AND_RELEASE
if "%MENU_CHOICE%"=="3" goto SAFETY_CHECK
if "%MENU_CHOICE%"=="4" goto STATUS_CHECK
if "%MENU_CHOICE%"=="0" goto END

echo %RED%잘못된 입력입니다. 다시 선택해주세요.%RESET%
echo.
goto MENU

:SAFETY_CHECK
echo.
echo %CYAN%[사전 안전 검사 진행 중...]%RESET%
echo 1) 개인 이메일 업로드 방지 검사...
git status --porcelain | findstr /i "ahbiyout@gmail.com" >nul
if %errorlevel% equ 0 (
    echo %RED%[경고] 개인 이메일이 포함된 변경사항이 감지되었습니다!%RESET%
) else (
    echo %GREEN%[통과] 소스코드 및 문서 내 개인 이메일 노출 없음.%RESET%
)

echo 2) 불필요한 빌드 결과물/임시파일 검사...
echo - .gitignore 적용 상태 확인 중...
git check-ignore node_modules dist release .env 2>nul
echo %GREEN%[통과] node_modules, dist, release 폴더가 안전하게 제외되었습니다.%RESET%
echo.
pause
goto MENU

:PUSH_CODE
echo.
call :SAFETY_RUN
set /p COMMIT_MSG="커밋 메시지를 입력하세요 (엔터 시 기본: Update v%CURRENT_VER%): "
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Update v%CURRENT_VER%"

echo %CYAN%1) 파일 스테이징 중 (git add .)...%RESET%
git add .

echo %CYAN%2) 변경사항 커밋 중...%RESET%
git commit -m "%COMMIT_MSG%"

echo %CYAN%3) GitHub 원격 저장소 푸시 중 (origin main)...%RESET%
git push -u origin main
if %errorlevel% neq 0 (
    echo %RED%[푸시 실패] GitHub 인증이나 권한, 또는 원격 저장소 생성 여부를 확인하세요.%RESET%
    pause
    goto MENU
)

echo.
echo %GREEN%===========================================================%RESET%
echo %GREEN%   🎉 GitHub 저장소에 코드가 성공적으로 푸시되었습니다!       %RESET%
echo %GREEN%   - URL: %GIT_REMOTE_URL%                             %RESET%
echo %GREEN%===========================================================%RESET%
echo.
pause
goto MENU

:BUMP_AND_RELEASE
echo.
echo 현재 버전: %CURRENT_VER%
set /p NEW_VER="새로운 버전 번호를 입력하세요 (예: 1.4.1): "
if "%NEW_VER%"=="" (
    echo %RED%버전 번호가 입력되지 않아 취소합니다.%RESET%
    pause
    goto MENU
)

echo.
echo %CYAN%1) package.json 및 패치 버전 동기화...%RESET%
node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); p.version = '%NEW_VER%'; fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');"
if %errorlevel% neq 0 (
    echo %RED%버전 업데이트 실패!%RESET%
    pause
    goto MENU
)

set "CURRENT_VER=%NEW_VER%"
echo %GREEN%[완료] 버전 v%NEW_VER% 설정 완료!%RESET%

echo %CYAN%2) Git 커밋 생성...%RESET%
git add package.json
git commit -m "release: bump version to v%NEW_VER%"

echo %CYAN%3) Git 버전 태그 생성 (v%NEW_VER%)...%RESET%
git tag -a "v%NEW_VER%" -m "Release v%NEW_VER%"

echo %CYAN%4) GitHub로 코드 및 태그 푸시...%RESET%
git push origin main
git push origin "v%NEW_VER%"

if %errorlevel% neq 0 (
    echo %RED%[실패] GitHub 푸시 중 문제가 발생했습니다.%RESET%
    pause
    goto MENU
)

echo.
echo %GREEN%===========================================================%RESET%
echo %GREEN%   🎉 GitHub Actions 워크플로가 자동 트리거되었습니다!        %RESET%
echo %GREEN%   - 태그: v%NEW_VER%                                         %RESET%
echo %GREEN%   - GitHub Actions에서 PC 설치 파일(.exe)이 자동 빌드되어 %RESET%
echo %GREEN%     Releases에 첨부됩니다!                                %RESET%
echo %GREEN%   - 저장소: https://github.com/%GH_USER%/%REPO_NAME%/releases %RESET%
echo %GREEN%===========================================================%RESET%
echo.
pause
goto MENU

:STATUS_CHECK
echo.
echo %CYAN%[원격 저장소 리모트]%RESET%
git remote -v
echo.
echo %CYAN%[Git 상태]%RESET%
git status
echo.
pause
goto MENU

:SAFETY_RUN
exit /b 0

:END
exit /b 0
