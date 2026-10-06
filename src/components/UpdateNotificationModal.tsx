import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Download, ExternalLink, X, Github, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';
import { GithubReleaseInfo, GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from '../hooks/useGithubUpdateChecker';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion: string;
  latestRelease: GithubReleaseInfo | null;
  onRefreshCheck?: () => void;
  isChecking?: boolean;
}

export const UpdateNotificationModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  currentVersion,
  latestRelease,
  onRefreshCheck,
  isChecking = false,
}) => {
  if (!isOpen) return null;

  const versionText = latestRelease?.version || '1.4.1';
  const releaseUrl = latestRelease?.releaseUrl || `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`;
  const downloadUrl = latestRelease?.downloadUrl || releaseUrl;
  const releaseNotes = latestRelease?.releaseNotes || '새로운 안정성 패치 및 성능 개선이 포함되었습니다.';
  const assetName = latestRelease?.assetName || `Win11-PDF-Print-Helper-v${versionText}.exe`;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 15 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-blue-100 flex flex-col"
        >
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-[#0067C0] via-[#0078D4] to-[#106EBE] p-6 text-white relative overflow-hidden">
            <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-10 pointer-events-none">
              <Sparkles className="w-48 h-48" />
            </div>

            <div className="flex items-start justify-between relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-white/15 backdrop-blur-md rounded-xl border border-white/20 shadow-sm">
                  <Sparkles className="w-6 h-6 text-yellow-300 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wider font-semibold text-blue-100">
                      GitHub Release Update
                    </span>
                    <span className="text-[10px] bg-yellow-400 text-gray-900 font-bold px-2 py-0.5 rounded-full shadow-xs">
                      NEW
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-white mt-0.5">
                    새로운 버전 업데이트 알림
                  </h2>
                </div>
              </div>

              <button
                onClick={onClose}
                className="p-1.5 rounded-full hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
                title="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Version Comparison Badge */}
            <div className="mt-4 pt-3 border-t border-white/20 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-blue-100">현재 버전:</span>
                <span className="font-mono bg-white/20 px-2 py-0.5 rounded font-bold">
                  v{currentVersion}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-blue-200" />
                <span className="text-blue-100">최신 버전:</span>
                <span className="font-mono bg-yellow-400 text-gray-900 px-2 py-0.5 rounded font-black shadow-xs">
                  v{versionText}
                </span>
              </div>
              {onRefreshCheck && (
                <button
                  onClick={onRefreshCheck}
                  disabled={isChecking}
                  className="flex items-center gap-1 text-[11px] text-blue-100 hover:text-white transition-colors cursor-pointer"
                  title="GitHub 최신 릴리스 다시 확인"
                >
                  <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
                  <span>새로고침</span>
                </button>
              )}
            </div>
          </div>

          {/* Content Body */}
          <div className="p-6 space-y-4 text-sm">
            {/* Release Description Box */}
            <div className="bg-blue-50/60 rounded-xl p-4 border border-blue-100 space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-600 font-medium">
                <span className="font-semibold text-gray-800">
                  {latestRelease?.releaseName || `Win11 PDF Print Helper v${versionText}`}
                </span>
                {latestRelease?.publishedAt && (
                  <span className="text-gray-400">
                    {new Date(latestRelease.publishedAt).toLocaleDateString('ko-KR')}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-700 bg-white p-3 rounded-lg border border-gray-100 whitespace-pre-wrap max-h-36 overflow-y-auto leading-relaxed shadow-2xs">
                {releaseNotes}
              </div>
            </div>

            {/* Installer Details */}
            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200/80 text-xs text-gray-600 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-500 font-medium">배포 저장소:</span>
                <a
                  href={`https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#0067C0] hover:underline flex items-center gap-1 font-mono font-medium"
                >
                  <Github className="w-3.5 h-3.5" />
                  <span>{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}</span>
                </a>
              </div>
              {assetName && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 font-medium">설치 파일:</span>
                  <span className="font-mono text-gray-800 font-semibold truncate max-w-[240px]">
                    {assetName}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium pt-1">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>GitHub Releases 서명 완료 및 자동 바이러스 프리 인스톨러</span>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 px-6 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
            <a
              href={releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-600 hover:text-[#0067C0] flex items-center gap-1 transition-colors font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>릴리스 노트 전체보기</span>
            </a>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200/80 rounded-xl transition-colors cursor-pointer"
              >
                나중에
              </button>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2 text-xs font-bold text-white bg-[#0067C0] hover:bg-[#005A9E] rounded-xl shadow-md flex items-center gap-1.5 transition-all transform hover:-translate-y-0.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>업데이트 다운로드 & 설치</span>
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
