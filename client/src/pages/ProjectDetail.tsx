import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import DeploymentCard from '../components/dashboard/DeploymentCard';
import { useToast } from '../components/ui/Toast';
import { projectsApi, deploymentsApi, statusApi } from '../lib/api';
import { Project, Deployment } from '../types';

/** Trigger a browser download for a Blob payload. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  // Sanitized backend-provider outage flag (never reveals the provider).
  const [backendOutage, setBackendOutage] = useState(false);

  // Data & Portability + Danger Zone state.
  const [exportingSite, setExportingSite] = useState(false);
  const [exportingDb, setExportingDb] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([projectsApi.get(id), deploymentsApi.listByProject(id)])
      .then(([projRes, deplRes]) => {
        setProject((projRes.data as { project: Project }).project);
        setDeployments((deplRes.data as { deployments: Deployment[] }).deployments);
      })
      .catch(() => setError('We could not load this project.'))
      .finally(() => setIsLoading(false));
  }, [id]);

  // Poll the sanitized backend-provider health so we can reassure the user that
  // their IPFS site is unaffected during a backend outage. Best-effort: any
  // failure simply leaves the flag false (no false outage shown).
  useEffect(() => {
    let active = true;
    const load = () => {
      statusApi
        .get()
        .then((res) => {
          if (active) setBackendOutage(res.data.backendProvider.state === 'outage');
        })
        .catch(() => undefined);
    };
    load();
    const intervalId = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []);

  // Parse a JSON error message out of an Axios blob-typed error response.
  async function readBlobError(err: unknown, fallback: string): Promise<string> {
    const ax = err as AxiosError;
    const data = ax.response?.data;
    if (data instanceof Blob) {
      try {
        const parsed = JSON.parse(await data.text());
        return parsed.error ?? fallback;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  async function handleExportSite(): Promise<void> {
    if (!id) return;
    setExportingSite(true);
    try {
      const res = await projectsApi.exportSiteArchive(id);
      const contentType = String(res.headers['content-type'] ?? '');
      const blob = res.data as Blob;
      if (contentType.includes('application/json')) {
        // Honest fallback: gateway could not build an archive; CID/links remain.
        const parsed = JSON.parse(await blob.text());
        toastError(
          parsed.archiveUnavailableReason ??
            'Archive unavailable — your files remain at the CID and gateway links.',
        );
        return;
      }
      downloadBlob(blob, `${project?.name ?? 'site'}.car`);
      success('Site archive downloaded');
    } catch (err) {
      toastError(await readBlobError(err, 'We could not export your site right now.'));
    } finally {
      setExportingSite(false);
    }
  }

  async function handleExportDb(): Promise<void> {
    if (!id) return;
    setExportingDb(true);
    try {
      const res = await projectsApi.exportDatabase(id);
      downloadBlob(res.data as Blob, `${project?.name ?? 'database'}.dump`);
      success('Database export downloaded');
    } catch (err) {
      toastError(
        await readBlobError(
          err,
          'Your database export is not available yet — it becomes available once your backend is live.',
        ),
      );
    } finally {
      setExportingDb(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!id) return;
    setDeleting(true);
    try {
      const res = await projectsApi.delete(id);
      if (res.status === 202) {
        // Honest in-progress teardown — never a fake "deleted".
        toastError(
          (res.data as { message?: string })?.message ??
            'Your app is being deleted; some resources are still being torn down.',
        );
        return;
      }
      success('App deleted');
      navigate('/projects');
    } catch {
      toastError('We could not delete this app right now. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <Skeleton className="h-6 w-40 mb-2" />
        <Skeleton className="h-4 w-56 mb-6" />
        <Card>
          <Skeleton className="h-4 w-24 mb-3" />
          <Skeleton className="h-3 w-full mb-2" />
          <Skeleton className="h-3 w-3/4" />
        </Card>
      </AppShell>
    );
  }

  if (error || !project) {
    return (
      <AppShell>
        <EmptyState
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          }
          title="Project not found"
          description={error || 'This project may have been removed.'}
          action={
            <Link to="/projects">
              <Button variant="secondary">Back to projects</Button>
            </Link>
          }
        />
      </AppShell>
    );
  }

  const activeDeployment = deployments.find((d) => d.status === 'ACTIVE');

  return (
    <AppShell>
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-ink-mut text-xs mb-1">
          <Link to="/projects" className="hover:text-ink transition-colors">
            Projects
          </Link>
          <span>/</span>
          <span className="text-ink truncate">{project.name}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink font-display tracking-tight truncate">
              {project.name}
            </h1>
            {project.description && (
              <p className="text-ink-mut text-sm mt-0.5">{project.description}</p>
            )}
          </div>
          <Link to={`/deploy?projectId=${project.id}`} className="shrink-0">
            <Button size="sm">New deploy</Button>
          </Link>
        </div>
      </div>

      {/* Live deployment */}
      {activeDeployment && (
        <Card className="border-gold/25">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-live animate-pulse-slow" />
            <span className="text-sm font-medium text-ink">Live deployment</span>
          </div>
          {backendOutage && (
            <div
              role="status"
              className="mb-3 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
            >
              Site live on IPFS · backend features temporarily unavailable. Your
              published site keeps serving from IPFS even while backend and
              database features are down.
            </div>
          )}
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2">
              <span className="text-ink-mut shrink-0 w-8">CID</span>
              <span className="font-mono text-ink break-all">{activeDeployment.cid}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-ink-mut shrink-0 w-8">URL</span>
              <a
                href={activeDeployment.gateway}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-ink underline break-all"
              >
                {activeDeployment.gateway}
              </a>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={activeDeployment.gateway} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="secondary">
                Open site ↗
              </Button>
            </a>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(activeDeployment.gateway);
                success('URL copied');
              }}
            >
              Copy URL
            </Button>
          </div>
        </Card>
      )}

      {/* Deployment history */}
      <div>
        <h2 className="text-base font-semibold text-ink font-display mb-3 flex items-center gap-2">
          Deployment history
          <Badge variant="default">{deployments.length}</Badge>
        </h2>
        {deployments.length === 0 ? (
          <EmptyState
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V6M6 11l6-6 6 6" />
              </svg>
            }
            title="No deployments yet"
            description="Drop your build files to publish the first version of this project."
            action={
              <Link to={`/deploy?projectId=${project.id}`}>
                <Button>Deploy now</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {deployments.map((d) => (
              <DeploymentCard key={d.id} deployment={d} />
            ))}
          </div>
        )}
      </div>

      {/* Data & Portability */}
      <div>
        <h2 className="text-base font-semibold text-ink font-display mb-3">
          Data &amp; portability
        </h2>
        <Card>
          <p className="text-xs text-ink-mut leading-relaxed mb-4">
            Your data is always yours. Your site lives on IPFS, so it is never locked
            in — anyone can fetch it by its content address. You can export a full copy
            of your site and your database any time.
          </p>

          {/* Last backup status */}
          <div className="mb-4 text-xs">
            <span className="text-ink-mut">Database backups: </span>
            {!project.backendService ? (
              <span className="text-ink-mut">
                available once your backend is live
              </span>
            ) : project.backendService.lastBackupStatus === 'STORED' &&
              project.backendService.lastBackupAt ? (
              <span className="text-ink">
                last backup{' '}
                {new Date(project.backendService.lastBackupAt).toLocaleString()}
              </span>
            ) : (
              <span className="text-ink-mut">
                {project.backendService.lastBackupFailureReason ??
                  'no backup recorded yet'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={exportingSite}
              onClick={() => void handleExportSite()}
            >
              {exportingSite ? 'Exporting…' : 'Export site'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={exportingDb}
              onClick={() => void handleExportDb()}
            >
              {exportingDb ? 'Exporting…' : 'Export database'}
            </Button>
          </div>
        </Card>
      </div>

      {/* Danger Zone */}
      <div>
        <h2 className="text-base font-semibold text-ink font-display mb-3">
          Danger zone
        </h2>
        <Card className="border-cherry-500/30">
          <p className="text-sm font-medium text-ink mb-1">Delete this app</p>
          <p className="text-xs text-ink-mut leading-relaxed mb-4">
            This removes your site from IPFS and tears down any backend and database
            for this app. This cannot be undone. Export your site and database first if
            you want to keep a copy.
          </p>

          {!confirmDelete ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmDelete(true)}
            >
              Delete app
            </Button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-ink">
                Type <span className="font-mono font-semibold">{project.name}</span> to
                confirm.
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={project.name}
                className="w-full rounded-lg bg-surface-900 border border-line px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-cherry-500"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={deleting || deleteConfirmText !== project.name}
                  onClick={() => void handleDelete()}
                >
                  {deleting ? 'Deleting…' : 'Permanently delete'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deleting}
                  onClick={() => {
                    setConfirmDelete(false);
                    setDeleteConfirmText('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
