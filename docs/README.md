# 📄 Win11 PDF Print Helper 문서 센터 (Docs)

대용량(5,000페이지 이상) PDF 문서를 메모리 과부하 없이 안정적으로 분할하고 출력할 수 있는 **Win11 스타일 대용량 PDF 분할 인쇄 도우미**의 공식 문서 집합입니다.

---

## 📚 문서 목차

1. [사용자 가이드 (User Guide)](./USER_GUIDE.md)
   - PDF 파일 업로드 및 분할 옵션 설정
   - 간지(Slip Sheet) 출력 및 커스텀 텍스트/디자인 적용
   - 대량 분할 출력 진행 제어 (일시 중지, 재개, 취소)
   - 실시간 프린터 상태 모니터링 및 복구 알림 설정
   - 자동 빌드 스크립트(`build.bat`) 사용법

2. [프린터 진단 및 트러블슈팅 가이드 (Printer Diagnosis Guide)](./PRINTER_DIAGNOSIS_GUIDE.md)
   - 윈도우 인쇄 스풀러 상태 코드(Status Code) 및 상태 텍스트
   - 호버 상세 진단 툴팁 기능 안내
   - 오프라인/용지 걸림/토너 부족 시 해결 절차

3. [기술 아키텍처 명세서 (Technical Architecture)](./TECHNICAL_ARCHITECTURE.md)
   - Electron Main - Renderer IPC 통신 구조
   - `pdf-lib` 기반 PDF 메모리 효율 분할 엔진
   - Pre-flight Printer Status Check 알고리즘
   - PWA & Service Worker 캐싱 및 빌드 최적화

4. [패치 노트 & 릴리즈 기록 (Patch Notes)](./PATCH_NOTES.md)
   - 최신 업데이트 및 버그 수정 내역
   - 최근 추가 기능 (자동 빌드 스크립트, 실시간 상태 동기화 시각, 복구 강조 알림 등)

---

## 🚀 빠른 시작 (Quick Start)

### ⚙️ Windows 원클릭 자동 빌드 (`build.bat`)
윈도우 환경에서는 루트 경로의 `build.bat` 파일을 더블 클릭하거나 명령 프롬프트에서 실행할 수 있습니다.
```cmd
build.bat            :: 대화형 포트 지정 및 인터랙티브 메뉴 실행 (기본 3000포트)
build.bat all 8080   :: 사용자 정의 8080 포트로 타입 검사 + Web 빌드 + Electron 패키징 일괄 진행
build.bat web 8080   :: 8080 포트 기준 Web PWA 빌드 전용 (dist/ 생성)
build.bat app 8080   :: 8080 포트 기준 Electron 데스크톱 앱 빌드 전용 (release/ 생성)
```

### 웹 모드 (Web Development)
```bash
npm install
npm run dev
```
브라우저에서 `http://localhost:3000`에 접속하여 사용할 수 있습니다.

### Electron 데스크톱 앱 모드 (Desktop App Mode)
```bash
npm run electron:dev
```
Electron 실행 환경에서 시스템 프린터에 직접 연결하여 네이티브 무인쇄 출력을 이용할 수 있습니다.

---

## 🔗 [제작자 및 공식 채널 안내]
- **개발자**: AhBiYout
- **GitHub 저장소**: [https://github.com/AhBiYout-all/Win11-PDF-Print-Helper](https://github.com/AhBiYout-all/Win11-PDF-Print-Helper)
- **공식 구글 블로그**: [https://ahbiyoutvibe.blogspot.com/](https://ahbiyoutvibe.blogspot.com/)
- **소속**: [https://www.cisnet.co.kr](https://www.cisnet.co.kr)

---

## 🚀 GitHub Releases 자동 업데이트 & CI/CD 워크플로
- **자동 업데이트 팝업**: GitHub Releases API를 통하여 새 버전 출시를 감지하고 팝업창을 통해 즉시 업데이트 및 인스톨러 다운로드를 안내합니다.
- **Node.js 22 LTS 기반 GitHub Actions**: 2026 Node.js 20 EOL 대응에 따라 최신 안정 런타임으로 크로스 플랫폼 인스톨러를 자동 빌드하고 릴리스 자산에 첨부합니다.
- **원클릭 배포 스크립트**: `github-deploy.bat`을 통하여 코드 커밋, 태그 푸시, 자동 릴리스 트리거를 수행할 수 있습니다.

---

## 🛠️ 주요 기능 요약
- **대용량 PDF 분할**: 5,000페이지 이상의 거대한 PDF 문서를 일정한 페이지 묶음(기본 50페이지 단위)으로 분할하여 메모리 폭주 방지.
- **실시간 프린터 모니터링**: 선택한 프린터의 오프라인/준비 상태를 30초마다 자동 스캔하며, 상태 진단 툴팁 제공.
- **오프라인 복구 시각 알림**: 프린터가 오프라인에서 준비 상태로 복귀 시 녹색 링 효과 및 데스크톱 알림 전달.
- **자동 간지 삽입**: 묶음 사이에 구분용 간지(Slip Sheet)를 자동 생성하여 출력을 용이하게 관리.
