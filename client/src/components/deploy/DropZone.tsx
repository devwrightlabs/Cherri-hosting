import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface DropZoneProps {
  onFilesAccepted: (files: File[]) => void;
  maxSize?: number;
  accept?: Record<string, string[]>;
}

export default function DropZone({
  onFilesAccepted,
  maxSize = 50 * 1024 * 1024,
  accept,
}: DropZoneProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        onFilesAccepted(acceptedFiles);
      }
    },
    [onFilesAccepted],
  );

  const { getRootProps, getInputProps, isDragActive, acceptedFiles, fileRejections } =
    useDropzone({
      onDrop,
      maxSize,
      accept,
      multiple: true,
    });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`relative border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer
          ${isDragActive
            ? 'border-cherry-500 bg-cherry-500/10'
            : 'border-surface-600 bg-surface-800/40 hover:border-cherry-500/60 hover:bg-surface-800/60'
          }`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-3">
          <div className="text-4xl">{isDragActive ? '📂' : '📁'}</div>
          {isDragActive ? (
            <p className="text-cherry-400 font-medium">Drop files here…</p>
          ) : (
            <>
              <p className="text-white font-medium">
                Drag & drop files here
              </p>
              <p className="text-surface-400 text-sm">
                or{' '}
                <span className="text-cherry-400 underline">browse</span>
                {' '}— supports HTML, CSS, JS, images, and more
              </p>
              <p className="text-surface-500 text-xs">
                Max file size: {Math.round(maxSize / 1024 / 1024)} MB
              </p>
            </>
          )}
        </div>
      </div>

      {acceptedFiles.length > 0 && (
        <div className="glass rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
          <p className="text-xs text-surface-400 font-medium mb-2">
            {acceptedFiles.length} file{acceptedFiles.length !== 1 ? 's' : ''} selected
          </p>
          {acceptedFiles.map((file) => (
            <div key={`${file.name}-${file.size}`} className="flex justify-between text-xs">
              <span className="text-surface-300 truncate font-mono">{file.name}</span>
              <span className="text-surface-500 shrink-0 ml-2">
                {(file.size / 1024).toFixed(1)} KB
              </span>
            </div>
          ))}
        </div>
      )}

      {fileRejections.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          {fileRejections.map(({ file, errors }) => (
            <p key={file.name} className="text-red-400 text-xs">
              {file.name}: {errors.map((e) => e.message).join(', ')}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
