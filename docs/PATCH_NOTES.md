# 📋 패치 노트 & 변경 기록 (Patch Notes & Changelog)

Win11 PDF Print Helper의 업데이트 버전별 변경 내역 및 개선 사항 문서입니다.

### [제작자 및 공식 채널 안내]
- **개발자**: AhBiYout
- **GitHub 저장소**: [https://github.com/AhBiYout-all/Win11-PDF-Print-Helper](https://github.com/AhBiYout-all/Win11-PDF-Print-Helper)
- **공식 구글 블로그**: [https://ahbiyoutvibe.blogspot.com/](https://ahbiyoutvibe.blogspot.com/)
- **소속**: [https://www.cisnet.co.kr](https://www.cisnet.co.kr)

---

## 🚀 [v1.4.0] - 2026-10-06 (최신 패치)

### 🌟 신규 기능 & UI/UX 개선
1. **GitHub Releases 기반 실시간 자동 업데이트 알림 시스템**
   - GitHub Releases API를 연동하여 앱 실행 시 및 6시간 주기로 최신 버전 릴리스를 실시간 감지합니다.
   - 새로운 릴리스가 등록되면 상단 헤더의 알림 뱃지와 함께 전용 **업데이트 알림 팝업창**이 자동으로 호출됩니다.
   - 팝업창에서 현재 버전, 최신 버전, 릴리스 노트 요약, GitHub 저장소 경로, 설치 파일 다운로드 링크를 제공합니다.

2. **2026 GitHub Actions 차세대 런타임 워크플로 구축 (`.github/workflows/release.yml`)**
   - Node.js 20 EOL 대응에 따라 권고 표준인 **Node.js 22 LTS** 환경을 적용했습니다.
   - 태그 푸시(`v*`) 시 Windows 데스크톱 설치 파일(.exe) 및 크로스 플랫폼 번들을 자동 빌드하여 GitHub Releases의 배포 자산(Asset)으로 첨부합니다.

3. **배포 자동화 배치 스크립트 (`github-deploy.bat`)**
   - 저장소 커밋, 푸시, 버전 판올림(Bump) 및 태그 푸시를 원클릭으로 처리합니다.
   - 배포 전 불필요한 빌드 아티팩트(`release/`, `dist/`, `node_modules/`, `.env`) 및 개인 이메일 노출 여부를 사전 필터링합니다.

2. **프린터 실시간 상태 진단 툴팁 (.printer-status-indicator)**
   - 프린터 상태 배지 마우스 호버 시 윈도우 스풀러 상태 코드(0~19)에 따른 **상세 오류 진단 툴팁**을 표시합니다.
   - 원인 설명 및 즉시 실행 가능한 해결 조치 사항(예: '일시 정지 해제 방법', '용지함 재정렬', '카트리지 흔들기')을 팝업 형태로 제공합니다.

3. **프린터 상태 복구 강조 & 데스크톱 알림**
   - 프린터가 `오프라인` 또는 `오류` 상태에서 `준비 완료` 상태로 전환될 때 배지가 녹색 링(Green Ring)과 함께 깜빡이며 시각적으로 돋보이도록 개선했습니다.
   - 프린터 선택 드롭다운 하단에 **[상태 복구 알림]** 옵션을 추가하여 오프라인에서 복구되면 브라우저 데스크톱 알림을 보냅니다.

4. **프린터 실시간 동기화 시각(Last Checked) 표시**
   - 프린터 상태 수집 시각(`최근 확인: HH:MM:SS`)을 드롭다운 내부 및 헤더 상태란에 타임스탬프로 출력하여 데이터의 실시간 상태를 명확하게 제시합니다.

---

## 📦 [v1.3.0] - 2026-06-28

### ⚙️ 안정성 & 빌드 최적화
1. **PWA 캐시 용량 확장**
   - `vite.config.ts` 내 Workbox PWA `maximumFileSizeToCacheInBytes` 한도를 **5MB**로 상향 조정하여, 대용량 PDF 처리 라이브러리 라이브 빌드 오류를 해결했습니다.

2. **Pre-flight Check 사전 검사 강화**
   - 대량 인쇄 분할 묶음 전송 바로 직전에 프린터 상태를 단독 IPC로 확인하여 오프라인 발생 시 작업을 즉시 일시 정지하는 보호 로직을 강화했습니다.

---

## 🛠️ [v1.2.0] - 2026-04-20

### 🖨️ 무인쇄 네이티브 인쇄 및 간지 옵션
1. **Windows Native Printer Enum 지원**
   - Electron Main Process에서 `getPrintersAsync()`를 사용하여 한글 프린터 이름 깨짐 현상을 해결했습니다.
2. **커스텀 간지(Slip Sheet) 생성기**
   - 분할 묶음 사이 텍스트 및 컬러 테마 설정 가능한 구분용 간지 자동 삽입 기능 구현.

---

## 📄 [v1.0.0] - 2026-01-10

### 🎉 최초 릴리즈
- 5,000페이지 이상 대용량 PDF 파일 드래그 앤 드롭 업로드 및 분할 인쇄 도우미 핵심 기능 구축.
