import { useState, useRef, useCallback, useEffect, DragEvent } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileEntry {
  file: File;
  path: string;
}

export interface DropZoneProps {
  onFilesAccepted: (files: File[], paths: string[]) => void;
}

// ─── Tier definitions (mirrors server constants) ──────────────────────────────

const TIERS = [
  { key: 'FREE',  label: 'Free',   price: '0π',    storageBytes: 500 * 1024 * 1024,                  color: 'text-surface-400', bg: 'bg-surface-700/50' },
  { key: 'TIER1', label: 'Tier 1', price: '17π/mo', storageBytes: 2   * 1024 * 1024 * 1024,           color: 'text-blue-400',    bg: 'bg-blue-900/30'    },
  { key: 'TIER2', label: 'Tier 2', price: '35π/mo', storageBytes: 10  * 1024 * 1024 * 1024,           color: 'text-cherry-400',  bg: 'bg-cherry-900/30'  },
  { key: 'TIER3', label: 'Tier 3', price: '88π/mo', storageBytes: 50  * 1024 * 1024 * 1024,           color: 'text-amber-400',   bg: 'bg-amber-900/30'   },
  { key: 'TIER4', label: 'Tier 4', price: '125π/mo', storageBytes: 100 * 1024 * 1024 * 1024,          color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const IGNORED_NAMES = new Set([
  'node_modules', '.git', '__MACOSX', '.DS_Store', 'Thumbs.db', '.env',
]);

function shouldIgnore(name: string): boolean {
  return IGNORED_NAMES.has(name);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function appsPerTier(appBytes: number, tierBytes: number): number {
  if (appBytes <= 0) return 0;
  return Math.floor(tierBytes / appBytes);
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

async function traverseDirectory(
  entry: FileSystemDirectoryEntry,
  basePath = '',
  result: FileEntry[] = [],
): Promise<FileEntry[]> {
  const reader = entry.createReader();
  const entries = await readAllEntries(reader);

  for (const child of entries) {
    if (shouldIgnore(child.name)) continue;
    const childPath = basePath ? `${basePath}/${child.name}` : child.name;

    if (child.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (child as FileSystemFileEntry).file(resolve, reject),
      );
      result.push({ file, path: childPath });
    } else if (child.isDirectory) {
      await traverseDirectory(child as FileSystemDirectoryEntry, childPath, result);
    }
  }
  return result;
}

// ─── Sub-component: Capacity Calculator ──────────────────────────────────────

function CapacityPanel({ totalBytes }: { totalBytes: number }) {
  if (totalBytes <= 0) return null;

  const maxApps = appsPerTier(totalBytes, TIERS[TIERS.length - 1].storageBytes);

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/60 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-surface-700/40 flex items-center gap-2">
        <span className="text-sm">📊</span>
        <span className="text-surface-300 text-xs font-medium">
          How many apps this size can each plan host?
        </span>
        <span className="text-surface-500 text-xs ml-auto">{formatBytes(totalBytes)} per app</span>
      </div>

      <div className="divide-y divide-surface-800/60">
        {TIERS.map((tier) => {
          const count = appsPerTier(totalBytes, tier.storageBytes);
          const pct = maxApps > 0 ? Math.min((count / maxApps) * 100, 100) : 0;
          const tooBig = count === 0;

          return (
            <div key={tier.key} className={`flex items-center gap-3 px-4 py-2.5 ${tooBig ? 'opacity-40' : ''}`}>
              {/* Tier badge */}
              <div className={`flex-shrink-0 w-[68px] rounded-md px-2 py-0.5 text-center text-xs font-semibold ${tier.bg} ${tier.color}`}>
                {tier.label}
              </div>

              {/* Storage label */}
              <div className="w-[52px] flex-shrink-0 text-right text-xs text-surface-500">
                {formatBytes(tier.storageBytes)}
              </div>

              {/* Bar */}
              <div className="flex-1 min-w-0">
                <div className="h-1.5 rounded-full bg-surface-800 overflow-hidden">
                  {!tooBig && (
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        tier.key === 'FREE'  ? 'bg-surface-500' :
                        tier.key === 'TIER1' ? 'bg-blue-500'    :
                        tier.key === 'TIER2' ? 'bg-cherry-500'  :
                        tier.key === 'TIER3' ? 'bg-amber-500'   : 'bg-emerald-500'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  )}
                </div>
              </div>

              {/* Count */}
              <div className="flex-shrink-0 w-[90px] text-right">
                {tooBig ? (
                  <span className="text-xs text-red-500">app too large</span>
                ) : (
                  <span className={`text-sm font-bold ${tier.color}`}>
                    ×{count.toLocaleString()}
                    <span className="text-xs font-normal text-surface-500 ml-1">apps</span>
                  </span>
                )}
              </div>

              {/* Price */}
              <div className="flex-shrink-0 w-[58px] text-right text-xs text-surface-600">
                {tier.price}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DropZone({ onFilesAccepted }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState('');
  const [folderName, setFolderName] = useState('');

  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
    }
  }, []);

  const commit = useCallback(
    (newEntries: FileEntry[], name = '') => {
      if (newEntries.length === 0) {
        setError('No deployable files found. Make sure the folder contains web files.');
        return;
      }
      setEntries(newEntries);
      setFolderName(name);
      setError('');
      onFilesAccepted(
        newEntries.map((e) => e.file),
        newEntries.map((e) => e.path),
      );
    },
    [onFilesAccepted],
  );

  // ── Drag & drop ──────────────────────────────────────────────────────────

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      setError('');

      const items = Array.from(e.dataTransfer.items);
      const firstEntry = items[0]?.webkitGetAsEntry?.();
      const hasDirectory = items.some((item) => item.webkitGetAsEntry?.()?.isDirectory);

      // Single file (ZIP or plain) — no traversal needed.
      if (!hasDirectory && items.length === 1) {
        const f = e.dataTransfer.files[0];
        if (!f) return;
        commit([{ file: f, path: f.name }], f.name);
        return;
      }

      setIsProcessing(true);
      setScanCount(0);
      try {
        const collected: FileEntry[] = [];
        let rootName = '';

        for (const item of items) {
          const entry = item.webkitGetAsEntry?.();
          if (!entry) continue;
          if (shouldIgnore(entry.name)) continue;

          if (entry.isDirectory) {
            rootName = rootName || entry.name;
            // Wrap traverseDirectory to live-update the scan counter
            const before = collected.length;
            await traverseDirectory(entry as FileSystemDirectoryEntry, '', collected);
            const added = collected.length - before;
            setScanCount((c) => c + added);
          } else if (entry.isFile) {
            const file = await new Promise<File>((resolve, reject) =>
              (entry as FileSystemFileEntry).file(resolve, reject),
            );
            collected.push({ file, path: entry.name });
            setScanCount((c) => c + 1);
          }
        }

        commit(collected, rootName || firstEntry?.name || '');
      } catch {
        setError('Could not read the dropped folder. Try "Select folder" below instead.');
      } finally {
        setIsProcessing(false);
      }
    },
    [commit],
  );

  // ── Folder browse (webkitdirectory) ──────────────────────────────────────

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    if (fileList.length === 0) return;

    const result: FileEntry[] = [];
    let rootName = '';

    for (const file of fileList) {
      const relativePath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
      const parts = relativePath.split('/');
      if (!rootName) rootName = parts[0];
      if (parts.some((p) => shouldIgnore(p))) continue;

      // Strip the top-level folder segment.
      const cleanPath = parts.length > 1 ? parts.slice(1).join('/') : file.name;
      if (!cleanPath) continue;
      result.push({ file, path: cleanPath });
    }

    commit(result, rootName);
    e.target.value = '';
  };

  // ── ZIP / file browse ────────────────────────────────────────────────────

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    if (fileList.length === 0) return;
    commit(fileList.map((f) => ({ file: f, path: f.name })), fileList[0].name);
    e.target.value = '';
  };

  const reset = () => {
    setEntries([]);
    setFolderName('');
    setError('');
    setScanCount(0);
    onFilesAccepted([], []);
  };

  const totalBytes = entries.reduce((acc, e) => acc + e.file.size, 0);
  const isSelected = entries.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Hidden inputs */}
      <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleFolderInputChange} />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".zip,.html,.htm,.css,.js,.mjs,.cjs,.jsx,.ts,.tsx,.json,.png,.jpg,.jpeg,.gif,.svg,.ico,.webp,.avif,.woff,.woff2,.ttf,.otf,.txt,.md,.xml,.webmanifest"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Drop target — shown until files are selected */}
      {!isSelected && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => void handleDrop(e)}
          className={`
            flex flex-col items-center justify-center gap-3
            border-2 border-dashed rounded-xl p-8 text-center
            transition-colors duration-150
            ${isDragging
              ? 'border-cherry-400 bg-cherry-500/10'
              : 'border-surface-600 hover:border-surface-500 bg-surface-800/40'
            }
          `}
        >
          {isProcessing ? (
            <>
              <div className="text-3xl animate-pulse">📂</div>
              <p className="text-white text-sm font-medium">Reading folder…</p>
              <p className="text-surface-400 text-xs">
                {scanCount > 0 ? `${scanCount.toLocaleString()} files scanned so far` : 'Scanning directory tree…'}
              </p>
            </>
          ) : (
            <>
              <div className="text-4xl">{isDragging ? '📂' : '🗂️'}</div>
              <div>
                <p className="text-white font-medium text-sm">
                  {isDragging ? 'Drop your project folder here' : 'Drag & drop your entire project folder'}
                </p>
                <p className="text-surface-500 text-xs mt-1">
                  Whole folder structure is preserved · node_modules &amp; .git are ignored
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-200 transition-colors"
                >
                  📁 Select folder
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-200 transition-colors"
                >
                  📦 ZIP or files
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Selected state — summary + capacity calculator */}
      {isSelected && (
        <div className="space-y-2">
          {/* Header row */}
          <div className="rounded-xl border border-surface-700/60 bg-surface-800/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-700/40">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg flex-shrink-0">📂</span>
                <span className="text-white text-sm font-medium truncate">
                  {folderName || 'Selected files'}
                </span>
                <span className="text-surface-400 text-xs flex-shrink-0">
                  {entries.length.toLocaleString()} file{entries.length !== 1 ? 's' : ''} · {formatBytes(totalBytes)}
                </span>
              </div>
              <button
                type="button"
                onClick={reset}
                className="text-surface-500 hover:text-surface-300 text-xs ml-3 flex-shrink-0 transition-colors"
              >
                ✕ Clear
              </button>
            </div>
            {/* Path preview */}
            <div className="px-4 py-2 space-y-0.5 font-mono text-xs text-surface-400 max-h-28 overflow-y-auto">
              {entries.slice(0, 10).map((e) => (
                <div key={e.path} className="truncate">{e.path}</div>
              ))}
              {entries.length > 10 && (
                <div className="text-surface-600">…and {(entries.length - 10).toLocaleString()} more files</div>
              )}
            </div>
          </div>

          {/* Capacity calculator */}
          <CapacityPanel totalBytes={totalBytes} />
        </div>
      )}

      {error && <p className="text-red-400 text-xs px-1">{error}</p>}
    </div>
  );
}
