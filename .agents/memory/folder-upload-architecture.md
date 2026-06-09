---
name: Folder upload architecture
description: How full-folder drag-and-drop upload works end-to-end in Sherry Hosting.
---

## Rule
The drop zone uses the native FileSystemEntry API (not react-dropzone) to recursively traverse dropped directories. A separate `webkitdirectory` input handles click-to-browse folders.

## Why
react-dropzone does not support the `webkitdirectory` attribute or the `DataTransferItem.webkitGetAsEntry()` API needed for full directory traversal with preserved relative paths.

## How to apply
**Client** (`DropZone.tsx`):
- Hidden `<input ref webkitdirectory multiple>` — set via `setAttribute('webkitdirectory', '')` in `useEffect` (not JSX, TS doesn't know the attribute).
- `onDrop` handler: use `e.dataTransfer.items[i].webkitGetAsEntry()` → `traverseDirectory()` for folders; plain File for single files/ZIPs.
- `webkitRelativePath` on File objects from the folder input: strip first path segment (the folder name).
- `onFilesAccepted(files: File[], paths: string[])` — parallel arrays, index-aligned.

**API** (`deployApi.ts`):
- `deployFiles(projectId, files, filePaths, onProgress)` — appends `filePaths` as a JSON-stringified field alongside the multipart files.

**Server** (`deployments.ts`):
- Parses `req.body.filePaths` JSON → overrides `f.originalname` for path reconstruction.
- Single `.zip` file → `extractZipToFiles()` using adm-zip; strips a common root folder if present (GitHub/export ZIPs).
- `adm-zip` is installed in `server/` (not root).
- Multer in-memory ceiling = TIER2_MAX_UPLOAD_BYTES (1 GB); Tier 3/4 need disk streaming for their full limits.
