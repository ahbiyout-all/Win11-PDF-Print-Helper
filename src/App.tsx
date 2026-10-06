/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback } from 'react';
import { UploadCloud, FileText, Printer, CheckCircle, Settings, Trash2, Download, AlertCircle, Play, X, SlidersHorizontal, ArrowDownUp, Layers, BookOpen, FilePlus, History, RotateCcw, HelpCircle, Eye, Smartphone, AlertTriangle, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Palette, ChevronDown, CheckCircle2, XCircle, Info, Pen, Eraser, Save, Globe, ExternalLink, User, Github, Sparkles } from 'lucide-react';
import { PDFDocument, StandardFonts, rgb, grayscale, PDFDict, PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { motion, AnimatePresence } from 'motion/react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { cn } from './lib/utils';
import { get, set, del } from 'idb-keyval';
import printJS from 'print-js';
import { DrawingCanvas, DrawingCanvasRef } from './components/DrawingCanvas';
import { useGithubUpdateChecker, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from './hooks/useGithubUpdateChecker';
import { UpdateNotificationModal } from './components/UpdateNotificationModal';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface Chunk {
  id: string;
  start: number;
  end: number;
  blob: Blob;
  printed: boolean;
  failed?: boolean;
  errorMessage?: string;
}

interface PrintSession {
  fileName: string;
  fileSize: number;
  printedChunkIds: string[];
  lastUpdated: number;
}

interface AppLog {
  id: string;
  timestamp: number;
  message: string;
  type: 'INFO' | 'ERROR' | 'SUCCESS';
}

const checkUnembeddedFonts = (pdfDoc: PDFDocument): boolean => {
  try {
    const context = pdfDoc.context;
    const objects = context.enumerateIndirectObjects();
    
    for (const [ref, obj] of objects) {
      if (obj instanceof PDFDict) {
        const type = obj.get(PDFName.of('Type'));
        if (type === PDFName.of('Font')) {
          const baseFontObj = obj.get(PDFName.of('BaseFont'));
          const baseFont = baseFontObj instanceof PDFName ? baseFontObj.decodeText() : '';
          
          const isStandard = ['Helvetica', 'Times', 'Courier', 'Symbol', 'ZapfDingbats'].some(f => baseFont.includes(f));
          
          if (!isStandard) {
            const subtype = obj.get(PDFName.of('Subtype'));
            
            if (subtype === PDFName.of('Type0')) {
              // Type0 fonts defer to DescendantFonts
              const descendantFontsRef = obj.get(PDFName.of('DescendantFonts'));
              const descendantFonts = context.lookup(descendantFontsRef);
              
              if (descendantFonts && descendantFonts.constructor.name === 'PDFArray') {
                // @ts-ignore
                const descFontRef = descendantFonts.get(0);
                const descFont = context.lookup(descFontRef);
                
                if (descFont instanceof PDFDict) {
                  const descriptorRef = descFont.get(PDFName.of('FontDescriptor'));
                  const descriptor = context.lookup(descriptorRef);
                  
                  if (descriptor instanceof PDFDict) {
                    const hasFile = descriptor.has(PDFName.of('FontFile')) || 
                                    descriptor.has(PDFName.of('FontFile2')) || 
                                    descriptor.has(PDFName.of('FontFile3'));
                    if (!hasFile) return true;
                  } else {
                    return true; // No descriptor means not embedded
                  }
                }
              }
            } else {
              // Type1, TrueType, etc.
              const descriptorRef = obj.get(PDFName.of('FontDescriptor'));
              const descriptor = context.lookup(descriptorRef);
              
              if (descriptor instanceof PDFDict) {
                const hasFile = descriptor.has(PDFName.of('FontFile')) || 
                                descriptor.has(PDFName.of('FontFile2')) || 
                                descriptor.has(PDFName.of('FontFile3'));
                if (!hasFile) return true;
              } else {
                return true; // No descriptor for non-standard font
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("Failed to check for unembedded fonts", e);
  }
  return false;
};

const AdPlaceholder = ({ className = "" }: { className?: string }) => (
  <div className={cn("w-full bg-gray-50/80 border border-gray-200 border-dashed rounded-xl flex flex-col items-center justify-center text-gray-400 overflow-hidden relative", className)}>
    <div className="absolute top-0 right-0 bg-gray-200 text-gray-500 text-[10px] px-2 py-0.5 rounded-bl-lg">Ad</div>
    <span className="text-sm font-medium">구글 애드센스 광고 영역</span>
    <span className="text-xs mt-1">반응형 디스플레이 배너 (권장)</span>
  </div>
);

const getFriendlyErrorMessage = (errorMsg: string) => {
  const lowerMsg = errorMsg.toLowerCase();
  
  if (lowerMsg.includes('offline') || lowerMsg.includes('not connected')) {
    return {
      title: '프린터 오프라인',
      description: '프린터가 꺼져 있거나 연결되어 있지 않습니다.',
      solutions: [
        '프린터 전원이 켜져 있는지 확인하세요.',
        'USB 케이블 또는 네트워크 연결 상태를 확인하세요.',
        '프린터가 절전 모드인지 확인하고 깨워주세요.'
      ]
    };
  }
  
  if (lowerMsg.includes('paper') || lowerMsg.includes('jam') || lowerMsg.includes('empty')) {
    return {
      title: '용지 문제',
      description: '프린터에 용지가 없거나 걸려 있습니다.',
      solutions: [
        '용지함에 종이가 충분한지 확인하세요.',
        '프린터 내부에 걸린 종이가 없는지 확인하세요.',
        '용지가 올바르게 급지되어 있는지 확인하세요.'
      ]
    };
  }
  
  if (lowerMsg.includes('ink') || lowerMsg.includes('toner') || lowerMsg.includes('cartridge')) {
    return {
      title: '잉크/토너 부족',
      description: '잉크나 토너가 부족하거나 카트리지에 문제가 있습니다.',
      solutions: [
        '잉크/토너 잔량을 확인하고 필요시 교체하세요.',
        '카트리지가 제대로 장착되어 있는지 확인하세요.'
      ]
    };
  }
  
  if (lowerMsg.includes('busy') || lowerMsg.includes('spool')) {
    return {
      title: '프린터 사용 중',
      description: '프린터가 다른 작업을 처리 중이거나 대기열이 꽉 찼습니다.',
      solutions: [
        '현재 진행 중인 인쇄 작업이 끝날 때까지 기다려주세요.',
        '프린터 스풀러(대기열)를 비우고 다시 시도하세요.',
        '프린터를 재부팅해 보세요.'
      ]
    };
  }

  return {
    title: '인쇄 오류',
    description: errorMsg,
    solutions: [
      '프린터 상태를 확인하고 다시 시도해 주세요.',
      '프린터 전원을 껐다 켜보세요.',
      '프린터 드라이버가 최신 버전인지 확인하세요.'
    ]
  };
};

interface StatusDiagnosis {
  title: string;
  meaning: string;
  actions: string[];
  severity: 'success' | 'warning' | 'error';
}

const getPrinterStatusDiagnosis = (status: number | undefined, statusText: string | undefined): StatusDiagnosis => {
  // If we have a specific status code
  if (status !== undefined) {
    switch (status) {
      case 0:
        return {
          title: "준비 완료 (Ready)",
          meaning: "프린터가 인쇄 명령을 받을 준비가 되었습니다.",
          actions: ["정상 상태입니다. 바로 인쇄를 진행할 수 있습니다."],
          severity: "success"
        };
      case 1:
        return {
          title: "일시 정지 (Paused)",
          meaning: "프린터가 일시 정지 상태로 설정되어 인쇄가 대기 중입니다.",
          actions: [
            "윈도우 제어판 > '장치 및 프린터'에서 프린터 아이콘을 우클릭합니다.",
            "'인쇄 일시 중지' 또는 '오프라인으로 작업' 옵션이 체크되어 있다면 해제하세요."
          ],
          severity: "warning"
        };
      case 2:
        return {
          title: "프린터 오류 (Error)",
          meaning: "프린터 하드웨어 또는 소프트웨어에 오류가 감지되었습니다.",
          actions: [
            "프린터 본체의 액정 화면이나 경고등(빨간불)을 확인하세요.",
            "인쇄 대기열에 쌓여 있는 오류 난 인쇄 작업을 삭제(취소)하고 재시도하세요."
          ],
          severity: "error"
        };
      case 3:
        return {
          title: "오프라인 / 연결 끊김 (Offline)",
          meaning: "프린터 전원이 꺼져 있거나 PC와의 연결이 끊어졌습니다.",
          actions: [
            "프린터 전원 케이블이 꽂혀 있고 전원이 켜져 있는지 확인하세요.",
            "USB 케이블을 뽑았다가 다시 꽂거나, 네트워크(Wi-Fi/LAN) 연결을 확인하세요."
          ],
          severity: "error"
        };
      case 4:
        return {
          title: "용지 걸림 (Paper Jam)",
          meaning: "인쇄 경로 도중에 용지가 걸려 이송이 중단되었습니다.",
          actions: [
            "프린터 앞/뒤 덮개를 열어 용지 경로를 확인하세요.",
            "걸린 용지를 양손으로 잡고 찢어지지 않게 천천히 잡아당겨 제거하세요."
          ],
          severity: "error"
        };
      case 5:
        return {
          title: "용지 부족 (Paper Out / Empty)",
          meaning: "용지함에 인쇄 가능한 용지가 없습니다.",
          actions: [
            "용지 공급 트레이를 열어 규격 용지(A4 등)를 채워 넣으세요.",
            "용지 가이드를 용지 크기에 맞게 밀착시켜 정렬해 주세요."
          ],
          severity: "warning"
        };
      case 6:
        return {
          title: "급지 오류 / 용지 문제 (Paper Problem)",
          meaning: "지정된 크기의 용지가 없거나 급지 롤러가 미끄러집니다.",
          actions: [
            "인쇄 설정에서 지정한 용지 크기(A4, Letter 등)가 실제 적재된 용지와 같은지 확인하세요.",
            "용지가 너무 정전기가 심하거나 습하지 않은지 확인하세요."
          ],
          severity: "warning"
        };
      case 7:
        return {
          title: "토너/잉크 부족 (Toner/Ink Low)",
          meaning: "토너 카트리지 또는 잉크 잔량이 소진 직전입니다.",
          actions: [
            "카트리지를 꺼내 좌우로 5~6회 부드럽게 흔든 후 다시 장착해 보세요.",
            "인쇄 품질이 흐려지면 새 소모품으로 교체해야 합니다."
          ],
          severity: "warning"
        };
      case 8:
        return {
          title: "인쇄 중 (Busy / Printing)",
          meaning: "현재 다른 인쇄 작업 또는 헤드 정렬 작업이 수행 중입니다.",
          actions: [
            "진행 중인 인쇄가 모두 끝날 때까지 잠시 기다려 주세요."
          ],
          severity: "success"
        };
      case 9:
        return {
          title: "오프라인 / 점검 필요 (Offline / Service Required)",
          meaning: "오프라인 상태이거나 하드웨어 점검(서비스 요망)이 필요합니다.",
          actions: [
            "프린터 전원을 껐다가 10초 후 다시 켜보세요.",
            "문제가 지속되면 프린터 제조사의 진단 도구를 사용하거나 서비스 센터에 문의하세요."
          ],
          severity: "error"
        };
    }
  }

  // Fallback to text matching
  const text = (statusText || "").toLowerCase();
  if (text.includes("offline") || text.includes("오프라인") || text.includes("끊김")) {
    return {
      title: "오프라인 (Offline)",
      meaning: "프린터가 PC와 통신할 수 없는 상태입니다.",
      actions: [
        "프린터 전원이 켜져 있는지 확인하세요.",
        "연결 케이블(USB/LAN) 상태를 확인하거나 네트워크(Wi-Fi) 연결을 점검하세요."
      ],
      severity: "error"
    };
  } else if (text.includes("jam") || text.includes("걸림")) {
    return {
      title: "용지 걸림 (Paper Jam)",
      meaning: "프린터 내부에 용지가 걸려 있습니다.",
      actions: [
        "프린터 덮개를 열고 걸린 용지를 천천히 잡아당겨 제거하세요."
      ],
      severity: "error"
    };
  } else if (text.includes("empty") || text.includes("out") || text.includes("부족") || text.includes("없음")) {
    return {
      title: "용지/토너 부족",
      meaning: "인쇄에 필요한 용지 또는 소모품(잉크/토너)이 부족합니다.",
      actions: [
        "용지함에 용지를 채우거나 카트리지 상태를 확인해 보세요."
      ],
      severity: "warning"
    };
  } else if (text.includes("error") || text.includes("오류") || text.includes("실패")) {
    return {
      title: "프린터 오류 (Error)",
      meaning: "인쇄 장치에 오류가 발생했습니다.",
      actions: [
        "프린터 액정 창의 에러 메시지를 확인하거나 전원을 재부팅해 보세요."
      ],
      severity: "error"
    };
  } else if (text.includes("busy") || text.includes("printing") || text.includes("인쇄중") || text.includes("인쇄 중")) {
    return {
      title: "인쇄 진행 중 (Printing)",
      meaning: "프린터가 활발히 작동 중입니다.",
      actions: [
        "현재 작업이 완료되면 자동으로 다음 작업이 시작됩니다."
      ],
      severity: "success"
    };
  }

  // Default Normal State
  return {
    title: statusText || "정상 작동 (Normal)",
    meaning: "프린터 상태가 양호하며 인쇄할 준비가 되어 있습니다.",
    actions: ["정상 상태입니다. 바로 대량 분할 인쇄를 시작할 수 있습니다."],
    severity: "success"
  };
};

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  
  // Load settings from localStorage or use defaults
  const [pagesPerChunk, setPagesPerChunk] = useState<number>(() => {
    const saved = localStorage.getItem('pdf-helper-pagesPerChunk');
    return saved !== null ? Number(saved) : 200;
  });
  
  // Advanced Options
  const [printRange, setPrintRange] = useState<'all' | 'custom'>(() => {
    return (localStorage.getItem('pdf-helper-printRange') as 'all' | 'custom') || 'all';
  });
  const [customRangeStart, setCustomRangeStart] = useState<string>(() => {
    return localStorage.getItem('pdf-helper-customRangeStart') || '1';
  });
  const [customRangeEnd, setCustomRangeEnd] = useState<string>(() => {
    return localStorage.getItem('pdf-helper-customRangeEnd') || '';
  });
  const [pageFilter, setPageFilter] = useState<'all' | 'odd' | 'even'>(() => {
    return (localStorage.getItem('pdf-helper-pageFilter') as 'all' | 'odd' | 'even') || 'all';
  });
  const [reverseOrder, setReverseOrder] = useState<boolean>(() => {
    return localStorage.getItem('pdf-helper-reverseOrder') === 'true';
  });
  const [gutterMargin, setGutterMargin] = useState<number>(() => {
    const saved = localStorage.getItem('pdf-helper-gutterMargin');
    return saved !== null ? Number(saved) : 0;
  });
  const [copies, setCopies] = useState<number>(() => {
    const saved = localStorage.getItem('pdf-helper-copies');
    return saved !== null ? Number(saved) : 1;
  });
  const [isDuplex, setIsDuplex] = useState<boolean>(() => {
    return localStorage.getItem('pdf-helper-isDuplex') === 'true';
  });
  const [duplexBinding, setDuplexBinding] = useState<'long' | 'short'>(() => {
    return (localStorage.getItem('pdf-helper-duplexBinding') as any) || 'long';
  });
  const [slipSheet, setSlipSheet] = useState<'none' | 'document_start' | 'chunk_start'>(() => {
    return (localStorage.getItem('pdf-helper-slipSheet') as any) || 'none';
  });
  const [customSlipSheetText, setCustomSlipSheetText] = useState<string>(() => {
    return localStorage.getItem('pdf-helper-customSlipSheetText') || '';
  });
  const [slipSheetDesign, setSlipSheetDesign] = useState<'minimal' | 'modern' | 'classic'>(() => {
    return (localStorage.getItem('pdf-helper-slipSheetDesign') as any) || 'minimal';
  });
  const [slipSheetAccentColor, setSlipSheetAccentColor] = useState<string>(() => {
    return localStorage.getItem('pdf-helper-slipSheetAccentColor') || '#0067C0';
  });
  const [isGrayscale, setIsGrayscale] = useState<boolean>(() => {
    const saved = localStorage.getItem('pdf-helper-isGrayscale');
    return saved !== null ? saved === 'true' : true;
  });
  const [collate, setCollate] = useState<boolean>(() => {
    return localStorage.getItem('pdf-helper-collate') === 'true';
  });
  const [staple, setStaple] = useState<boolean>(() => {
    return localStorage.getItem('pdf-helper-staple') === 'true';
  });
  const [colorManagement, setColorManagement] = useState<'driver' | 'app'>(() => {
    return (localStorage.getItem('pdf-helper-colorManagement') as any) || 'driver';
  });
  const [paperSize, setPaperSize] = useState<'Original' | 'A4' | 'A3' | 'A2' | 'A1' | 'B4' | 'Letter' | 'Plotter24' | 'Plotter36'>(() => {
    return (localStorage.getItem('pdf-helper-paperSize') as any) || 'Original';
  });
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>(() => {
    return (localStorage.getItem('pdf-helper-orientation') as any) || 'auto';
  });
  const [printQuality, setPrintQuality] = useState<'standard' | 'high' | 'draft'>(() => {
    return (localStorage.getItem('pdf-helper-printQuality') as any) || 'standard';
  });
  const [showPrintDialog, setShowPrintDialog] = useState<boolean>(() => {
    return localStorage.getItem('pdf-helper-showPrintDialog') !== 'false';
  });
  
  const [printers, setPrinters] = useState<{deviceId: string, name: string, status?: number, statusText?: string}[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>(() => {
    return localStorage.getItem('pdf-helper-selectedPrinter') || '';
  });

  const [enableBrowserNotifications, setEnableBrowserNotifications] = useState<boolean>(() => {
    return localStorage.getItem('pdf-helper-printer-notifications') === 'true';
  });
  const [showRecoveryHighlight, setShowRecoveryHighlight] = useState(false);
  const prevPrinterOnlineRef = React.useRef<boolean | null>(null);

  React.useEffect(() => {
    localStorage.setItem('pdf-helper-printer-notifications', enableBrowserNotifications.toString());
  }, [enableBrowserNotifications]);

  React.useEffect(() => {
    const p = printers.find(pr => pr.deviceId === selectedPrinter);
    if (!selectedPrinter || !p) {
      prevPrinterOnlineRef.current = null;
      return;
    }

    const isOnline = p.status !== 9 && p.status !== 3;

    if (prevPrinterOnlineRef.current !== null) {
      if (!prevPrinterOnlineRef.current && isOnline) {
        // Printer recovered/went back online!
        setShowRecoveryHighlight(true);
        const timer = setTimeout(() => setShowRecoveryHighlight(false), 5000);

        if (enableBrowserNotifications && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('프린터 준비 완료', {
              body: `[${p.name}] 프린터가 오프라인에서 준비 완료 상태로 복귀했습니다.`,
              icon: '/favicon.ico'
            });
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
              if (permission === 'granted') {
                new Notification('프린터 준비 완료', {
                  body: `[${p.name}] 프린터가 오프라인에서 준비 완료 상태로 복귀했습니다.`,
                  icon: '/favicon.ico'
                });
              }
            });
          }
        }

        return () => clearTimeout(timer);
      }
    }

    prevPrinterOnlineRef.current = isOnline;
  }, [printers, selectedPrinter, enableBrowserNotifications]);

  // Save settings to localStorage whenever they change
  const [globalCollate, setGlobalCollate] = useState<boolean>(() => {
    return localStorage.getItem('pdf-helper-globalCollate') === 'true';
  });

  React.useEffect(() => {
    localStorage.setItem('pdf-helper-pagesPerChunk', pagesPerChunk.toString());
    localStorage.setItem('pdf-helper-printRange', printRange);
    localStorage.setItem('pdf-helper-customRangeStart', customRangeStart);
    localStorage.setItem('pdf-helper-customRangeEnd', customRangeEnd);
    localStorage.setItem('pdf-helper-pageFilter', pageFilter);
    localStorage.setItem('pdf-helper-reverseOrder', reverseOrder.toString());
    localStorage.setItem('pdf-helper-gutterMargin', gutterMargin.toString());
    localStorage.setItem('pdf-helper-copies', copies.toString());
    localStorage.setItem('pdf-helper-isDuplex', isDuplex.toString());
    localStorage.setItem('pdf-helper-duplexBinding', duplexBinding);
    localStorage.setItem('pdf-helper-slipSheet', slipSheet);
    localStorage.setItem('pdf-helper-customSlipSheetText', customSlipSheetText);
    localStorage.setItem('pdf-helper-slipSheetDesign', slipSheetDesign);
    localStorage.setItem('pdf-helper-slipSheetAccentColor', slipSheetAccentColor);
    localStorage.setItem('pdf-helper-isGrayscale', isGrayscale.toString());
    localStorage.setItem('pdf-helper-collate', collate.toString());
    localStorage.setItem('pdf-helper-staple', staple.toString());
    localStorage.setItem('pdf-helper-colorManagement', colorManagement);
    localStorage.setItem('pdf-helper-paperSize', paperSize);
    localStorage.setItem('pdf-helper-orientation', orientation);
    localStorage.setItem('pdf-helper-printQuality', printQuality);
    localStorage.setItem('pdf-helper-showPrintDialog', showPrintDialog.toString());
    localStorage.setItem('pdf-helper-selectedPrinter', selectedPrinter);
    localStorage.setItem('pdf-helper-globalCollate', globalCollate.toString());
  }, [pagesPerChunk, printRange, customRangeStart, customRangeEnd, pageFilter, reverseOrder, gutterMargin, copies, isDuplex, duplexBinding, slipSheet, customSlipSheetText, slipSheetDesign, slipSheetAccentColor, isGrayscale, collate, staple, colorManagement, paperSize, orientation, printQuality, showPrintDialog, selectedPrinter, globalCollate]);

  const [isRefreshingPrinters, setIsRefreshingPrinters] = useState(false);
  const [lastCheckedTime, setLastCheckedTime] = useState<Date | null>(null);

  const fetchPrinters = useCallback(async () => {
    const isElectron = navigator.userAgent.toLowerCase().includes('electron');
    if (!isElectron) return;

    setIsRefreshingPrinters(true);
    try {
      const { ipcRenderer } = (window as any).require('electron');
      const result = await ipcRenderer.invoke('get-printers');
      if (result.success && result.printers) {
        setPrinters(result.printers);
        setLastCheckedTime(new Date());
      }
    } catch (e) {
      console.error("Failed to fetch printers", e);
    } finally {
      setIsRefreshingPrinters(false);
    }
  }, []);

  React.useEffect(() => {
    const isElectron = navigator.userAgent.toLowerCase().includes('electron');
    if (isElectron) {
      fetchPrinters();
      // Refresh printer list every 30 seconds to update status
      const interval = setInterval(fetchPrinters, 30000);
      return () => clearInterval(interval);
    }
  }, [fetchPrinters]);

  const handleResetSettings = useCallback(() => {
    if (!window.confirm('모든 인쇄 설정을 기본값으로 초기화하시겠습니까?')) return;
    
    setPagesPerChunk(100);
    setPrintRange('all');
    setCustomRangeStart('');
    setCustomRangeEnd('');
    setPageFilter('all');
    setReverseOrder(false);
    setGutterMargin(0);
    setCopies(1);
    setIsDuplex(false);
    setDuplexBinding('long');
    setSlipSheet('none');
    setCustomSlipSheetText('간지');
    setIsGrayscale(false);
    setCollate(false);
    setStaple(false);
    setColorManagement('driver');
    setPaperSize('Original');
    setOrientation('auto');
    setPrintQuality('standard');
    setShowPrintDialog(true);
    setSelectedPrinter('');
  }, []);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [fontWarning, setFontWarning] = useState<boolean>(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showPatchNotes, setShowPatchNotes] = useState(false);
  const [showManualUpdateModal, setShowManualUpdateModal] = useState(false);
  const {
    updateAvailable,
    setUpdateAvailable,
    latestRelease,
    isChecking: isCheckingUpdate,
    checkForUpdates,
    dismissUpdate,
    currentVersion,
  } = useGithubUpdateChecker();
  const [recommendedPagesPerChunk, setRecommendedPagesPerChunk] = useState<number | null>(null);
  const [previewChunkId, setPreviewChunkId] = useState<string | null>(null);
  const [previewPageNumber, setPreviewPageNumber] = useState<number>(1);
  const [previewNumPages, setPreviewNumPages] = useState<number | null>(null);
  const [previewZoom, setPreviewZoom] = useState<number>(1);
  
  // Drawing state
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawColor, setDrawColor] = useState('#E11D48');
  const [drawLineWidth, setDrawLineWidth] = useState(3);
  const [renderedPageSize, setRenderedPageSize] = useState<{width: number, height: number} | null>(null);
  const drawingCanvasRef = useRef<DrawingCanvasRef>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [printSession, setPrintSession] = useState<PrintSession | null>(null);
  const [autoPrintQueue, setAutoPrintQueue] = useState<string[]>([]);
  const [isAutoPrinting, setIsAutoPrinting] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [savedSessionMeta, setSavedSessionMeta] = useState<{fileName: string, date: number} | null>(null);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [showKioskGuide, setShowKioskGuide] = useState(false);
  const [showTroubleshootingGuide, setShowTroubleshootingGuide] = useState(false);
  const [appLogs, setAppLogs] = useState<AppLog[]>(() => {
    try {
      const saved = localStorage.getItem('pdf-helper-logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showPrinterDropdown, setShowPrinterDropdown] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const printerDropdownRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (printerDropdownRef.current && !printerDropdownRef.current.contains(event.target as Node)) {
        setShowPrinterDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    localStorage.setItem('pdf-helper-logs', JSON.stringify(appLogs));
  }, [appLogs]);

  React.useEffect(() => {
    get('pdf-helper-saved-session-meta').then(meta => {
      if (meta) setSavedSessionMeta(meta);
    }).catch(err => console.warn("Failed to load session meta", err));
  }, []);

  React.useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const validateAndSetFile = async (selectedFile: File | undefined) => {
    if (!selectedFile) return;
    
    if (selectedFile.type !== 'application/pdf' && !selectedFile.name.toLowerCase().endsWith('.pdf')) {
      setError('PDF 파일만 업로드 가능합니다.');
      return;
    }
    
    if (selectedFile.size === 0) {
      setError('파일 크기가 0바이트입니다. 올바른 파일을 업로드해주세요.');
      return;
    }

    setFile(selectedFile);
    setChunks([]);
    setError(null);
    setFontWarning(false);
    setProgress(0);
    setTotalPages(null);
    setSavedSessionMeta(null); // Clear meta when new file is uploaded

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
      const pageCount = pdfDoc.getPageCount();
      setTotalPages(pageCount);
      
      // Calculate recommended pages per chunk based on file size and page count
      // Target ~30MB per chunk to avoid browser OOM (Out of Memory)
      const avgPageSize = selectedFile.size / pageCount;
      const targetChunkSize = 30 * 1024 * 1024; // 30MB
      let recommended = Math.floor(targetChunkSize / avgPageSize);
      // Clamp between 10 and 500
      recommended = Math.max(10, Math.min(500, recommended));
      setRecommendedPagesPerChunk(recommended);
      
      // Check for unembedded fonts when file is loaded
      const hasUnembedded = checkUnembeddedFonts(pdfDoc);
      setFontWarning(hasUnembedded);
    } catch (err: any) {
      console.error("Failed to read PDF pages", err);
      if (err.message?.includes('encrypted') || err.message?.includes('password')) {
        setError(
          <div className="space-y-1">
            <p className="font-semibold">암호가 설정된 PDF 파일입니다.</p>
            <p>보안이 걸려 있어 문서를 분할할 수 없습니다. 다른 PDF 뷰어(크롬, 알PDF 등)에서 파일을 열고 <strong>'PDF로 인쇄(Print to PDF)'</strong>를 통해 암호가 해제된 새 PDF로 저장한 후 다시 업로드해 주세요.</p>
          </div>
        );
      } else {
        setError(
          <div className="space-y-1">
            <p className="font-semibold">PDF 파일을 읽을 수 없습니다.</p>
            <p>파일이 손상되었거나 호환되지 않는 형식일 수 있습니다. 다른 PDF 뷰어에서 파일을 열고 <strong>'PDF로 인쇄(Print to PDF)'</strong>를 통해 새로운 PDF 파일로 저장한 후 다시 시도해 보세요.</p>
          </div>
        );
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    validateAndSetFile(e.target.files?.[0]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    validateAndSetFile(e.dataTransfer.files?.[0]);
  }, []);

  const processPdf = async () => {
    if (!file) return;
    setIsProcessing(true);
    setProgress(0);
    setChunks([]);
    setError(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      
      let pdfDoc;
      try {
        pdfDoc = await PDFDocument.load(arrayBuffer);
      } catch (loadErr: any) {
        if (loadErr.message?.toLowerCase().includes('encrypted') || loadErr.message?.toLowerCase().includes('password')) {
          throw new Error('ENCRYPTED_PDF');
        }
        throw new Error('CORRUPTED_PDF');
      }

      const totalPages = pdfDoc.getPageCount();
      if (totalPages === 0) {
        throw new Error('EMPTY_PDF');
      }
      
      let startPage = printRange === 'custom' && customRangeStart ? parseInt(customRangeStart) : 1;
      let endPage = printRange === 'custom' && customRangeEnd ? parseInt(customRangeEnd) : totalPages;

      // Validate and clamp ranges
      if (isNaN(startPage) || startPage < 1) startPage = 1;
      if (isNaN(endPage) || endPage > totalPages) endPage = totalPages;
      if (startPage > endPage) {
        const temp = startPage;
        startPage = endPage;
        endPage = temp;
      }

      // Collect desired page indices based on filters
      let desiredIndices: number[] = [];
      for (let i = startPage - 1; i < endPage; i++) {
        const pageNum = i + 1;
        if (pageFilter === 'odd' && pageNum % 2 === 0) continue;
        if (pageFilter === 'even' && pageNum % 2 !== 0) continue;
        desiredIndices.push(i);
      }

      if (isDuplex && desiredIndices.length % 2 !== 0) {
        desiredIndices.push(-1); // -1 represents a blank page for duplex padding
      }

      if (reverseOrder) {
        if (isDuplex) {
          // Reverse pairs to maintain duplex alignment
          const pairs = [];
          for (let i = 0; i < desiredIndices.length; i += 2) {
            pairs.push([desiredIndices[i], desiredIndices[i + 1]]);
          }
          pairs.reverse();
          desiredIndices = pairs.flat();
        } else {
          desiredIndices.reverse();
        }
      }

      if (desiredIndices.length === 0) {
        setError("선택한 조건에 맞는 페이지가 없습니다.");
        setIsProcessing(false);
        return;
      }

      let customFontBytes: ArrayBuffer | null = null;
      if (slipSheet !== 'none') {
        try {
          const res = await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/nanumgothic/NanumGothic-Regular.ttf');
          if (res.ok) {
            customFontBytes = await res.arrayBuffer();
          } else {
            console.warn("Failed to load Korean font: HTTP " + res.status);
          }
        } catch (e) {
          console.warn("Failed to load Korean font for slip sheet", e);
        }
      }

      const newChunks: Chunk[] = [];
      const gutterPt = gutterMargin * 2.83465; // Convert mm to points
      
      let effectivePagesPerChunk = pagesPerChunk;
      if (isDuplex && effectivePagesPerChunk % 2 !== 0) {
        effectivePagesPerChunk += 1; // Ensure chunks don't split duplex pairs
      }

      const getTargetDimensions = (origWidth: number, origHeight: number) => {
        let targetW = origWidth;
        let targetH = origHeight;
        
        const A4_W = 595.28, A4_H = 841.89;
        const A3_W = 841.89, A3_H = 1190.55;
        const A2_W = 1190.55, A2_H = 1683.78;
        const A1_W = 1683.78, A1_H = 2383.94;
        const B4_W = 728.5, B4_H = 1031.8;
        const LETTER_W = 612, LETTER_H = 792;
        const PLOTTER24_W = 1728, PLOTTER24_H = 2592; // 24" x 36" (Arch D)
        const PLOTTER36_W = 2592, PLOTTER36_H = 3456; // 36" x 48" (Arch E)
        
        let baseW = origWidth, baseH = origHeight;
        if (paperSize === 'A4') { baseW = A4_W; baseH = A4_H; }
        else if (paperSize === 'A3') { baseW = A3_W; baseH = A3_H; }
        else if (paperSize === 'A2') { baseW = A2_W; baseH = A2_H; }
        else if (paperSize === 'A1') { baseW = A1_W; baseH = A1_H; }
        else if (paperSize === 'B4') { baseW = B4_W; baseH = B4_H; }
        else if (paperSize === 'Letter') { baseW = LETTER_W; baseH = LETTER_H; }
        else if (paperSize === 'Plotter24') { baseW = PLOTTER24_W; baseH = PLOTTER24_H; }
        else if (paperSize === 'Plotter36') { baseW = PLOTTER36_W; baseH = PLOTTER36_H; }
        
        if (paperSize !== 'Original') {
          const isOrigLandscape = origWidth > origHeight;
          let isTargetLandscape = isOrigLandscape;
          
          if (orientation === 'portrait') isTargetLandscape = false;
          if (orientation === 'landscape') isTargetLandscape = true;
          
          if (isTargetLandscape) {
            targetW = Math.max(baseW, baseH);
            targetH = Math.min(baseW, baseH);
          } else {
            targetW = Math.min(baseW, baseH);
            targetH = Math.max(baseW, baseH);
          }
        } else {
          if (orientation === 'portrait' && origWidth > origHeight) {
            targetW = origHeight; targetH = origWidth;
          } else if (orientation === 'landscape' && origWidth < origHeight) {
            targetW = origHeight; targetH = origWidth;
          }
        }
        
        return { width: targetW, height: targetH };
      };

      const needsReformatting = paperSize !== 'Original' || orientation !== 'auto' || gutterPt > 0;
      
      for (let i = 0; i < desiredIndices.length; i += effectivePagesPerChunk) {
        const chunkIndices = desiredIndices.slice(i, i + effectivePagesPerChunk);
        const newPdf = await PDFDocument.create();
        
        if (needsReformatting) {
          // Apply Gutter Margin and/or Paper Size/Orientation by embedding and shifting pages
          for (let j = 0; j < chunkIndices.length; j++) {
            const pageIndex = chunkIndices[j];
            
            if (pageIndex === -1) {
              // Use the dimensions of the preceding page for the blank page
              const lastValidIdx = chunkIndices.slice(0, j).reverse().find(idx => idx !== -1) ?? 0;
              const refPage = pdfDoc.getPage(lastValidIdx);
              const { width: origW, height: origH } = refPage.getSize();
              const { width: targetW, height: targetH } = getTargetDimensions(origW, origH);
              newPdf.addPage([targetW, targetH]);
            } else {
              const pageNum = pageIndex + 1; // Original 1-based page number
              const isOdd = pageNum % 2 !== 0;
              
              const origPage = pdfDoc.getPage(pageIndex);
              const { width: origW, height: origH } = origPage.getSize();
              
              const { width: targetW, height: targetH } = getTargetDimensions(origW, origH);
              
              const newPage = newPdf.addPage([targetW, targetH]);
              const embeddedPage = await newPdf.embedPage(origPage);
              
              // Calculate scale to fit
              const scale = Math.min(targetW / origW, targetH / origH);
              const scaledW = origW * scale;
              const scaledH = origH * scale;
              
              // Center the page
              let x = (targetW - scaledW) / 2;
              let y = (targetH - scaledH) / 2;
              
              // Apply gutter margin
              if (gutterPt > 0) {
                 const shiftX = isOdd ? gutterPt : -gutterPt;
                 x += shiftX;
              }
              
              newPage.drawPage(embeddedPage, {
                x, y, width: scaledW, height: scaledH
              });
            }
            
            // Yield to main thread and update progress per page to prevent UI freeze
            if (j % 5 === 0) {
              setProgress(Math.round(((i + j) / desiredIndices.length) * 100));
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
        } else {
          // Fast path: Copy pages to preserve links, insert blanks where needed
          const validIndices = chunkIndices.filter(idx => idx !== -1);
          const copiedPages = validIndices.length > 0 ? await newPdf.copyPages(pdfDoc, validIndices) : [];
          
          let copiedIndex = 0;
          for (let j = 0; j < chunkIndices.length; j++) {
            if (chunkIndices[j] === -1) {
              // Use the dimensions of the preceding page for the blank page
              const lastValidIdx = chunkIndices.slice(0, j).reverse().find(idx => idx !== -1) ?? 0;
              const refPage = pdfDoc.getPage(lastValidIdx);
              newPdf.addPage([refPage.getWidth(), refPage.getHeight()]);
            } else {
              newPdf.addPage(copiedPages[copiedIndex++]);
            }
            
            // Yield to main thread and update progress per page to prevent UI freeze
            if (j % 10 === 0) {
              setProgress(Math.round(((i + j) / desiredIndices.length) * 100));
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
        }
        
        // Find actual page numbers for the label (ignoring -1)
        const validChunkIndices = chunkIndices.filter(idx => idx !== -1);
        const firstPageInChunk = validChunkIndices.length > 0 ? validChunkIndices[0] + 1 : 0;
        const lastPageInChunk = validChunkIndices.length > 0 ? validChunkIndices[validChunkIndices.length - 1] + 1 : 0;

        if (slipSheet === 'chunk_start' || (slipSheet === 'document_start' && i === 0)) {
          newPdf.registerFontkit(fontkit);
          const font = customFontBytes 
            ? await newPdf.embedFont(customFontBytes) 
            : await newPdf.embedFont(StandardFonts.HelveticaBold);
            
          const firstPageSize = pdfDoc.getPage(desiredIndices[0]).getSize();
          const slipSheetDim = getTargetDimensions(firstPageSize.width, firstPageSize.height);
          const page = newPdf.insertPage(0, [slipSheetDim.width, slipSheetDim.height]);
          const { width, height } = page.getSize();
          
          // Helper to convert hex to RGB
          const hexToRgb = (hex: string) => {
            if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return rgb(0, 0.4, 0.75); // fallback to #0067C0
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;
            return rgb(r, g, b);
          };

          const accentColor = isGrayscale ? grayscale(0.2) : hexToRgb(slipSheetAccentColor);
          
          if (slipSheetDesign === 'minimal') {
            page.drawRectangle({
              x: 0, y: height - 120, width: width, height: 120,
              color: accentColor
            });
          } else if (slipSheetDesign === 'modern') {
            page.drawRectangle({
              x: 0, y: 0, width: 40, height: height,
              color: accentColor
            });
            page.drawRectangle({
              x: 40, y: height - 100, width: width - 40, height: 100,
              color: isGrayscale ? grayscale(0.95) : rgb(0.95, 0.95, 0.95)
            });
          } else if (slipSheetDesign === 'classic') {
            page.drawRectangle({
              x: 50, y: height - 100, width: width - 100, height: 4,
              color: accentColor
            });
            page.drawRectangle({
              x: 50, y: 100, width: width - 100, height: 4,
              color: accentColor
            });
          }
          
          const isKorean = !!customFontBytes;
          let title = isKorean 
            ? (slipSheet === 'chunk_start' ? "=== 분할 파트 시작 ===" : "=== 새로운 세트 시작 ===")
            : (slipSheet === 'chunk_start' ? "=== NEW PART START ===" : "=== NEW SET START ===");
            
          if (customSlipSheetText.trim()) {
            title = customSlipSheetText;
          }
            
          if (slipSheetDesign === 'minimal') {
            page.drawText(title, { x: 50, y: height - 75, size: 28, font, color: rgb(1, 1, 1) });
          } else if (slipSheetDesign === 'modern') {
            page.drawText(title, { x: 70, y: height - 65, size: 32, font, color: accentColor });
          } else {
            page.drawText(title, { x: 50, y: height / 2 + 50, size: 36, font, color: accentColor });
          }
          
          const subtitle = isKorean
            ? `파일명: ${file.name}\n파트: ${Math.floor(i / effectivePagesPerChunk) + 1} 번째 파트\n페이지: ${firstPageInChunk} ~ ${lastPageInChunk}`
            : `File: ${file.name}\nPart: ${Math.floor(i / effectivePagesPerChunk) + 1}\nPages: ${firstPageInChunk} ~ ${lastPageInChunk}`;
            
          const lines = subtitle.split('\n');
          const textColor = isGrayscale ? grayscale(0) : rgb(0, 0, 0);
          
          if (slipSheetDesign === 'minimal') {
            lines.forEach((line, idx) => {
              page.drawText(line, { x: 50, y: height - 180 - (idx * 35), size: 16, font, color: textColor });
            });
          } else if (slipSheetDesign === 'modern') {
            lines.forEach((line, idx) => {
              page.drawText(line, { x: 70, y: height - 160 - (idx * 40), size: 18, font, color: textColor });
            });
          } else {
            lines.forEach((line, idx) => {
              page.drawText(line, { x: 50, y: height / 2 - 50 - (idx * 30), size: 14, font, color: textColor });
            });
          }
          
          if (isDuplex) {
            newPdf.insertPage(1, [slipSheetDim.width, slipSheetDim.height]); // Add blank back page for slip sheet
          }
        }
        
        let finalPdf = newPdf;
        if (isDuplex && finalPdf.getPageCount() % 2 !== 0) {
          const lastPageSize = finalPdf.getPage(finalPdf.getPageCount() - 1).getSize();
          finalPdf.addPage([lastPageSize.width, lastPageSize.height]); // Pad end of document to even pages
        }
        
        const chunkBytes = await finalPdf.save();
        const blob = new Blob([chunkBytes], { type: 'application/pdf' });
        
        newChunks.push({
          id: `chunk-${i}`,
          start: firstPageInChunk,
          end: lastPageInChunk,
          blob,
          printed: false
        });
        
        setProgress(Math.round(((i + chunkIndices.length) / desiredIndices.length) * 100));
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const sessionKey = `pdf-helper-session-${file.name}`;
      const savedSessionStr = localStorage.getItem(sessionKey);
      let currentSession: PrintSession = {
        fileName: file.name,
        fileSize: file.size,
        printedChunkIds: [],
        lastUpdated: Date.now()
      };

      if (savedSessionStr) {
        try {
          const savedSession = JSON.parse(savedSessionStr) as PrintSession;
          if (savedSession.fileSize === file.size) {
            currentSession = savedSession;
            newChunks.forEach(chunk => {
              if (currentSession.printedChunkIds.includes(chunk.id)) {
                chunk.printed = true;
              }
            });
          }
        } catch (e) {
          console.warn("Failed to parse session", e);
        }
      }
      
      setPrintSession(currentSession);
      localStorage.setItem(sessionKey, JSON.stringify(currentSession));
      setChunks(newChunks);
    } catch (err: any) {
      console.error("Error processing PDF:", err);
      if (err.message === 'ENCRYPTED_PDF' || err.message?.includes('encrypted')) {
        setError(
          <div className="space-y-1">
            <p className="font-semibold">암호가 설정된 PDF 파일입니다.</p>
            <p>보안이 걸려 있어 문서를 분할할 수 없습니다. 다른 PDF 뷰어(크롬, 알PDF 등)에서 파일을 열고 <strong>'PDF로 인쇄(Print to PDF)'</strong>를 통해 암호가 해제된 새 PDF로 저장한 후 다시 업로드해 주세요.</p>
          </div>
        );
      } else if (err.message === 'CORRUPTED_PDF' || err.message?.includes('corrupted')) {
        setError(
          <div className="space-y-1">
            <p className="font-semibold">PDF 파일을 읽을 수 없습니다 (손상됨).</p>
            <p>파일 구조가 손상되었거나 호환되지 않는 형식입니다. 크롬 브라우저나 알PDF 등 다른 PDF 뷰어에서 파일을 열고 <strong>'PDF로 인쇄(Print to PDF)'</strong> 기능을 사용해 새로운 PDF 파일로 저장한 후 다시 시도해 보세요.</p>
          </div>
        );
      } else if (err.message === 'EMPTY_PDF') {
        setError(
          <div className="space-y-1">
            <p className="font-semibold">페이지가 없는 빈 PDF 문서입니다.</p>
            <p>내용이 포함된 올바른 PDF 파일을 업로드해 주세요.</p>
          </div>
        );
      } else {
        setError(
          <div className="space-y-1">
            <p className="font-semibold">문서 처리 중 오류가 발생했습니다.</p>
            <p>브라우저 메모리가 부족할 수 있습니다. <strong>분할 단위(페이지 수)를 줄이거나</strong> 브라우저를 완전히 종료한 후 다시 시작해 보세요.</p>
            <p className="text-xs text-red-600 mt-1">상세 오류: {err.message || '알 수 없는 오류'}</p>
          </div>
        );
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const saveLocalLog = async (message: string, type: 'INFO' | 'ERROR' | 'SUCCESS' = 'INFO') => {
    const newLog: AppLog = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      message,
      type
    };
    setAppLogs(prev => [newLog, ...prev].slice(0, 500)); // Keep last 500 logs

    const isElectron = navigator.userAgent.toLowerCase().includes('electron');
    if (isElectron) {
      try {
        const { ipcRenderer } = (window as any).require('electron');
        await ipcRenderer.invoke('save-log', { message, type });
      } catch (e) {
        console.error("Failed to save local log", e);
      }
    } else {
      // Fallback for browser environment
      console.log(`[${type}] ${message}`);
    }
  };

  const handleSaveAnnotations = async () => {
    if (!drawingCanvasRef.current || !drawingCanvasRef.current.hasDrawings()) return;
    
    const dataUrl = drawingCanvasRef.current.getDataUrl();
    if (!dataUrl) return;
    
    setIsProcessing(true);
    try {
      const chunk = chunks.find(c => c.id === previewChunkId);
      if (!chunk) return;
      
      const arrayBuffer = await chunk.blob.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      
      const page = pdfDoc.getPage(previewPageNumber - 1);
      const { width, height } = page.getSize();
      
      const pngImage = await pdfDoc.embedPng(dataUrl);
      
      page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width,
        height,
      });
      
      const pdfBytes = await pdfDoc.save();
      const newBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      
      setChunks(prev => prev.map(c => 
        c.id === chunk.id ? { ...c, blob: newBlob } : c
      ));
      
      drawingCanvasRef.current.clear();
      setIsDrawingMode(false);
      
      saveLocalLog("미리보기 주석이 저장되었습니다.", "SUCCESS");
    } catch (error) {
      console.error("Failed to save annotations:", error);
      saveLocalLog("주석 저장에 실패했습니다.", "ERROR");
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrint = async (chunkId: string) => {
    const chunk = chunks.find(c => c.id === chunkId);
    if (!chunk) return null;

    const isElectron = navigator.userAgent.toLowerCase().includes('electron');
    
    // Pre-flight connectivity check
    if (isElectron && selectedPrinter) {
      try {
        const { ipcRenderer } = (window as any).require('electron');
        const status = await ipcRenderer.invoke('check-printer-status', selectedPrinter);
        if (status.success && !status.isOnline) {
          const proceed = window.confirm(
            `⚠️ 프린터 연결 경고\n\n` +
            `선택한 프린터(${selectedPrinter})의 상태가 좋지 않습니다.\n` +
            `현재 상태: ${status.statusText}\n\n` +
            `해결 방법:\n` +
            `1. 프린터 전원이 켜져 있는지 확인하세요.\n` +
            `2. USB 케이블 또는 네트워크 연결을 확인하세요.\n` +
            `3. 프린터의 용지나 토너가 부족하지 않은지 확인하세요.\n\n` +
            `그래도 인쇄를 강제로 진행하시겠습니까?`
          );
          if (!proceed) {
            pauseAutoPrint();
            // Return a dummy ref that is already closed so it doesn't trigger popup blocker alert
            return { closed: true, close: () => {} };
          }
        }
      } catch (e) {
        console.warn("Printer status check failed", e);
      }
    } else if (!navigator.onLine) {
      const proceed = window.confirm("현재 오프라인 상태입니다. 인쇄가 불가능할 수 있습니다. 진행하시겠습니까?");
      if (!proceed) {
        pauseAutoPrint();
        return { closed: true, close: () => {} };
      }
    }
    
    if (isElectron) {
      let printSuccess = true;
      let errorMsg = "";
      try {
        const { ipcRenderer } = (window as any).require('electron');
        const arrayBuffer = await chunk.blob.arrayBuffer();
        
        const result = await ipcRenderer.invoke('print-pdf', { 
          buffer: arrayBuffer, 
          options: { 
            silent: true, 
            copies: globalCollate ? 1 : copies,
            printer: selectedPrinter || undefined,
            side: isDuplex ? (duplexBinding === 'short' ? 'duplexshort' : 'duplex') : 'simplex',
            collate: collate,
            staple: staple,
            colorManagement: colorManagement
          } 
        });
        
        if (!result.success) {
          console.error("Electron print failed:", result.error);
          printSuccess = false;
          errorMsg = result.error;
        }
      } catch (e: any) {
        console.error("IPC communication failed:", e);
        printSuccess = false;
        errorMsg = e.message || "IPC communication failed";
      }
      
      if (printSuccess) {
        saveLocalLog(`[SUCCESS] File: ${file?.name}, Pages: ${chunk.start}-${chunk.end}, Printer: ${selectedPrinter || 'Default'}`, 'SUCCESS');
        setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, printed: true, failed: false, errorMessage: undefined } : c));
        
        if (printSession && !printSession.printedChunkIds.includes(chunkId)) {
          const updatedSession = { 
            ...printSession, 
            printedChunkIds: [...printSession.printedChunkIds, chunkId], 
            lastUpdated: Date.now() 
          };
          setPrintSession(updatedSession);
          localStorage.setItem(`pdf-helper-session-${printSession.fileName}`, JSON.stringify(updatedSession));
        }
      } else {
        saveLocalLog(`[ERROR] File: ${file?.name}, Pages: ${chunk.start}-${chunk.end}, Error: ${errorMsg}`, 'ERROR');
        setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, failed: true, errorMessage: errorMsg } : c));
        if (isAutoPrinting) {
          pauseAutoPrint();
          alert(`인쇄 중 오류가 발생하여 자동 인쇄가 일시 정지되었습니다.\n\n오류 내용: ${getFriendlyErrorMessage(errorMsg).title}`);
        }
      }
      
      // Return a dummy printRef that auto-closes so the queue continues
      const dummyRef = { closed: false, close: () => { dummyRef.closed = true; } };
      setTimeout(() => dummyRef.close(), 1000);
      return dummyRef;
    }

    let printBlob = chunk.blob;
    
    // For browser printing, if copies > 1, we duplicate the pages in the PDF
    if (copies > 1 && !showPrintDialog) {
      try {
        const pdfDoc = await PDFDocument.load(await chunk.blob.arrayBuffer());
        const finalPdf = await PDFDocument.create();
        const allIndices = pdfDoc.getPageIndices();
        for (let c = 0; c < copies; c++) {
          const copiedPages = await finalPdf.copyPages(pdfDoc, allIndices);
          copiedPages.forEach(p => finalPdf.addPage(p));
        }
        const chunkBytes = await finalPdf.save();
        printBlob = new Blob([chunkBytes], { type: 'application/pdf' });
      } catch (e) {
        console.error("Failed to duplicate pages for copies", e);
      }
    }

    const url = URL.createObjectURL(printBlob);
    let printRef: any = null;

    if (showPrintDialog) {
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
        };
        printWindow.onafterprint = () => {
          printWindow.close();
        };
      }
      printRef = printWindow;
    } else {
      // Bypass mode (Automated) using printJS for more robust cross-browser iframe handling
      printRef = {
        closed: false,
        close: () => {
          printRef.closed = true;
        }
      };

      try {
        printJS({
          printable: url,
          type: 'pdf',
          showModal: false,
          onPrintDialogClose: () => {
            saveLocalLog(`[SUCCESS] File: ${file?.name}, Pages: ${chunk.start}-${chunk.end}, Browser Auto Print`, 'SUCCESS');
            setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, printed: true, failed: false, errorMessage: undefined } : c));
            if (printSession && !printSession.printedChunkIds.includes(chunkId)) {
              const updatedSession = { 
                ...printSession, 
                printedChunkIds: [...printSession.printedChunkIds, chunkId], 
                lastUpdated: Date.now() 
              };
              setPrintSession(updatedSession);
              localStorage.setItem(`pdf-helper-session-${printSession.fileName}`, JSON.stringify(updatedSession));
            }
            printRef.close();
          },
          onError: (error: any) => {
            console.error("printJS failed", error);
            saveLocalLog(`[ERROR] File: ${file?.name}, Pages: ${chunk.start}-${chunk.end}, Error: ${error?.message || 'Unknown'}`, 'ERROR');
            setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, failed: true, errorMessage: error?.message || "인쇄에 실패했습니다." } : c));
            if (isAutoPrinting) {
              pauseAutoPrint();
              alert(`인쇄 중 오류가 발생하여 자동 인쇄가 일시 정지되었습니다.\n\n오류 내용: ${getFriendlyErrorMessage(error?.message || "알 수 없는 오류").title}`);
            }
            printRef.close();
          }
        });
      } catch (e: any) {
        console.error("printJS execution failed", e);
        saveLocalLog(`[ERROR] File: ${file?.name}, Pages: ${chunk.start}-${chunk.end}, Error: ${e?.message || 'Execution failed'}`, 'ERROR');
        setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, failed: true, errorMessage: e?.message || "인쇄 실행 중 오류가 발생했습니다." } : c));
        if (isAutoPrinting) {
          pauseAutoPrint();
          alert(`인쇄 중 오류가 발생하여 자동 인쇄가 일시 정지되었습니다.\n\n오류 내용: ${getFriendlyErrorMessage(e?.message || "알 수 없는 오류").title}`);
        }
        printRef.close();
      }
      
      // Fallback timeout to ensure queue continues if onPrintDialogClose isn't supported or blocked
      setTimeout(() => {
        if (!printRef.closed) {
          saveLocalLog(`[SUCCESS] File: ${file?.name}, Pages: ${chunk.start}-${chunk.end}, Browser Auto Print (Fallback)`, 'SUCCESS');
          setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, printed: true, failed: false, errorMessage: undefined } : c));
          if (printSession && !printSession.printedChunkIds.includes(chunkId)) {
            const updatedSession = { 
              ...printSession, 
              printedChunkIds: [...printSession.printedChunkIds, chunkId], 
              lastUpdated: Date.now() 
            };
            setPrintSession(updatedSession);
            localStorage.setItem(`pdf-helper-session-${printSession.fileName}`, JSON.stringify(updatedSession));
          }
          printRef.close();
        }
      }, 5000);
    }

    if (showPrintDialog) {
      saveLocalLog(`[SUCCESS] File: ${file?.name}, Pages: ${chunk.start}-${chunk.end}, Browser Manual Print`, 'SUCCESS');
      setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, printed: true, failed: false, errorMessage: undefined } : c));
      
      if (printSession && !printSession.printedChunkIds.includes(chunkId)) {
        const updatedSession = { 
          ...printSession, 
          printedChunkIds: [...printSession.printedChunkIds, chunkId], 
          lastUpdated: Date.now() 
        };
        setPrintSession(updatedSession);
        localStorage.setItem(`pdf-helper-session-${printSession.fileName}`, JSON.stringify(updatedSession));
      }
    }
    
    return printRef;
  };

  const retryPrint = (chunkId: string) => {
    // Reset the chunk's failed state
    setChunks(prev => prev.map(c => c.id === chunkId ? { ...c, failed: false, errorMessage: undefined } : c));
    
    // Add it to the front of the auto print queue and start printing if not already
    setAutoPrintQueue(prev => {
      if (!prev.includes(chunkId)) {
        return [chunkId, ...prev];
      }
      return prev;
    });
    
    if (!isAutoPrinting) {
      setIsAutoPrinting(true);
    }
  };

  const startAutoPrint = () => {
    const unprinted = chunks.filter(c => !c.printed).map(c => c.id);
    if (unprinted.length === 0) {
      alert("모든 파트가 이미 인쇄되었습니다.");
      return;
    }

    const totalJobs = globalCollate ? unprinted.length * copies : unprinted.length;
    const confirmMsg = globalCollate 
      ? `전체 세트(${unprinted.length}개 파트)를 총 ${copies}회 반복하여 인쇄합니다.\n(총 ${totalJobs}회의 인쇄 작업이 전송됩니다.)\n\n프린터 상태를 확인하셨나요?`
      : `총 ${unprinted.length}개의 파트를 연속으로 인쇄합니다.\n(각 파트별 ${copies}부씩 출력)\n\n프린터 상태를 확인하셨나요?`;

    const proceed = window.confirm(confirmMsg);
    if (!proceed) return;

    let fullQueue: string[] = [];
    if (globalCollate) {
      for (let i = 0; i < copies; i++) {
        fullQueue = [...fullQueue, ...unprinted];
      }
    } else {
      fullQueue = unprinted;
    }

    setAutoPrintQueue(fullQueue);
    setIsAutoPrinting(true);
  };

  const pauseAutoPrint = () => {
    setIsAutoPrinting(false);
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAutoPrinting) {
        pauseAutoPrint();
        alert('ESC 키를 눌러 자동 인쇄가 일시 정지되었습니다.');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAutoPrinting]);

  const resumeAutoPrint = () => {
    if (autoPrintQueue.length > 0) {
      const proceed = window.confirm(`남은 ${autoPrintQueue.length}개의 파트 인쇄를 재개합니다.\n\n프린터가 준비되었는지 확인하셨나요?`);
      if (!proceed) return;
      setIsAutoPrinting(true);
    } else {
      startAutoPrint();
    }
  };

  const stopAutoPrint = () => {
    setIsAutoPrinting(false);
    setAutoPrintQueue([]);
  };

  const openLogFolder = async () => {
    const isElectron = navigator.userAgent.toLowerCase().includes('electron');
    if (isElectron) {
      try {
        const { ipcRenderer } = (window as any).require('electron');
        await ipcRenderer.invoke('open-log-folder');
      } catch (e) {
        console.error("Failed to open log folder", e);
      }
    }
  };

  React.useEffect(() => {
    if (isAutoPrinting && autoPrintQueue.length > 0) {
      const chunkId = autoPrintQueue[0];
      let timer: any;
      let isCancelled = false;

      const processPrint = async () => {
        const printWindow = await handlePrint(chunkId);
        
        if (isCancelled) return;

        if (!printWindow) {
          alert("팝업이 차단되었거나 인쇄에 실패했습니다. 브라우저 설정에서 팝업 차단을 해제해야 자동 연속 인쇄가 가능합니다.");
          stopAutoPrint();
          return;
        }

        timer = setInterval(() => {
          if (printWindow.closed) {
            clearInterval(timer);
            // Wait a short moment before triggering the next one
            setTimeout(() => {
              if (!isCancelled) setAutoPrintQueue(prev => prev.slice(1));
            }, 1000);
          }
        }, 500);
      };

      processPrint();

      return () => {
        isCancelled = true;
        if (timer) clearInterval(timer);
      };
    } else if (isAutoPrinting && autoPrintQueue.length === 0) {
      setIsAutoPrinting(false);
      // Optional: alert("모든 연속 인쇄가 완료되었습니다.");
    }
  }, [isAutoPrinting, autoPrintQueue]);

  const resetSession = () => {
    if (!printSession || !file) return;
    
    const updatedSession = { ...printSession, printedChunkIds: [], lastUpdated: Date.now() };
    setPrintSession(updatedSession);
    localStorage.setItem(`pdf-helper-session-${file.name}`, JSON.stringify(updatedSession));
    
    setChunks(chunks.map(c => ({ ...c, printed: false })));
  };

  const goBackToSettings = () => {
    setChunks([]);
    setProgress(0);
    setError(null);
    setIsProcessing(false);
  };

  const saveSessionToDB = async () => {
    if (!file || chunks.length === 0) return;
    setIsSavingSession(true);
    try {
      const meta = { fileName: file.name, date: Date.now() };
      await set('pdf-helper-saved-session-meta', meta);
      await set('pdf-helper-saved-session-data', {
        file,
        chunks,
        totalPages,
        printSession,
        fontWarning
      });
      setSavedSessionMeta(meta);
      alert('진행 상황이 안전하게 저장되었습니다. 나중에 브라우저를 다시 열어도 이어서 작업할 수 있습니다.');
    } catch (err) {
      console.error('Failed to save session', err);
      alert('저장 중 오류가 발생했습니다. 브라우저 저장소 용량이 부족할 수 있습니다.');
    } finally {
      setIsSavingSession(false);
    }
  };

  const loadSessionFromDB = async () => {
    setIsLoadingSession(true);
    try {
      const data = await get('pdf-helper-saved-session-data');
      if (data) {
        setFile(data.file);
        setChunks(data.chunks);
        setTotalPages(data.totalPages);
        setPrintSession(data.printSession);
        setFontWarning(data.fontWarning || false);
      } else {
        alert('저장된 세션 데이터를 찾을 수 없습니다.');
        setSavedSessionMeta(null);
        await del('pdf-helper-saved-session-meta');
      }
    } catch (err) {
      console.error('Failed to load session', err);
      alert('세션을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoadingSession(false);
    }
  };

  const clearSavedSessionDB = async () => {
    await del('pdf-helper-saved-session-meta');
    await del('pdf-helper-saved-session-data');
    setSavedSessionMeta(null);
  };

  const handleDownload = (chunkId: string) => {
    const chunk = chunks.find(c => c.id === chunkId);
    if (!chunk) return;

    const url = URL.createObjectURL(chunk.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name.replace('.pdf', '')}_pages_${chunk.start}-${chunk.end}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setChunks([]);
    setProgress(0);
    setError(null);
    setTotalPages(null);
  };

  const Tooltip = ({ text }: { text: string }) => (
    <div className="group relative inline-block ml-1.5">
      <HelpCircle className="w-3.5 h-3.5 text-gray-400 cursor-help hover:text-[#0067C0] transition-colors" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2 bg-gray-900 text-white text-[11px] rounded-lg shadow-xl z-50 leading-relaxed font-normal">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-gray-900"></div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Title Bar */}
      <div className="h-12 bg-white/80 backdrop-blur-xl flex items-center justify-between px-4 border-b border-gray-200/50 sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-2">
          <Printer className="w-5 h-5 text-[#0067C0]" />
          <h1 className="text-sm font-semibold text-gray-800">대용량 PDF 인쇄 도우미 (Windows 11)</h1>
          <button
            onClick={() => setShowPatchNotes(true)}
            className="px-2 py-0.5 text-[11px] font-bold text-[#0067C0] bg-blue-50 border border-blue-200/80 rounded-full hover:bg-blue-100 transition-colors flex items-center gap-1 cursor-pointer"
            title={`현재 버전 (v${currentVersion}) - 클릭 시 패치노트 확인`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse"></span>
            <span>v{currentVersion}</span>
          </button>
          {updateAvailable && (
            <button
              onClick={() => setUpdateAvailable(true)}
              className="px-2.5 py-0.5 text-[11px] font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 rounded-full hover:brightness-110 transition-all flex items-center gap-1 shadow-sm animate-bounce cursor-pointer"
              title="새로운 GitHub 릴리스가 있습니다! 클릭하여 업데이트"
            >
              <Sparkles className="w-3 h-3" />
              <span>새 업데이트 v{latestRelease?.version}</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              if (updateAvailable) {
                setUpdateAvailable(true);
              } else {
                setShowManualUpdateModal(true);
                checkForUpdates(true);
              }
            }}
            className={cn(
              "p-1.5 rounded-md transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer",
              updateAvailable 
                ? "bg-amber-100 text-amber-900 font-bold hover:bg-amber-200" 
                : "hover:bg-gray-100 text-gray-600"
            )}
            title="GitHub Releases 기반 실시간 업데이트 확인"
          >
            <Sparkles className={cn("w-4 h-4", updateAvailable ? "text-amber-600 animate-spin" : "text-[#0067C0]")} />
            <span>{updateAvailable ? "업데이트 알림" : "업데이트 확인"}</span>
          </button>
          <button 
            onClick={() => setShowPatchNotes(true)}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600 transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer"
            title="버전 정보 및 패치 노트 확인"
          >
            <Info className="w-4 h-4 text-[#0067C0]" />
            <span>패치노트</span>
          </button>
          <button 
            onClick={() => setShowLogsModal(true)}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600 transition-colors flex items-center gap-1.5 text-xs font-medium"
          >
            <History className="w-4 h-4" />
            <span>인쇄 로그</span>
          </button>
          {deferredPrompt && (
            <button 
              onClick={handleInstallClick}
              className="p-1.5 px-3 rounded-md bg-[#0067C0] hover:bg-[#005A9E] text-white transition-colors flex items-center gap-1.5 text-xs font-medium shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>앱 설치하기</span>
            </button>
          )}
          <button 
            onClick={() => setShowGuide(true)}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-600 transition-colors flex items-center gap-1.5 text-xs font-medium"
          >
            <HelpCircle className="w-4 h-4" />
            <span>사용 가이드</span>
          </button>
        </div>
      </div>

      <main className="flex-1 max-w-4xl w-full mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900">문서 분할 인쇄</h2>
          <p className="text-sm text-gray-500">5000페이지 이상의 대용량 PDF를 안정적으로 인쇄하기 위해 문서를 분할합니다.</p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start shadow-sm"
          >
            <AlertCircle className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">{error}</div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* Upload Area */}
        {!file ? (
          <div className="space-y-6">
            {savedSessionMeta && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-blue-50 border border-blue-200 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4"
              >
                <div>
                  <h3 className="text-lg font-semibold text-blue-900 mb-1 flex items-center">
                    <History className="w-5 h-5 mr-2" />
                    이전 작업 이어서 하기
                  </h3>
                  <p className="text-sm text-blue-700">
                    <strong>{savedSessionMeta.fileName}</strong> 파일의 분할 및 인쇄 진행 상황이 저장되어 있습니다.
                    <br className="hidden sm:block" />
                    <span className="text-xs opacity-80">저장 일시: {new Date(savedSessionMeta.date).toLocaleString()}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button 
                    onClick={loadSessionFromDB}
                    disabled={isLoadingSession}
                    className="flex-1 sm:flex-none px-4 py-2 bg-[#0067C0] hover:bg-[#005A9E] text-white rounded-xl font-medium transition-colors disabled:opacity-50"
                  >
                    {isLoadingSession ? '불러오는 중...' : '이어서 작업하기'}
                  </button>
                  <button 
                    onClick={clearSavedSessionDB}
                    className="p-2 text-blue-400 hover:text-red-500 hover:bg-white/50 rounded-xl transition-colors"
                    title="저장된 기록 삭제"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            )}
            
            <div 
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="border-2 border-dashed border-gray-300 rounded-2xl bg-white/50 backdrop-blur-md p-12 text-center hover:bg-white/80 transition-colors cursor-pointer shadow-sm group"
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="application/pdf" 
                className="hidden" 
              />
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-105 transition-transform">
                <UploadCloud className="w-8 h-8 text-[#0067C0]" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">PDF 파일 업로드</h3>
              <p className="text-sm text-gray-500">클릭하거나 파일을 이곳으로 드래그하세요</p>
            </div>
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white/70 backdrop-blur-xl border border-gray-200/60 rounded-2xl p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center shrink-0">
                  <FileText className="w-6 h-6 text-red-500" />
                </div>
                <div className="overflow-hidden">
                  <h3 className="text-base font-medium text-gray-900 truncate">{file.name}</h3>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                    {totalPages !== null && ` • 총 ${totalPages}페이지`}
                  </p>
                </div>
              </div>
              {!isProcessing && chunks.length === 0 && (
                <button 
                  onClick={reset}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="파일 삭제"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
            </div>

            {chunks.length === 0 && (
              <div className="space-y-6">
                
                {totalPages === 1 ? (
                  <div className="bg-blue-50/50 rounded-xl p-6 border border-blue-100 text-center">
                    <FileText className="w-8 h-8 text-[#0067C0] mx-auto mb-3" />
                    <h4 className="text-base font-medium text-gray-900 mb-1">단일 페이지 문서입니다</h4>
                    <p className="text-sm text-gray-500">이 문서는 1장으로 구성되어 있어 분할이 필요하지 않습니다. 바로 인쇄를 준비합니다.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Chunk Size */}
                    <div className="bg-gray-50/50 rounded-xl p-4 border border-gray-100 col-span-1 md:col-span-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <label className="text-sm font-medium text-gray-700 flex items-center">
                            <Settings className="w-4 h-4 mr-2 text-gray-400" />
                            분할 단위 (페이지)
                            <Tooltip text="문서가 너무 크면 인쇄 중 메모리 오류가 발생할 수 있습니다. 문서를 지정한 페이지 단위로 나누어 순차적으로 인쇄합니다." />
                          </label>
                          {recommendedPagesPerChunk && (
                            <button
                              onClick={() => setPagesPerChunk(recommendedPagesPerChunk)}
                              className="text-[10px] font-medium bg-blue-100 text-[#0067C0] px-2 py-0.5 rounded hover:bg-blue-200 transition-colors"
                              title="파일 용량을 분석하여 메모리 부족을 방지하는 최적의 분할 단위를 추천합니다."
                            >
                              권장: {recommendedPagesPerChunk}장 적용
                            </button>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-[#0067C0]">{pagesPerChunk}장</span>
                      </div>
                      <input 
                        type="range" 
                        min="10" 
                        max="1000" 
                        step="10"
                        value={pagesPerChunk} 
                        onChange={(e) => setPagesPerChunk(Number(e.target.value))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#0067C0]"
                        disabled={isProcessing}
                      />
                      <div className="flex justify-between text-xs text-gray-400 mt-2">
                        <span>10장</span>
                        <span>{recommendedPagesPerChunk ? `권장: ${recommendedPagesPerChunk}장` : '권장: 200장'}</span>
                        <span>1000장</span>
                      </div>
                    </div>

                    {/* Print Range */}
                    <div className="bg-gray-50/50 rounded-xl p-4 border border-gray-100 space-y-3">
                      <label className="text-sm font-medium text-gray-700 flex items-center">
                        <SlidersHorizontal className="w-4 h-4 mr-2 text-gray-400" />
                        인쇄 범위
                        <Tooltip text="인쇄할 페이지 범위를 선택합니다. 특정 구간만 인쇄하려면 '직접 지정'을 사용하세요." />
                      </label>
                      <div className="flex space-x-4">
                        <label className="flex items-center space-x-2 text-sm cursor-pointer">
                          <input 
                            type="radio" 
                            name="range" 
                            value="all" 
                            checked={printRange === 'all'} 
                            onChange={() => setPrintRange('all')}
                            className="text-[#0067C0] focus:ring-[#0067C0]"
                          />
                          <span>모든 페이지</span>
                        </label>
                        <label className="flex items-center space-x-2 text-sm cursor-pointer">
                          <input 
                            type="radio" 
                            name="range" 
                            value="custom" 
                            checked={printRange === 'custom'} 
                            onChange={() => setPrintRange('custom')}
                            className="text-[#0067C0] focus:ring-[#0067C0]"
                          />
                          <span>직접 지정</span>
                        </label>
                      </div>
                      {printRange === 'custom' && (
                        <div className="flex items-center space-x-2 mt-2">
                          <input 
                            type="number" 
                            min="1"
                            placeholder="시작"
                            value={customRangeStart}
                            onChange={(e) => setCustomRangeStart(e.target.value)}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0]"
                          />
                          <span className="text-gray-400">-</span>
                          <input 
                            type="number" 
                            min="1"
                            placeholder="끝 (빈칸: 끝까지)"
                            value={customRangeEnd}
                            onChange={(e) => setCustomRangeEnd(e.target.value)}
                            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0]"
                          />
                        </div>
                      )}
                    </div>

                    {/* Page Filter & Order */}
                    <div className="bg-gray-50/50 rounded-xl p-4 border border-gray-100 space-y-4">
                      <div className="space-y-3">
                        <label className="text-sm font-medium text-gray-700 flex items-center">
                          <Layers className="w-4 h-4 mr-2 text-gray-400" />
                          페이지 필터
                          <Tooltip text="홀수 또는 짝수 페이지만 골라 인쇄할 수 있습니다. 수동 양면 인쇄 시 유용합니다." />
                        </label>
                        <select 
                          value={pageFilter}
                          onChange={(e) => setPageFilter(e.target.value as any)}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0] bg-white"
                        >
                          <option value="all">모두 포함</option>
                          <option value="odd">홀수 페이지만 (1, 3, 5...)</option>
                          <option value="even">짝수 페이지만 (2, 4, 6...)</option>
                        </select>
                      </div>

                      <div className="pt-2 border-t border-gray-200/60">
                        <label className="flex items-center space-x-2 text-sm cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={reverseOrder}
                            onChange={(e) => setReverseOrder(e.target.checked)}
                            className="rounded text-[#0067C0] focus:ring-[#0067C0]"
                          />
                          <ArrowDownUp className="w-4 h-4 text-gray-500" />
                          <span className="text-gray-700 font-medium">역순으로 인쇄 (마지막 페이지부터)</span>
                        </label>
                      </div>
                    </div>

                    {/* Binding Options */}
                    <div className="bg-gray-50/50 rounded-xl p-4 border border-gray-100 col-span-1 md:col-span-2">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-gray-700 flex items-center">
                          <BookOpen className="w-4 h-4 mr-2 text-gray-400" />
                          제본용 여백 (Gutter Margin)
                          <Tooltip text="책 제본 시 안쪽 여백이 부족해 글자가 가려지는 것을 방지합니다. 홀수/짝수 페이지에 맞춰 여백을 자동으로 조절합니다." />
                        </label>
                        <span className="text-sm font-semibold text-[#0067C0]">{gutterMargin} mm</span>
                      </div>
                      <div className="flex items-center space-x-4">
                        <input 
                          type="range" 
                          min="0" 
                          max="30" 
                          step="1"
                          value={gutterMargin} 
                          onChange={(e) => setGutterMargin(Number(e.target.value))}
                          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#0067C0]"
                          disabled={isProcessing}
                        />
                        <input
                          type="number"
                          min="0"
                          max="30"
                          value={gutterMargin}
                          onChange={(e) => setGutterMargin(Number(e.target.value))}
                          className="w-20 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0]"
                          disabled={isProcessing}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        종이책 제본을 위해 홀수 페이지는 오른쪽으로, 짝수 페이지는 왼쪽으로 지정한 mm만큼 내용을 이동시킵니다. (0mm = 사용 안 함)
                      </p>
                    </div>

                    {/* Slip Sheet Options */}
                    <div className="bg-gray-50/50 rounded-xl p-4 border border-gray-100 col-span-1 md:col-span-2">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium text-gray-700 flex items-center">
                          <FilePlus className="w-4 h-4 mr-2 text-gray-400" />
                          세트 구분용 간지 삽입 (Slip Sheet)
                          <Tooltip text="대량 인쇄 시 각 묶음을 쉽게 구분할 수 있도록 파일 정보가 적힌 빈 종이를 끼워 넣습니다." />
                        </label>
                      </div>
                      <div className="space-y-3">
                        <select 
                          value={slipSheet}
                          onChange={(e) => setSlipSheet(e.target.value as any)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0] bg-white"
                          disabled={isProcessing}
                        >
                          <option value="none">사용 안 함</option>
                          <option value="document_start">문서 맨 앞에 1장 삽입 (전체 세트 구분용)</option>
                          <option value="chunk_start">모든 분할 파트 맨 앞에 삽입 (파트별 대량 인쇄 구분용)</option>
                        </select>
                        
                        {slipSheet !== 'none' && (
                          <div className="space-y-4 pt-2">
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-gray-500 ml-1">간지 제목 커스텀 (비워두면 기본값 사용)</label>
                              <input 
                                type="text"
                                value={customSlipSheetText}
                                onChange={(e) => setCustomSlipSheetText(e.target.value)}
                                placeholder="예: OOO 부장님 보고용 / A세트"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0]"
                                disabled={isProcessing}
                              />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium text-gray-500 ml-1">간지 디자인</label>
                                <div className="flex gap-2">
                                  {(['minimal', 'modern', 'classic'] as const).map((design) => (
                                    <button
                                      key={design}
                                      onClick={() => setSlipSheetDesign(design)}
                                      className={cn(
                                        "flex-1 px-2 py-1.5 text-xs rounded-md border transition-all",
                                        slipSheetDesign === design 
                                          ? "bg-blue-50 border-[#0067C0] text-[#0067C0] font-bold" 
                                          : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
                                      )}
                                    >
                                      {design === 'minimal' ? '심플' : design === 'modern' ? '모던' : '클래식'}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs font-medium text-gray-500 ml-1">강조 색상</label>
                                <div className="flex items-center gap-2">
                                  {['#0067C0', '#E11D48', '#059669', '#D97706', '#7C3AED'].map((color) => (
                                    <button
                                      key={color}
                                      onClick={() => setSlipSheetAccentColor(color)}
                                      className={cn(
                                        "w-6 h-6 rounded-full border-2 transition-transform hover:scale-110",
                                        slipSheetAccentColor === color ? "border-gray-900 scale-110" : "border-transparent"
                                      )}
                                      style={{ backgroundColor: color }}
                                    />
                                  ))}
                                  <input 
                                    type="color" 
                                    value={slipSheetAccentColor}
                                    onChange={(e) => setSlipSheetAccentColor(e.target.value)}
                                    className="w-6 h-6 p-0 border-0 bg-transparent cursor-pointer"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        대량 인쇄 시 세트나 파트가 섞이지 않도록 파일명과 페이지 정보가 적힌 구분용 페이지를 자동으로 추가합니다.
                      </p>
                    </div>

                    {/* Grayscale Option for Slip Sheets */}
                    <div className="bg-gray-50/50 rounded-xl p-4 border border-gray-100 col-span-1 md:col-span-2">
                      <label className="text-sm font-medium text-gray-700 flex items-center">
                        <ArrowDownUp className="w-4 h-4 mr-2 text-gray-400" />
                        간지용 인쇄 색상 설정
                        <Tooltip text="간지(Slip Sheet)나 추가 텍스트의 색상을 설정합니다. 토너 절약을 위해 흑백 사용을 권장합니다." />
                      </label>
                      <div className="mt-3">
                        <label className="flex items-center space-x-3 cursor-pointer">
                          <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only peer"
                              checked={isGrayscale}
                              onChange={(e) => setIsGrayscale(e.target.checked)}
                              disabled={isProcessing}
                            />
                            <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#0067C0]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0067C0]"></div>
                          </div>
                          <span className="text-sm font-medium text-gray-700">흑백(Grayscale) 최적화 적용 (권장)</span>
                        </label>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        간지 및 추가 텍스트를 흑백으로 생성하여 불필요한 컬러 토너 낭비를 방지합니다. 원본 문서의 전체 흑백 인쇄는 시스템 인쇄창에서 설정해 주세요.
                      </p>
                    </div>

                    {/* Duplex Printing */}
                    <div className="bg-gray-50/50 rounded-xl p-4 border border-gray-100 col-span-1 md:col-span-2">
                      <label className="text-sm font-medium text-gray-700 flex items-center">
                        <BookOpen className="w-4 h-4 mr-2 text-gray-400" />
                        양면 인쇄 및 제본 설정
                        <Tooltip text="프린터의 하드웨어 기능을 제어합니다. 양면 인쇄 시 페이지가 밀리지 않도록 자동으로 짝을 맞춥니다." />
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                        <label className="flex items-center space-x-3 cursor-pointer">
                          <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only peer"
                              checked={isDuplex}
                              onChange={(e) => setIsDuplex(e.target.checked)}
                              disabled={isProcessing}
                            />
                            <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#0067C0]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0067C0]"></div>
                          </div>
                          <span className="text-sm font-medium text-gray-700">양면 인쇄 모드 활성화</span>
                        </label>
                        
                        {isDuplex && (
                          <div className="flex items-center space-x-2 border-l pl-4 border-gray-200">
                            <label className="text-xs text-gray-500 font-medium whitespace-nowrap">넘김 방향:</label>
                            <select 
                              value={duplexBinding}
                              onChange={(e) => setDuplexBinding(e.target.value as any)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0] bg-white"
                              disabled={isProcessing}
                            >
                              <option value="long">긴 면 넘김 (일반)</option>
                              <option value="short">짧은 면 넘김 (상단)</option>
                            </select>
                          </div>
                        )}

                        <label className="flex items-center space-x-3 cursor-pointer">
                          <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only peer"
                              checked={collate}
                              onChange={(e) => setCollate(e.target.checked)}
                              disabled={isProcessing}
                            />
                            <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#0067C0]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0067C0]"></div>
                          </div>
                          <span className="text-sm font-medium text-gray-700">한 부씩 인쇄 (Collate)</span>
                          <Tooltip text="여러 부를 인쇄할 때 1, 2, 3... 순서대로 한 세트씩 묶어서 출력합니다." />
                        </label>

                        <label className="flex items-center space-x-3 cursor-pointer">
                          <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only peer"
                              checked={staple}
                              onChange={(e) => setStaple(e.target.checked)}
                              disabled={isProcessing}
                            />
                            <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#0067C0]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0067C0]"></div>
                          </div>
                          <span className="text-sm font-medium text-gray-700">스테이플러 (Staple)</span>
                          <Tooltip text="인쇄 완료 후 자동으로 스테이플러 처리를 합니다. (프린터 하드웨어 지원 필요)" />
                        </label>

                        <label className="flex items-center space-x-3 cursor-pointer">
                          <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only peer"
                              checked={globalCollate}
                              onChange={(e) => setGlobalCollate(e.target.checked)}
                              disabled={isProcessing}
                            />
                            <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#0067C0]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0067C0]"></div>
                          </div>
                          <span className="text-sm font-medium text-gray-700">전체 세트 단위 반복 (Global Collate)</span>
                          <Tooltip text="분할된 모든 파트를 1부씩 다 뽑은 후, 다음 부수를 처음부터 다시 시작합니다. 대량 인쇄 후 세트 분류가 필요 없습니다." />
                        </label>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        프린터의 물리적 기능을 제어합니다. '전체 세트 단위 반복'은 1부 전체를 다 뽑은 후 다음 부수를 처음부터 다시 시작합니다.
                      </p>
                    </div>

                    {/* Advanced Print Settings */}
                    <div className="bg-gray-50/50 rounded-xl p-4 border border-gray-100 col-span-1 md:col-span-2 space-y-4">
                      <label className="text-sm font-medium text-gray-700 flex items-center mb-2">
                        <Settings className="w-4 h-4 mr-2 text-gray-400" />
                        고급 인쇄 설정 (용지/방향)
                      </label>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs text-gray-500 font-medium">용지 크기</label>
                          <select 
                            value={paperSize}
                            onChange={(e) => setPaperSize(e.target.value as any)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0] bg-white"
                            disabled={isProcessing}
                          >
                            <option value="Original">원본 크기 유지</option>
                            <option value="A4">A4 (표준)</option>
                            <option value="A3">A3</option>
                            <option value="A2">A2</option>
                            <option value="A1">A1</option>
                            <option value="B4">B4</option>
                            <option value="Letter">Letter</option>
                            <option value="Plotter24">플로터 롤 (24인치)</option>
                            <option value="Plotter36">플로터 롤 (36인치)</option>
                          </select>
                        </div>
                        
                        <div className="space-y-2">
                          <label className="text-xs text-gray-500 font-medium">용지 방향</label>
                          <select 
                            value={orientation}
                            onChange={(e) => setOrientation(e.target.value as any)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0] bg-white"
                            disabled={isProcessing}
                          >
                            <option value="auto">자동 (원본 비율에 맞춤)</option>
                            <option value="portrait">세로 (Portrait)</option>
                            <option value="landscape">가로 (Landscape)</option>
                          </select>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        * 용지 크기나 방향을 변경하면 원본 페이지가 새 용지에 맞춰 자동으로 축소/확대됩니다.
                      </p>
                    </div>
                  </div>
                )}

                {isProcessing ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 font-medium">문서 처리 및 분할 중...</span>
                      <span className="text-[#0067C0] font-medium">{progress}%</span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-[#0067C0]"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.1 }}
                      />
                    </div>
                  </div>
                ) : (
                  <button 
                    onClick={processPdf}
                    className="w-full py-3 bg-[#0067C0] hover:bg-[#005A9E] text-white rounded-xl font-medium transition-colors flex items-center justify-center shadow-sm"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    {totalPages === 1 ? '인쇄 준비하기' : '옵션 적용 및 분할 시작'}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* Chunks List */}
        {chunks.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                {totalPages === 1 ? '인쇄 준비 완료' : `분할된 문서 (${chunks.length}개)`}
              </h3>
              <div className="flex items-center space-x-3">
                {navigator.userAgent.toLowerCase().includes('electron') && (
                  <button
                    onClick={openLogFolder}
                    className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center shadow-sm border bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    title="인쇄 로그 폴더 열기"
                  >
                    <FileText className="w-4 h-4 mr-1.5" />
                    로그 보기
                  </button>
                )}
                <button
                  onClick={goBackToSettings}
                  className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center shadow-sm border bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                >
                  <ChevronLeft className="w-4 h-4 mr-1.5" />
                  설정으로 돌아가기
                </button>
                <button
                  onClick={saveSessionToDB}
                  disabled={isSavingSession}
                  className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center shadow-sm border bg-white text-gray-700 border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  <History className="w-4 h-4 mr-1.5" />
                  {isSavingSession ? '저장 중...' : '진행 상황 저장'}
                </button>
                {chunks.length > 1 && (
                  <div className="flex items-center gap-2">
                    {autoPrintQueue.length > 0 && !isAutoPrinting && (
                      <button 
                        onClick={resumeAutoPrint}
                        className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center shadow-sm border bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                      >
                        <Play className="w-4 h-4 mr-1.5" />
                        이어서 인쇄
                      </button>
                    )}
                    <button 
                      onClick={isAutoPrinting ? pauseAutoPrint : startAutoPrint}
                      className={cn(
                        "text-sm px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center shadow-sm border",
                        isAutoPrinting 
                          ? "bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100" 
                          : "bg-blue-50 text-[#0067C0] border-blue-200 hover:bg-blue-100"
                      )}
                    >
                      {isAutoPrinting ? (
                        <>
                          <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse mr-2"></div>
                          일시 정지
                        </>
                      ) : (
                        <>
                          <Printer className="w-4 h-4 mr-1.5" />
                          {autoPrintQueue.length > 0 ? '처음부터 인쇄' : '자동 연속 인쇄'}
                        </>
                      )}
                    </button>
                    {autoPrintQueue.length > 0 && (
                      <button 
                        onClick={stopAutoPrint}
                        className="text-sm px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center shadow-sm border bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                      >
                        <X className="w-4 h-4 mr-1.5" />
                        중지
                      </button>
                    )}
                  </div>
                )}
                <button 
                  onClick={reset}
                  className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                  새로 시작
                </button>
              </div>
            </div>

            {printSession && (
              <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200/60 mb-6 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <History className="w-5 h-5 text-[#0067C0]" />
                    <h3 className="font-semibold text-gray-800">작업 진행률 추적기 (Session Tracker)</h3>
                  </div>
                  <button 
                    onClick={resetSession}
                    className="text-sm text-gray-500 hover:text-red-600 flex items-center transition-colors"
                  >
                    <RotateCcw className="w-4 h-4 mr-1" />
                    진행률 초기화
                  </button>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-[#0067C0] h-2.5 rounded-full transition-all duration-500" 
                      style={{ width: `${(printSession.printedChunkIds.length / chunks.length) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    {printSession.printedChunkIds.length} / {chunks.length} 파트 완료
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  동일한 파일을 다시 업로드하면 이전 인쇄 기록이 자동으로 복원됩니다. (마지막 업데이트: {new Date(printSession.lastUpdated).toLocaleString()})
                </p>
              </div>
            )}

            {/* Print Options (Copies, Dialog, Quality) */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-200/60 mb-6 space-y-5">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <div className="flex items-center space-x-2">
                  <Settings className="w-5 h-5 text-gray-500" />
                  <h3 className="font-semibold text-gray-800">인쇄 실행 옵션</h3>
                </div>
                <button 
                  onClick={handleResetSettings}
                  disabled={isAutoPrinting}
                  className="text-xs text-gray-500 hover:text-[#0067C0] flex items-center gap-1 transition-colors disabled:opacity-50"
                  title="모든 설정을 기본값으로 되돌립니다"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  설정 초기화
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Printer Selection (Electron Only) */}
                {printers.length > 0 && (
                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 flex items-center">
                        <Printer className="w-4 h-4 mr-1.5 text-gray-400" />
                        대상 프린터
                      </label>
                      <div className="flex items-center gap-3">
                        {selectedPrinter && (
                          <div className={cn(
                            "printer-status-indicator group relative flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-all cursor-help",
                            showRecoveryHighlight 
                              ? "bg-green-50 border border-green-500 ring-4 ring-green-500/30 scale-105 shadow-md shadow-green-100" 
                              : "bg-gray-50 border border-gray-100 hover:bg-gray-100/50 hover:border-gray-200"
                          )}>
                            {(() => {
                              const p = printers.find(pr => pr.deviceId === selectedPrinter);
                              const isOnline = p?.status !== 9 && p?.status !== 3;
                              const diagnosis = getPrinterStatusDiagnosis(p?.status, p?.statusText);
                              return (
                                <>
                                  <div className={cn(
                                    "w-2 h-2 rounded-full",
                                    isOnline ? "bg-green-500" : "bg-red-500 animate-pulse",
                                    showRecoveryHighlight && "animate-ping"
                                  )} />
                                  <span className={cn(
                                    "text-[10px] font-bold uppercase",
                                    isOnline ? "text-green-600" : "text-red-600"
                                  )}>
                                    {p?.statusText || (isOnline ? '연결됨' : '오프라인')}
                                  </span>

                                  {/* Error/Status Diagnosis Tooltip */}
                                  <div className="absolute right-0 bottom-full mb-2 w-72 p-3 bg-white rounded-xl shadow-xl border border-gray-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 text-left pointer-events-none">
                                    <div className={cn(
                                      "absolute top-0 left-0 right-0 h-1 rounded-t-xl",
                                      diagnosis.severity === 'success' ? 'bg-green-500' : diagnosis.severity === 'warning' ? 'bg-amber-500' : 'bg-red-500'
                                    )} />
                                    <div className="flex items-center gap-2 mb-1.5 mt-1">
                                      <div className={cn(
                                        "w-2 h-2 rounded-full",
                                        diagnosis.severity === 'success' ? 'bg-green-500' : diagnosis.severity === 'warning' ? 'bg-amber-500' : 'bg-red-500 animate-pulse'
                                      )} />
                                      <h4 className="text-xs font-bold text-gray-800">{diagnosis.title}</h4>
                                    </div>
                                    <p className="text-[11px] text-gray-500 mb-2 leading-relaxed">{diagnosis.meaning}</p>
                                    
                                    {diagnosis.actions.length > 0 && (
                                      <div className="border-t border-gray-100 pt-2 mt-2">
                                        <h5 className="text-[10px] font-bold text-gray-700 mb-1">권장 조치 사항:</h5>
                                        <ul className="space-y-1 text-[10px] text-gray-600 list-disc pl-3">
                                          {diagnosis.actions.map((act, i) => (
                                            <li key={i} className="leading-relaxed">{act}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>

                                  {!isOnline && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowTroubleshootingGuide(true);
                                      }}
                                      className="ml-1 p-0.5 text-red-400 hover:text-red-600 transition-colors"
                                      title="프린터 문제 해결 가이드 보기"
                                    >
                                      <HelpCircle className="w-3 h-3" />
                                    </button>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}
                        {lastCheckedTime && (
                          <span className="text-[10px] text-gray-400 font-mono shrink-0">
                            최근 확인: {lastCheckedTime.toLocaleTimeString('ko-KR', { hour12: false })}
                          </span>
                        )}
                        <button 
                          onClick={fetchPrinters}
                          disabled={isRefreshingPrinters}
                          className="p-1 text-gray-400 hover:text-[#0067C0] hover:bg-blue-50 rounded-md transition-all disabled:opacity-50"
                          title="프린터 목록 새로고침"
                        >
                          <RotateCcw className={cn("w-3.5 h-3.5", isRefreshingPrinters && "animate-spin")} />
                        </button>
                      </div>
                    </div>
                    <div className="relative" ref={printerDropdownRef}>
                      <button
                        type="button"
                        onClick={() => !isAutoPrinting && setShowPrinterDropdown(!showPrinterDropdown)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0] transition-all",
                          isAutoPrinting && "opacity-50 cursor-not-allowed bg-gray-50"
                        )}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          {(() => {
                            const p = printers.find(pr => pr.deviceId === selectedPrinter);
                            if (!selectedPrinter || !p) return <span className="truncate">기본 프린터 (Default Printer)</span>;
                            const isOnline = p.status !== 9 && p.status !== 3;
                            return (
                              <>
                                {isOnline ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 shrink-0" />}
                                <span className="truncate font-medium">{p.name}</span>
                              </>
                            );
                          })()}
                        </div>
                        <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform duration-200", showPrinterDropdown && "rotate-180")} />
                      </button>

                      <AnimatePresence>
                        {showPrinterDropdown && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto py-1"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPrinter('');
                                setShowPrinterDropdown(false);
                              }}
                              className={cn(
                                "w-full flex items-center px-3 py-2 text-sm hover:bg-gray-50 transition-colors",
                                selectedPrinter === '' && "bg-blue-50 text-[#0067C0] font-medium"
                              )}
                            >
                              기본 프린터 (Default Printer)
                            </button>
                            <div className="h-px bg-gray-100 my-1" />
                            {printers.map(p => {
                              const isOnline = p.status !== 9 && p.status !== 3;
                              const isSelected = selectedPrinter === p.deviceId;
                              return (
                                <button
                                  key={p.deviceId}
                                  type="button"
                                  onClick={() => {
                                    setSelectedPrinter(p.deviceId);
                                    setShowPrinterDropdown(false);
                                  }}
                                  className={cn(
                                    "w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-gray-50 transition-colors group",
                                    isSelected && "bg-blue-50 text-[#0067C0] font-medium"
                                  )}
                                >
                                  <div className="flex items-center gap-2.5 overflow-hidden">
                                    <div className="shrink-0">
                                      {isOnline ? (
                                        <div className="bg-green-100 p-1 rounded-full">
                                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                                        </div>
                                      ) : (
                                        <div className="bg-red-100 p-1 rounded-full">
                                          <XCircle className="w-3.5 h-3.5 text-red-600" />
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex flex-col items-start overflow-hidden">
                                      <span className="truncate w-full">{p.name}</span>
                                      <span className={cn(
                                        "text-[10px] uppercase tracking-wider font-bold",
                                        isOnline ? "text-green-500" : "text-red-400"
                                      )}>
                                        {p.statusText || (isOnline ? 'Online' : 'Offline')}
                                      </span>
                                    </div>
                                  </div>
                                  {!isOnline && (
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowTroubleshootingGuide(true);
                                      }}
                                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                                      title="문제 해결 가이드"
                                    >
                                      <HelpCircle className="w-4 h-4" />
                                    </div>
                                  )}
                                  {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[#0067C0]" />}
                                </button>
                              );
                            })}
                            {lastCheckedTime && (
                              <div className="text-[10px] text-gray-500 px-3 py-2 bg-gray-50 flex items-center justify-between font-mono border-t border-gray-100 mt-1 sticky bottom-0">
                                <span className="text-gray-400">확인: {lastCheckedTime.toLocaleTimeString('ko-KR', { hour12: false })}</span>
                                <label className="flex items-center gap-1.5 cursor-pointer select-none text-gray-500 hover:text-gray-700 transition-colors">
                                  <input 
                                    type="checkbox" 
                                    checked={enableBrowserNotifications} 
                                    onChange={(e) => {
                                      setEnableBrowserNotifications(e.target.checked);
                                      if (e.target.checked && 'Notification' in window) {
                                        Notification.requestPermission().then(perm => {
                                          if (perm === 'granted') {
                                            new Notification('알림 활성화 완료', {
                                              body: '프린터가 오프라인에서 복구되면 바탕화면 알림을 보내 드립니다.',
                                              icon: '/favicon.ico'
                                            });
                                          }
                                        });
                                      }
                                    }}
                                    className="rounded border-gray-300 text-[#0067C0] focus:ring-[#0067C0] w-3 h-3 cursor-pointer" 
                                  />
                                  <span>상태 복구 알림</span>
                                </label>
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="flex items-start gap-1.5 mt-2">
                      <HelpCircle className="w-3.5 h-3.5 text-gray-400 mt-0.5" />
                      <p className="text-xs text-gray-500 leading-relaxed">
                        프린터가 목록에 없거나 '오프라인'인 경우, 전원과 케이블 연결을 확인한 후 새로고침 버튼을 눌러주세요.
                      </p>
                    </div>
                  </div>
                )}

                {/* Copies */}
                <div>
                  <label className="text-sm font-medium text-gray-700 flex items-center mb-2">
                    <Printer className="w-4 h-4 mr-1.5 text-gray-400" />
                    인쇄 부수
                  </label>
                  <div className="flex items-center space-x-2">
                    <input 
                      type="number" 
                      min="1"
                      max="100"
                      value={copies} 
                      onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#0067C0] focus:border-[#0067C0] outline-none"
                      disabled={isAutoPrinting}
                    />
                    <span className="text-sm text-gray-700 font-medium">부</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    각 파트별로 인쇄할 부수를 설정합니다.
                  </p>
                </div>

                {/* Print Quality & Color Management */}
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center mb-2">
                      <SlidersHorizontal className="w-4 h-4 mr-1.5 text-gray-400" />
                      인쇄 품질
                    </label>
                    <select 
                      value={printQuality}
                      onChange={(e) => setPrintQuality(e.target.value as any)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0]"
                      disabled={isAutoPrinting}
                    >
                      <option value="standard">표준 (Standard)</option>
                      <option value="high">고품질 (High Quality)</option>
                      <option value="draft">초안/잉크 절약 (Draft)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700 flex items-center mb-2">
                      <Palette className="w-4 h-4 mr-1.5 text-gray-400" />
                      색상 관리
                      <Tooltip text="인쇄 시 색상 프로필을 프린터 드라이버에서 처리할지, 애플리케이션에서 직접 처리할지 선택합니다." />
                    </label>
                    <select 
                      value={colorManagement}
                      onChange={(e) => setColorManagement(e.target.value as any)}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#0067C0]/20 focus:border-[#0067C0]"
                      disabled={isAutoPrinting}
                    >
                      <option value="driver">프린터 드라이버에서 관리</option>
                      <option value="app">애플리케이션에서 관리</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Web Environment Notice */}
              {printers.length === 0 && (
                <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100 flex items-start gap-3">
                  <Info className="w-4 h-4 text-[#0067C0] mt-0.5 shrink-0" />
                  <div className="text-xs text-blue-800 leading-relaxed">
                    <p className="font-semibold mb-1">웹 브라우저 환경 안내</p>
                    <p>보안 정책상 웹 브라우저에서는 프린터 목록을 직접 가져오거나 상태를 확인할 수 없습니다. 인쇄 버튼을 누르면 나타나는 시스템 인쇄창에서 프린터를 선택해 주세요.</p>
                  </div>
                </div>
              )}

              {/* Auto Print Workflow */}
              <div className="pt-3 border-t border-gray-100">
                <label className="flex items-start space-x-3 cursor-pointer group">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      checked={showPrintDialog}
                      onChange={(e) => setShowPrintDialog(e.target.checked)}
                      className="w-4 h-4 text-[#0067C0] border-gray-300 rounded focus:ring-[#0067C0]"
                      disabled={isAutoPrinting}
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900">시스템 인쇄 대화상자 표시</span>
                    <span className="text-xs text-gray-500 mt-0.5">
                      인쇄 시 브라우저/시스템의 인쇄 설정 창을 보여줍니다. (자동 연속 인쇄 시에는 끄는 것을 권장합니다)
                    </span>
                  </div>
                </label>
                
                {!showPrintDialog && (
                  <div className="bg-amber-50 rounded-lg p-3 border border-amber-100 ml-7 mt-3">
                    <p className="text-xs text-amber-800 flex items-start">
                      <AlertTriangle className="w-3.5 h-3.5 mr-1.5 mt-0.5 flex-shrink-0" />
                      <span>
                        웹 브라우저 환경에서 완벽한 무인 자동 인쇄를 위해서는 크롬/엣지 바로가기 속성에 <code className="bg-gray-200 px-1 rounded">--kiosk-printing</code> 옵션이 필요합니다. (Electron 데스크톱 앱 사용 시 불필요)
                      </span>
                    </p>
                    <button 
                      onClick={() => setShowKioskGuide(true)}
                      className="text-xs text-[#0067C0] hover:underline mt-1.5 ml-5 font-medium"
                    >
                      완전 무인 자동 인쇄 설정법 보기
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Font Warning */}
            {fontWarning && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <span className="font-semibold block mb-1">글꼴(폰트) 포함 오류 감지됨</span>
                  이 PDF 파일에는 <strong>포함되지 않은(임베딩되지 않은) 특수 폰트</strong>가 사용되었습니다. 
                  인쇄 시 해당 폰트가 기기에 없으면 맑은 고딕 등 기본 폰트로 깨져서 출력될 수 있습니다. 
                  <br className="hidden sm:block" />
                  <span className="text-amber-700/80 text-xs mt-1 block">
                    (해결 방법: 원본 문서를 만든 프로그램(워드, 한글 등)에서 PDF로 저장할 때 '모든 글꼴 포함' 옵션을 체크하고 다시 저장하세요.)
                  </span>
                </div>
              </div>
            )}

            {/* Ad Placeholder 1: Above the chunk list */}
            <div className="mb-6">
              <AdPlaceholder className="h-28" />
            </div>

            {/* Mobile Notice */}
            <div className="md:hidden bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4 flex items-start gap-3">
              <Smartphone className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <span className="font-semibold block mb-0.5">모바일 기기 사용 안내</span>
                모바일에서는 브라우저 제한으로 [인쇄] 버튼이 작동하지 않을 수 있습니다. <strong>[다운로드]</strong> 버튼을 눌러 파일 앱에 저장한 후 직접 인쇄하는 것을 권장합니다.
              </div>
            </div>

            <div className="grid gap-3">
              <AnimatePresence>
                {chunks.map((chunk, index) => (
                  <motion.div 
                    key={chunk.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={cn(
                      "bg-white/70 backdrop-blur-xl border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between shadow-sm transition-all hover:shadow-md gap-4",
                      chunk.failed ? "border-red-300 bg-red-50/30" : chunk.printed ? "border-green-200 bg-green-50/30" : "border-gray-200/60"
                    )}
                  >
                    <div className="flex items-center space-x-4">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                        chunk.failed ? "bg-red-100" : chunk.printed ? "bg-green-100" : "bg-blue-50"
                      )}>
                        {chunk.failed ? (
                          <AlertTriangle className="w-5 h-5 text-red-600" />
                        ) : chunk.printed ? (
                          <CheckCircle className="w-5 h-5 text-green-600" />
                        ) : (
                          <FileText className="w-5 h-5 text-[#0067C0]" />
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                          {totalPages === 1 ? '문서 인쇄' : `파트 ${index + 1}`}
                          {chunk.failed && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">실패</span>}
                        </h4>
                        <p className="text-xs text-gray-500">
                          {totalPages === 1 
                            ? '1 페이지' 
                            : (reverseOrder ? `${chunk.start} ~ ${chunk.end} (역순)` : `${chunk.start} ~ ${chunk.end} 페이지`)} 
                          <span className="ml-2 text-gray-400">({(chunk.blob.size / 1024 / 1024).toFixed(2)} MB)</span>
                        </p>
                        {chunk.failed && chunk.errorMessage && (() => {
                          const errorInfo = getFriendlyErrorMessage(chunk.errorMessage);
                          return (
                            <div className="mt-2 bg-red-50 border border-red-100 rounded-md p-2.5 max-w-md">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-sm font-semibold text-red-800">{errorInfo.title}</p>
                                  <p className="text-xs text-red-600 mt-0.5">{errorInfo.description}</p>
                                  <ul className="mt-1.5 space-y-1">
                                    {errorInfo.solutions.map((solution, i) => (
                                      <li key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                                        <span className="text-red-400 mt-0.5">•</span>
                                        <span>{solution}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 self-end sm:self-auto">
                      <button 
                        onClick={() => {
                          setPreviewChunkId(chunk.id);
                          setPreviewPageNumber(1);
                          setPreviewNumPages(null);
                        }}
                        className="p-2 text-gray-500 hover:text-[#0067C0] hover:bg-blue-50 rounded-lg transition-colors"
                        title="미리보기"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDownload(chunk.id)}
                        className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                        title="다운로드"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      {chunk.failed ? (
                        <button 
                          onClick={() => retryPrint(chunk.id)}
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center bg-red-100 text-red-700 hover:bg-red-200"
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          다시 시도
                        </button>
                      ) : (
                        <button 
                          onClick={() => handlePrint(chunk.id)}
                          className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center",
                            chunk.printed 
                              ? "bg-green-100 text-green-700 hover:bg-green-200" 
                              : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                          )}
                        >
                          <Printer className="w-4 h-4 mr-2" />
                          {chunk.printed ? '다시 인쇄' : '인쇄'}
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* Ad Placeholder 2: Bottom of the main content */}
        <div className="mt-8 pt-8 border-t border-gray-200/50">
          <AdPlaceholder className="h-24" />
        </div>
      </main>

      {/* Logs Modal */}
      <AnimatePresence>
        {showLogsModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
            onClick={() => setShowLogsModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-3xl max-h-[80vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-2 text-gray-800 font-semibold">
                  <History className="w-5 h-5 text-[#0067C0]" />
                  <h3>인쇄 작업 로그</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      if (window.confirm('모든 로그를 삭제하시겠습니까?')) {
                        setAppLogs([]);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    로그 지우기
                  </button>
                  <button 
                    onClick={() => setShowLogsModal(false)}
                    className="p-1.5 rounded-full hover:bg-gray-200/50 text-gray-500 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                {appLogs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400">
                    <History className="w-12 h-12 mb-3 opacity-20" />
                    <p>기록된 인쇄 로그가 없습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {appLogs.map(log => (
                      <div 
                        key={log.id} 
                        className={cn(
                          "p-3 rounded-lg text-sm border flex items-start gap-3",
                          log.type === 'SUCCESS' ? "bg-green-50 border-green-100 text-green-800" :
                          log.type === 'ERROR' ? "bg-red-50 border-red-100 text-red-800" :
                          "bg-white border-gray-200 text-gray-700"
                        )}
                      >
                        <div className="mt-0.5">
                          {log.type === 'SUCCESS' ? <CheckCircle className="w-4 h-4 text-green-500" /> :
                           log.type === 'ERROR' ? <AlertCircle className="w-4 h-4 text-red-500" /> :
                           <Settings className="w-4 h-4 text-gray-400" />}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium mb-1">{log.message}</p>
                          <p className="text-xs opacity-60">
                            {new Date(log.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Guide Modal */}
      <AnimatePresence>
        {showGuide && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
            onClick={() => setShowGuide(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white/90 backdrop-blur-xl w-full max-w-lg rounded-2xl shadow-2xl border border-white/20 overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-200/50 bg-white/50">
                <div className="flex items-center gap-2 text-gray-900 font-semibold">
                  <HelpCircle className="w-5 h-5 text-[#0067C0]" />
                  <h3>웹 브라우저 인쇄 권장 가이드</h3>
                </div>
                <button 
                  onClick={() => setShowGuide(false)}
                  className="p-1.5 rounded-full hover:bg-gray-200/50 text-gray-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-5 text-sm text-gray-700 overflow-y-auto max-h-[70vh]">
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    브라우저 메모리 제한
                  </h4>
                  <p className="leading-relaxed text-gray-600">
                    16GB 이상의 고사양 PC를 사용하시더라도, 크롬(Chrome)이나 엣지(Edge) 같은 웹 브라우저는 <strong>하나의 탭에서 사용할 수 있는 메모리가 2~4GB로 제한</strong>되어 있습니다. 한 번에 너무 많은 페이지를 인쇄 창으로 넘기면 브라우저가 멈추거나 강제 종료될 수 있습니다.
                  </p>
                </div>

                <div className="space-y-3">
                  <h4 className="font-semibold text-gray-900 flex items-center gap-1.5">
                    <Settings className="w-4 h-4 text-blue-500" />
                    문서 종류별 권장 분할 단위
                  </h4>
                  
                  <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 space-y-3">
                    <div>
                      <div className="font-medium text-blue-900 mb-1">📝 일반 문서 (텍스트 위주)</div>
                      <div className="text-blue-800 font-semibold text-lg">200장 ~ 300장</div>
                      <p className="text-blue-700/80 text-xs mt-0.5">소설, 전공 서적 등 글자 위주의 문서는 200장 단위가 가장 안정적인 황금 비율입니다.</p>
                    </div>
                    
                    <div className="h-px bg-blue-200/50 w-full"></div>
                    
                    <div>
                      <div className="font-medium text-blue-900 mb-1">🖼️ 고화질 이미지, 스캔본, 만화책</div>
                      <div className="text-blue-800 font-semibold text-lg">50장 ~ 100장</div>
                      <p className="text-blue-700/80 text-xs mt-0.5">이미지 데이터는 메모리 소모가 극심하므로 잘게 분할하는 것이 안전합니다.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 flex items-start gap-2">
                  <span className="text-xl leading-none">💡</span>
                  <p>
                    <strong>Tip:</strong> [인쇄] 버튼을 눌렀을 때 하얀색 '인쇄 미리보기' 창이 너무 늦게 뜨거나 멈춘다면, 분할 단위를 더 작게 줄여서 다시 시도해 주세요.
                  </p>
                </div>

                <div className="space-y-3 pt-2 border-t border-gray-200/60">
                  <h4 className="font-semibold text-gray-900 flex items-center gap-1.5">
                    <Printer className="w-4 h-4 text-red-500" />
                    프린터 오류 발생 시 대처 방법
                  </h4>
                  <div className="bg-red-50/50 border border-red-100 rounded-xl p-4 text-gray-700 space-y-2">
                    <p className="text-xs text-red-800 mb-2">
                      종이 걸림, 잉크 부족 등 물리적인 프린터 오류는 프로그램이 자동으로 감지할 수 없습니다. 오류 발생 시 다음 순서로 복구하세요:
                    </p>
                    <ol className="list-decimal list-inside space-y-1.5 text-xs text-gray-600 ml-1">
                      <li>프린터에서 마지막으로 정상 출력된 종이의 <strong>페이지 번호를 확인</strong>합니다.</li>
                      <li>화면의 분할 리스트에서 해당 페이지가 포함된 <strong>'파트'를 찾습니다.</strong></li>
                      <li>망가진 종이를 버리고, 해당 파트의 <strong>[다시 인쇄]</strong> 버튼을 눌러 그 구간만 다시 출력합니다.</li>
                    </ol>
                  </div>
                </div>
              </div>
              
              <div className="p-4 border-t border-gray-200/50 bg-gray-50/50 flex justify-end">
                <button 
                  onClick={() => setShowGuide(false)}
                  className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  확인
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview Modal */}
      <AnimatePresence>
        {previewChunkId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setPreviewChunkId(null);
              setPreviewPageNumber(1);
              setPreviewNumPages(null);
            }}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white/90 backdrop-blur-xl w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl border border-white/20 overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-200/50 bg-white/50">
                <div className="flex items-center gap-2 text-gray-900 font-semibold">
                  <Eye className="w-5 h-5 text-[#0067C0]" />
                  <h3>문서 미리보기</h3>
                </div>
                
                {previewNumPages && (
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-1 bg-gray-100 px-2 py-1.5 rounded-lg">
                      <button 
                        onClick={() => setPreviewZoom(prev => Math.max(0.25, prev - 0.25))}
                        className="p-1.5 rounded hover:bg-white transition-colors text-gray-600"
                        title="축소"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setPreviewZoom(1)}
                        className="text-xs font-medium text-gray-600 hover:bg-white px-2 py-1 rounded transition-colors min-w-[3.5rem] text-center"
                        title="원래 크기로 (100%)"
                      >
                        {Math.round(previewZoom * 100)}%
                      </button>
                      <button 
                        onClick={() => setPreviewZoom(prev => Math.min(5, prev + 0.25))}
                        className="p-1.5 rounded hover:bg-white transition-colors text-gray-600"
                        title="확대"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-4 bg-gray-100 px-3 py-1.5 rounded-lg">
                      <button 
                        onClick={() => {
                          setPreviewPageNumber(Math.max(1, previewPageNumber - 1));
                          drawingCanvasRef.current?.clear();
                        }}
                        disabled={previewPageNumber <= 1}
                        className="p-1 rounded hover:bg-white disabled:opacity-50 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-sm font-medium text-gray-600 min-w-[3rem] text-center">
                        {previewPageNumber} / {previewNumPages}
                      </span>
                      <button 
                        onClick={() => {
                          setPreviewPageNumber(Math.min(previewNumPages, previewPageNumber + 1));
                          drawingCanvasRef.current?.clear();
                        }}
                        disabled={previewPageNumber >= previewNumPages}
                        className="p-1 rounded hover:bg-white disabled:opacity-50 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Drawing Tools */}
                    <div className="flex items-center gap-2 bg-gray-100 px-2 py-1.5 rounded-lg">
                      <button
                        onClick={() => setIsDrawingMode(!isDrawingMode)}
                        className={cn("p-1.5 rounded transition-colors", isDrawingMode ? "bg-[#0067C0] text-white" : "hover:bg-white text-gray-600")}
                        title="그리기 모드"
                      >
                        <Pen className="w-4 h-4" />
                      </button>
                      
                      {isDrawingMode && (
                        <>
                          <input 
                            type="color" 
                            value={drawColor} 
                            onChange={(e) => setDrawColor(e.target.value)}
                            className="w-6 h-6 p-0 border-0 bg-transparent cursor-pointer"
                            title="색상 선택"
                          />
                          <select 
                            value={drawLineWidth} 
                            onChange={(e) => setDrawLineWidth(Number(e.target.value))}
                            className="text-xs border-gray-300 rounded focus:ring-[#0067C0]"
                          >
                            <option value={1}>얇게</option>
                            <option value={3}>보통</option>
                            <option value={5}>굵게</option>
                          </select>
                          <button
                            onClick={() => drawingCanvasRef.current?.clear()}
                            className="p-1.5 rounded hover:bg-white text-gray-600 transition-colors"
                            title="지우기"
                          >
                            <Eraser className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleSaveAnnotations}
                            className="p-1.5 rounded hover:bg-green-100 text-green-600 transition-colors"
                            title="주석 저장"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <button 
                  onClick={() => {
                    setPreviewChunkId(null);
                    setPreviewPageNumber(1);
                    setPreviewNumPages(null);
                    setPreviewZoom(1);
                  }}
                  className="p-1.5 rounded-full hover:bg-gray-200/50 text-gray-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="flex-1 bg-gray-100/50 p-4 overflow-auto flex justify-center">
                {(() => {
                  const chunk = chunks.find(c => c.id === previewChunkId);
                  if (!chunk) return null;
                  
                  return (
                    <div className={cn("flex flex-col items-center", isGrayscale && "grayscale")}>
                      <Document
                        file={chunk.blob}
                        onLoadSuccess={({ numPages }) => setPreviewNumPages(numPages)}
                        loading={
                          <div className="flex items-center justify-center h-64 text-gray-400">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0067C0] mr-3"></div>
                            문서를 불러오는 중...
                          </div>
                        }
                        error={
                          <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-3">
                            <AlertTriangle className="w-10 h-10" />
                            <p>미리보기를 불러올 수 없습니다.</p>
                          </div>
                        }
                      >
                        <div className="relative inline-block">
                          <Page 
                            pageNumber={previewPageNumber} 
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            className="shadow-md rounded-lg overflow-hidden border border-gray-200 transition-transform duration-200 origin-top"
                            width={Math.min(window.innerWidth - 64, 800)}
                            scale={previewZoom}
                            onRenderSuccess={({ width, height }) => setRenderedPageSize({ width, height })}
                          />
                          {renderedPageSize && (
                            <DrawingCanvas
                              ref={drawingCanvasRef}
                              width={renderedPageSize.width}
                              height={renderedPageSize.height}
                              color={drawColor}
                              lineWidth={drawLineWidth}
                              isDrawingMode={isDrawingMode}
                            />
                          )}
                        </div>
                      </Document>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auto Printing Animation Popup */}
      <AnimatePresence>
        {isAutoPrinting && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-8 right-8 bg-white rounded-2xl shadow-2xl border border-[#0067C0]/20 p-6 z-50 flex flex-col items-center w-72"
          >
            <div className="relative w-20 h-20 mb-3 flex items-center justify-center">
              {/* Paper sliding out */}
              <motion.div
                animate={{ y: [-10, 20], opacity: [0, 1, 0] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                className="absolute top-0 w-10 h-12 bg-blue-50 border border-blue-200 rounded shadow-sm z-0 flex flex-col items-center justify-start pt-2"
              >
                <div className="w-6 h-0.5 bg-blue-200 rounded-full mb-1"></div>
                <div className="w-6 h-0.5 bg-blue-200 rounded-full mb-1"></div>
                <div className="w-4 h-0.5 bg-blue-200 rounded-full"></div>
              </motion.div>
              {/* Printer Icon */}
              <div className="bg-white z-10 p-2 rounded-xl relative">
                <Printer className="w-12 h-12 text-[#0067C0]" />
              </div>
            </div>
            
            <h3 className="text-lg font-bold text-gray-800 mb-2">자동 인쇄 진행 중</h3>
            
            <div className="w-full flex justify-between items-end mb-1.5 px-1">
              <span className="text-sm font-medium text-gray-700">
                <strong className="text-[#0067C0] text-base">{Math.min(chunks.length, chunks.length - autoPrintQueue.length + 1)}</strong> / {chunks.length} 파트
              </span>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                남은 작업: {autoPrintQueue.length}개
              </span>
            </div>
            
            <div className="w-full bg-gray-100 rounded-full h-2.5 mb-1.5 overflow-hidden shadow-inner">
              <motion.div 
                className="bg-[#0067C0] h-2.5 rounded-full relative overflow-hidden"
                animate={{ width: `${(Math.min(chunks.length, chunks.length - autoPrintQueue.length + 1) / chunks.length) * 100}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                <div className="absolute inset-0 bg-white/20 w-full animate-[shimmer_2s_infinite] -skew-x-12 translate-x-[-100%]"></div>
              </motion.div>
            </div>
            
            <p className="text-xs text-gray-400 mb-5 text-right w-full px-1 font-medium">
              {Math.round((Math.min(chunks.length, chunks.length - autoPrintQueue.length + 1) / chunks.length) * 100)}% 완료
            </p>

            <div className="w-full flex gap-2">
              <button
                onClick={pauseAutoPrint}
                className="flex-1 py-2 bg-yellow-50 text-yellow-700 rounded-lg text-sm font-semibold hover:bg-yellow-100 transition-colors"
              >
                일시 정지
              </button>
              <button
                onClick={stopAutoPrint}
                className="flex-1 py-2 bg-red-50 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-100 transition-colors"
              >
                인쇄 중지
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="mt-12 pb-8 text-center text-sm text-gray-400">
        <p>제작자 <span className="font-semibold text-gray-500">AhBiYout</span></p>
      </footer>
      {/* Kiosk Mode Guide Modal */}
      <AnimatePresence>
        {showKioskGuide && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setShowKioskGuide(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden relative z-10 flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                    <Printer className="w-5 h-5 text-[#0067C0]" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">완전 무인 자동 인쇄 설정 가이드</h2>
                    <p className="text-sm text-gray-500">대화상자 없이 프린터로 즉시 전송하는 방법</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowKioskGuide(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto">
                <div className="prose prose-sm max-w-none text-gray-600">
                  <p className="text-base">
                    웹 브라우저(크롬, 엣지 등)는 보안상의 이유로 웹사이트가 사용자의 동의(인쇄 대화상자) 없이 프린터로 직접 데이터를 보내는 것을 <strong>엄격하게 차단</strong>합니다.
                  </p>
                  <p className="text-base mb-6">
                    따라서 클릭 한 번으로 대화상자 없이 프린터로 바로 데이터를 보내려면, 브라우저를 <strong>'키오스크 인쇄(Kiosk Printing) 모드'</strong>로 실행해야 합니다.
                  </p>

                  <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm mr-2">1</span>
                    Windows에서 크롬/엣지 설정하기
                  </h3>
                  <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-200">
                    <ol className="list-decimal list-inside space-y-3">
                      <li>바탕화면에 있는 <strong>Chrome</strong> 또는 <strong>Edge</strong> 바로가기 아이콘을 우클릭하고 <strong>[속성]</strong>을 누릅니다.</li>
                      <li><strong>[바로 가기]</strong> 탭의 <strong>'대상(T)'</strong> 입력칸 맨 끝으로 이동합니다.</li>
                      <li>한 칸 띄우고 아래의 텍스트를 정확히 추가합니다:
                        <div className="bg-gray-800 text-green-400 p-3 rounded-lg mt-2 font-mono text-sm select-all">
                          --kiosk-printing
                        </div>
                        <p className="text-xs text-gray-500 mt-1 ml-4">예시: <code className="text-gray-600">"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing</code></p>
                      </li>
                      <li><strong>[확인]</strong>을 눌러 저장합니다. (관리자 권한이 필요할 수 있습니다)</li>
                    </ol>
                  </div>

                  <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm mr-2">2</span>
                    기본 프린터 설정 확인
                  </h3>
                  <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-200">
                    <p className="mb-2">키오스크 인쇄 모드는 대화상자를 띄우지 않기 때문에, <strong>Windows에 설정된 '기본 프린터'</strong>로 무조건 전송됩니다.</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Windows 설정 &gt; Bluetooth 및 장치 &gt; 프린터 및 스캐너로 이동</li>
                      <li>출력하려는 프린터를 선택하고 <strong>'기본값으로 설정'</strong>을 클릭합니다.</li>
                    </ul>
                  </div>

                  <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm mr-2">3</span>
                    앱에서 자동 인쇄 실행
                  </h3>
                  <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                    <ol className="list-decimal list-inside space-y-2">
                      <li>수정한 바로가기 아이콘을 통해 브라우저를 <strong>새로 실행</strong>합니다.</li>
                      <li>이 앱에 접속하여 고급 설정의 <strong>'시스템 인쇄 대화상자 표시' 토글을 끕니다.</strong></li>
                      <li>문서를 분할한 후 <strong>'자동 연속 인쇄'</strong> 버튼을 누르면, 대화상자 없이 기본 프린터로 즉시 전송됩니다!</li>
                    </ol>
                  </div>
                </div>
              </div>
              
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                <button 
                  onClick={() => setShowKioskGuide(false)}
                  className="px-6 py-2 bg-[#0067C0] text-white rounded-lg font-medium hover:bg-[#005A9E] transition-colors"
                >
                  확인했습니다
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Printer Troubleshooting Modal */}
      <AnimatePresence>
        {showTroubleshootingGuide && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
              onClick={() => setShowTroubleshootingGuide(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden relative z-10 flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-red-50/30">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">프린터 문제 해결 가이드</h2>
                    <p className="text-sm text-gray-500">프린터가 오프라인이거나 오류가 발생했을 때</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowTroubleshootingGuide(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto">
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 font-bold text-gray-600">1</div>
                    <div>
                      <h3 className="font-bold text-gray-900 mb-1">전원 및 케이블 연결 확인</h3>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        프린터의 전원이 켜져 있는지 확인하고, USB 케이블이나 네트워크 케이블(LAN)이 단단히 연결되어 있는지 확인하세요. 무선(Wi-Fi) 프린터의 경우 공유기와의 연결 상태를 확인하세요.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 font-bold text-gray-600">2</div>
                    <div>
                      <h3 className="font-bold text-gray-900 mb-1">용지 걸림 및 소모품 확인</h3>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        프린터 덮개를 열어 걸린 용지가 있는지 확인하고 제거하세요. 토너나 잉크가 부족하거나, 용지함이 비어 있지는 않은지 확인하세요.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 font-bold text-gray-600">3</div>
                    <div>
                      <h3 className="font-bold text-gray-900 mb-1">프린터 재부팅</h3>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        프린터 전원을 끄고 약 10초 후에 다시 켜보세요. 많은 일시적인 오류는 재부팅만으로 해결됩니다.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 font-bold text-gray-600">4</div>
                    <div>
                      <h3 className="font-bold text-gray-900 mb-1">Windows 인쇄 대기열 확인</h3>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        제어판 &gt; 장치 및 프린터에서 해당 프린터를 우클릭하고 '인쇄 작업 목록 보기'를 선택하세요. 오류가 난 작업이 있다면 모두 취소하고 다시 시도하세요.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0 font-bold text-gray-600">5</div>
                    <div>
                      <h3 className="font-bold text-gray-900 mb-1">드라이버 상태 확인</h3>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        프린터 드라이버가 최신 버전인지 확인하거나, 드라이버를 삭제 후 다시 설치해 보세요.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-8 bg-blue-50 rounded-xl p-4 border border-blue-100">
                  <div className="flex items-center gap-2 mb-2 text-[#0067C0]">
                    <HelpCircle className="w-4 h-4" />
                    <span className="font-bold text-sm">여전히 해결되지 않나요?</span>
                  </div>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    프린터 제조사(삼성, HP, 캐논 등)의 공식 홈페이지에서 제공하는 '자가 진단 도구'를 다운로드하여 실행하면 더 정확한 원인을 파악할 수 있습니다.
                  </p>
                </div>
              </div>
              
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                <button 
                  onClick={() => setShowTroubleshootingGuide(false)}
                  className="px-6 py-2 bg-gray-900 text-white rounded-xl font-semibold hover:bg-gray-800 transition-all shadow-lg"
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Patch Notes Modal */}
      <AnimatePresence>
        {showPatchNotes && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-white">
                <div className="flex items-center space-x-3">
                  <div className="p-2.5 bg-[#0067C0] text-white rounded-xl shadow-md">
                    <Info className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-gray-900">버전 정보 & 패치 노트</h2>
                      <span className="px-2.5 py-0.5 text-xs font-bold bg-blue-100 text-[#0067C0] rounded-full">v1.4.0 최신</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">Win11 PDF Print Helper 패치 및 개선 내역</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowPatchNotes(false)}
                  className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-6 text-sm">
                {/* v1.4.0 */}
                <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100/80 space-y-3">
                  <div className="flex items-center justify-between border-b border-blue-100 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#0067C0] text-base">v1.4.0</span>
                      <span className="text-xs bg-[#0067C0] text-white px-2 py-0.5 rounded font-medium">최신 업데이트</span>
                    </div>
                    <span className="text-xs text-gray-500">2026-08-04</span>
                  </div>
                  <ul className="space-y-2 text-gray-700 text-xs leading-relaxed list-disc list-inside">
                    <li><strong className="text-gray-900">사용자 지정 포트 자동 빌드 스크립트 (<code className="bg-white px-1.5 py-0.5 rounded border border-blue-200">build.bat</code>):</strong> 원하는 포트 번호를 입력받아 Web 및 Electron 패키징을 원스톱 진행합니다.</li>
                    <li><strong className="text-gray-900">패치 버전명 자동 생성:</strong> Electron 빌드 결과물(<code className="bg-white px-1.5 py-0.5 rounded border border-blue-200">release/</code>) 파일명 끝에 최신 버전(<code className="text-[#0067C0] font-semibold">v1.4.0</code>)이 자동 부착됩니다.</li>
                    <li><strong className="text-gray-900">메인 화면 버전 정보 표기:</strong> 상단 타이틀 바에 버전 정보 배지 및 패치노트 모달이 연동되었습니다.</li>
                    <li><strong className="text-gray-900">프린터 상태 실시간 진단 툴팁:</strong> 스풀러 에러 코드별 복구 가이드를 제공합니다.</li>
                    <li><strong className="text-gray-900">프린터 복구 시 알림 & 하이라이트:</strong> 오프라인 복구 시 시각적 녹색 링 효과 및 데스크톱 알림을 발송합니다.</li>
                  </ul>
                </div>

                {/* v1.3.0 */}
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/60 space-y-2">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                    <span className="font-bold text-gray-800">v1.3.0</span>
                    <span className="text-xs text-gray-500">2026-06-28</span>
                  </div>
                  <ul className="space-y-1.5 text-gray-600 text-xs leading-relaxed list-disc list-inside">
                    <li>인쇄 로그 기록 및 세션 안전 자동 저장/복원 기능</li>
                    <li>PDF 오버레이 드로잉 메모/서명 필기캔버스 탑재</li>
                    <li>제본용 여백(Gutter Margin) 및 간지 삽입 옵션 강화</li>
                  </ul>
                </div>

                {/* v1.2.0 */}
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-200/60 space-y-2">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                    <span className="font-bold text-gray-800">v1.2.0</span>
                    <span className="text-xs text-gray-500">2026-05-15</span>
                  </div>
                  <ul className="space-y-1.5 text-gray-600 text-xs leading-relaxed list-disc list-inside">
                    <li>대용량 PDF 분할 알고리즘 개선 및 메모리 최적화</li>
                    <li>Windows 스풀러 직접 연동 및 드롭다운 프린터 선택 지원</li>
                  </ul>
                </div>

                {/* Developer & Links Section */}
                <div className="bg-gradient-to-r from-blue-50/70 to-indigo-50/70 rounded-xl p-4 border border-blue-100 space-y-2">
                  <div className="flex items-center justify-between border-b border-blue-200/60 pb-2">
                    <span className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-[#0067C0]" />
                      제작자 및 공식 채널 안내
                    </span>
                    <span className="text-xs text-[#0067C0] font-semibold">개발자: AhBiYout</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1 text-xs">
                    <a 
                      href={`https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:text-[#0067C0] transition-colors font-medium shadow-2xs"
                    >
                      <Github className="w-3.5 h-3.5 text-gray-800" />
                      <span>GitHub 저장소 ({GITHUB_REPO_OWNER})</span>
                      <ExternalLink className="w-3 h-3 text-gray-400" />
                    </a>
                    <a 
                      href="https://ahbiyoutvibe.blogspot.com/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:text-[#0067C0] transition-colors font-medium shadow-2xs"
                    >
                      <Globe className="w-3.5 h-3.5 text-[#0067C0]" />
                      <span>공식 구글 블로그</span>
                      <ExternalLink className="w-3 h-3 text-gray-400" />
                    </a>
                    <a 
                      href="https://www.cisnet.co.kr" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:text-[#0067C0] transition-colors font-medium shadow-2xs"
                    >
                      <Globe className="w-3.5 h-3.5 text-emerald-600" />
                      <span>소속 : 씨아이에스넷</span>
                      <ExternalLink className="w-3 h-3 text-gray-400" />
                    </a>
                  </div>
                </div>
              </div>
              
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
                <span className="text-xs text-gray-400">Win11 PDF Print Helper Edition</span>
                <button 
                  onClick={() => setShowPatchNotes(false)}
                  className="px-6 py-2 bg-[#0067C0] text-white rounded-xl font-semibold hover:bg-[#005A9E] transition-all shadow-md text-xs cursor-pointer"
                >
                  확인
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* GitHub Releases Real-time Update Modal */}
      <UpdateNotificationModal
        isOpen={updateAvailable || showManualUpdateModal}
        onClose={() => {
          dismissUpdate();
          setShowManualUpdateModal(false);
        }}
        currentVersion={currentVersion}
        latestRelease={latestRelease}
        onRefreshCheck={() => checkForUpdates(true)}
        isChecking={isCheckingUpdate}
      />

      {/* App Footer */}
      <footer className="mt-auto py-3 px-6 bg-white/80 backdrop-blur-md border-t border-gray-200/80 text-xs text-gray-500 flex flex-col sm:flex-row items-center justify-between gap-2 z-10">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-700">Win11 PDF Print Helper v{currentVersion}</span>
          <span className="text-gray-300">|</span>
          <span>개발자: <strong className="text-gray-700">AhBiYout</strong></span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
          <a 
            href={`https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`}
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-[#0067C0] flex items-center gap-1 transition-colors"
          >
            <Github className="w-3.5 h-3.5 text-gray-700" />
            <span>GitHub ({GITHUB_REPO_OWNER})</span>
            <ExternalLink className="w-3 h-3 text-gray-400" />
          </a>
          <a 
            href="https://ahbiyoutvibe.blogspot.com/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-[#0067C0] flex items-center gap-1 transition-colors"
          >
            <Globe className="w-3.5 h-3.5 text-[#0067C0]" />
            <span>공식 구글 블로그</span>
            <ExternalLink className="w-3 h-3 text-gray-400" />
          </a>
          <a 
            href="https://www.cisnet.co.kr" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-[#0067C0] flex items-center gap-1 transition-colors"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-600" />
            <span>소속 : 씨아이에스넷</span>
            <ExternalLink className="w-3 h-3 text-gray-400" />
          </a>
        </div>
      </footer>

    </div>
  );
}
