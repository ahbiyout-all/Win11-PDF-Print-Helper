# 🏗️ 기술 아키텍처 명세서 (Technical Architecture)

Win11 PDF Print Helper의 시스템 아키텍처, 데이터 흐름, IPC 통신 및 메모리 안전성 설계를 설명합니다.

---

## 1. 시스템 구성도 (System Overview)

```
+-----------------------------------------------------------------------+
|                         React Frontend UI                             |
|  - File Parser (pdfjs-dist / pdf-lib)                                 |
|  - Real-time Printer Status Monitor (30s Interval)                     |
|  - Status Diagnosis Tooltip (.printer-status-indicator)               |
|  - Recovery Highlight & Web Notification Handler                      |
+-----------------------------------------------------------------------+
                                   |
                         IPC Channel (Electron)
                                   |
+-----------------------------------------------------------------------+
|                      Electron Main Process                            |
|  - event.sender.getPrintersAsync() [Native Windows Spooler API]       |
|  - Temp PDF Buffer Storage (os.tmpdir())                               |
|  - Silent Print via `pdf-to-printer` (ptp.print)                       |
|  - System Log Recorder (PDF_Helper_Logs)                              |
+-----------------------------------------------------------------------+
```

---

## 2. 주요 모듈 및 통신 구조

### 1) Electron IPC 핸들러 (`electron-main.js`)
- `get-printers`: 인코딩 깨짐 없는 네이티브 프린터 목록 추출 (`getPrintersAsync()`)
- `check-printer-status`: 지정 프린터의 상태 코드 및 `statusText` 개별 조회
- `print-pdf`: PDF Buffer를 인계받아 임시 파일 생성 후 `pdf-to-printer`를 통한 무소음 직출력
- `save-log` / `open-log-folder`: 출력이력 및 오류 로그 수집

### 2) 클라이언트 분할 엔진 (`src/App.tsx`)
- `pdf-lib` 패키지를 사용하여 메모리를 소모하는 전체 변환 대신, 원본 PDF에서 지정한 페이지 번호의 `PDFPage` 객체만 빠르게 덤프하여 독립적인 분할 묶음 PDF 파일(`ArrayBuffer`)로 생성합니다.
- 대용량 가비지 컬렉션(GC)을 원활하게 돕기 위해 묶음 생성 직후 메모리 해제 패턴을 사용합니다.

### 3) Pre-flight Check 알고리즘
```ts
// 분할 묶음 전송 전 사전 점검
const statusCheck = await ipcRenderer.invoke('check-printer-status', selectedPrinter);
if (!statusCheck.isOnline) {
  // 자동으로 인쇄를 일시 정지하고 상태 대화상자 노출
  setIsPaused(true);
  alert(`프린터 상태 이상: ${statusCheck.statusText}`);
  return;
}
```

---

## 3. PWA 서비스 워커 및 번들 최적화 (`vite.config.ts`)

- 대용량 PDF 조작을 지원하는 `pdf-lib` 및 `pdfjs-dist` 번들 모듈로 인해 JS 자산 크기가 커짐에 따라, Service Worker 미리 캐싱 용량 제한(`maximumFileSizeToCacheInBytes`)을 `5MB`로 증설하여 PWA 오프라인 작동 안정성을 확보했습니다.

```typescript
// vite.config.ts
VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['icon.svg'],
  workbox: {
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB로 확대
  },
  ...
})
```
