import { useState, useEffect, useCallback } from 'react';

export interface GithubReleaseInfo {
  version: string;
  tagName: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  releaseUrl: string;
  downloadUrl?: string;
  assetName?: string;
}

export const GITHUB_REPO_OWNER = 'AhBiYout-all';
export const GITHUB_REPO_NAME = 'Win11-PDF-Print-Helper';
export const CURRENT_APP_VERSION = '1.4.0';

/**
 * Compare two semver strings: returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
function compareSemver(v1: string, v2: string): number {
  const cleanV1 = v1.replace(/^v/i, '').trim();
  const cleanV2 = v2.replace(/^v/i, '').trim();
  
  const p1 = cleanV1.split('.').map((n) => parseInt(n, 10) || 0);
  const p2 = cleanV2.split('.').map((n) => parseInt(n, 10) || 0);

  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const num1 = p1[i] || 0;
    const num2 = p2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export function useGithubUpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [latestRelease, setLatestRelease] = useState<GithubReleaseInfo | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const checkForUpdates = useCallback(async (manual = false) => {
    setIsChecking(true);
    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok) {
        // When repo doesn't exist yet or rate limited, silently ignore on auto-check
        if (manual) {
          console.info('GitHub Releases check status:', response.status);
        }
        return;
      }

      const data = await response.json();
      const latestTag = data.tag_name || data.name || '';
      const cleanLatest = latestTag.replace(/^v/i, '').trim();

      // Find Windows installer asset (.exe) if available
      let installerDownloadUrl = data.html_url;
      let assetFileName: string | undefined = undefined;
      if (Array.isArray(data.assets) && data.assets.length > 0) {
        const exeAsset = data.assets.find((a: any) =>
          typeof a.name === 'string' && a.name.toLowerCase().endsWith('.exe')
        );
        if (exeAsset) {
          installerDownloadUrl = exeAsset.browser_download_url;
          assetFileName = exeAsset.name;
        }
      }

      const info: GithubReleaseInfo = {
        version: cleanLatest,
        tagName: latestTag,
        releaseName: data.name || latestTag,
        releaseNotes: data.body || '새로운 기능 추가 및 버그 수정이 포함되었습니다.',
        publishedAt: data.published_at || new Date().toISOString(),
        releaseUrl: data.html_url || `https://github.com/AhBiYout-all/${GITHUB_REPO_NAME}/releases`,
        downloadUrl: installerDownloadUrl,
        assetName: assetFileName,
      };

      setLatestRelease(info);

      // Check if latest version is higher than current
      if (compareSemver(cleanLatest, CURRENT_APP_VERSION) > 0) {
        // If not dismissed in this session
        if (dismissedVersion !== cleanLatest) {
          setUpdateAvailable(true);
        }
      } else {
        setUpdateAvailable(false);
      }
    } catch (err) {
      console.warn('Update check warning:', err);
    } finally {
      setIsChecking(false);
    }
  }, [dismissedVersion]);

  // Initial auto-check on mount
  useEffect(() => {
    // Delay check slightly for smooth initial rendering
    const timer = setTimeout(() => {
      checkForUpdates(false);
    }, 2000);

    // Auto-poll every 6 hours
    const interval = setInterval(() => {
      checkForUpdates(false);
    }, 6 * 60 * 60 * 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkForUpdates]);

  const dismissUpdate = () => {
    if (latestRelease) {
      setDismissedVersion(latestRelease.version);
    }
    setUpdateAvailable(false);
  };

  return {
    updateAvailable,
    setUpdateAvailable,
    latestRelease,
    isChecking,
    checkForUpdates,
    dismissUpdate,
    currentVersion: CURRENT_APP_VERSION,
  };
}
