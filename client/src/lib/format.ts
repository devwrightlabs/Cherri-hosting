/**
 * Central byte-formatting utilities.
 * All functions guard against undefined / null / NaN — callers should never
 * see "NaN undefined" or "Infinity KB" regardless of API field presence.
 */

export function formatBytes(bytes?: number | null): string {
  const n = Number.isFinite(bytes) ? (bytes as number) : 0;
  if (n <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(k)), sizes.length - 1);
  const value = n / Math.pow(k, i);
  return `${parseFloat(value.toFixed(i === 0 ? 0 : 1))} ${sizes[i]}`;
}

export interface StorageInfo {
  usedLabel: string;
  totalLabel: string;
  pct: number;
}

export function formatStorage(usedBytes?: number | null, totalBytes?: number | null): StorageInfo {
  const used = Number.isFinite(usedBytes) ? (usedBytes as number) : 0;
  const total = Number.isFinite(totalBytes) ? (totalBytes as number) : 0;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return {
    usedLabel: formatBytes(used),
    totalLabel: total > 0 ? formatBytes(total) : '—',
    pct,
  };
}
