import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import StatTile from '../components/ui/StatTile';
import TierBadge from '../components/ui/TierBadge';
import EmptyState from '../components/ui/EmptyState';
import PageHeader from '../components/ui/PageHeader';
import StorageBar from '../components/dashboard/StorageBar';
import DeploymentCard from '../components/dashboard/DeploymentCard';
import QuickDeploy from '../components/dashboard/QuickDeploy';
import Pirc2Subscription from '../components/dashboard/Pirc2Subscription';
import DomainGateway from '../components/dashboard/DomainGateway';
import Spinner from '../components/ui/Spinner';
import Skeleton from '../components/ui/Skeleton';
import SystemStatusBanner from '../components/SystemStatusBanner';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../providers/AuthProvider';
import { projectsApi, extractApiError } from '../lib/api';
import { Deployment, Project } from '../types';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function statusDotColor(status?: string): string {
  if (status === 'ACTIVE') return 'bg-live';
  if (status === 'FAILED') return 'bg-red-400';
  if (!status) return 'bg-surface-600';
  return 'bg-amber-400';
}

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const { error: toastError } = useToast();

  const loadProjects = useCallback(() => {
    setProjectsError('');
    projectsApi
      .list()
      .then((res) => setProjects((res.data as { projects: Project[] }).projects))
      .catch((err) => {
        const msg = extractApiError(err, 'Could not load your projects. Please refresh.');
        setProjectsError(msg);
        toastError(msg);
      })
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleUpgradeSuccess = useCallback(async () => {
    await refreshUser();
    loadProjects();
  }, [refreshUser, loadProjects]);

  const allDeployments: Deployment[] = projects
    .flatMap((p) => p.deployments ?? [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalDeployments = projects.reduce(
    (acc, p) => acc + (p._count?.deployments ?? p.deployments?.length ?? 0),
    0,
  );

  const handleDeploySuccess = useCallback((_deployment: Deployment) => {
    loadProjects();
  }, [loadProjects]);

  const overSeventy =
    user && user.storageLimit > 0 && user.storageUsed / user.storageLimit > 0.7;

  return (
    <AppShell>
      <SystemStatusBanner />

      {projectsError && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400 flex items-center justify-between gap-3">
          <span>{projectsError}</span>
          <button
            className="shrink-0 inline-flex items-center min-h-[44px] px-2 text-xs font-medium underline"
            onClick={loadProjects}
          >
            Retry
          </button>
        </div>
      )}

      <PageHeader
        title={`Welcome${user?.username ? `, ${user.username}` : ''}`}
        subtitle="Deploy your static sites to the permanent web."
      />

      {/* Stat grid — two confident numbers */}
      <div className="grid grid-cols-2 gap-4 animate-fade-in" style={{ animationDelay: '50ms' }}>
        <StatTile label="Projects" value={projects.length} isLoading={isLoading} />
        <StatTile label="Deployments" value={totalDeployments} isLoading={isLoading} />
      </div>

      {/* Plan & usage */}
      {user && (
        <Card>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-ink">Plan &amp; usage</h2>
            <TierBadge tier={user.tier ?? 'FREE'} />
          </div>
          <StorageBar used={user.storageUsed} limit={user.storageLimit} />
          {user.tier === 'FREE' && (
            <div className="mt-5 flex items-center justify-between gap-3">
              {overSeventy ? (
                <p className="text-xs text-amber-400">You&apos;re close to your free limit.</p>
              ) : (
                <p className="text-xs text-ink-mut">More storage &amp; Pi domains on paid plans.</p>
              )}
              <Link to="/account" className="shrink-0">
                <Button size="sm">Upgrade</Button>
              </Link>
            </div>
          )}
        </Card>
      )}

      {/* Quick deploy — the hero / primary action */}
      <section>
        <Card className="border-cherry-500/25 shadow-gold-sm">
          <div className="flex items-start gap-3 mb-5">
            <span className="shrink-0 flex items-center justify-center w-11 h-11 rounded-2xl bg-cherry-gradient text-surface-950 shadow-gold-sm">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-ink font-display leading-tight">Quick deploy</h2>
              <p className="text-ink-mut text-sm mt-0.5">
                Drop a <span className="font-mono text-ink">.zip</span> or a folder to publish in seconds.
              </p>
            </div>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : (
            <QuickDeploy projects={projects} onDeploySuccess={handleDeploySuccess} />
          )}
        </Card>
      </section>

      {/* Subscription + domain features */}
      <Pirc2Subscription onChange={handleUpgradeSuccess} />
      <DomainGateway projects={projects} />

      {/* Recent projects */}
      <section className="animate-fade-in" style={{ animationDelay: '150ms' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-ink font-display tracking-tight">Projects</h2>
          {projects.length > 0 && (
            <Link to="/projects" className="text-ink-mut text-sm hover:text-ink transition-colors px-2 py-1">
              View all
            </Link>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <Skeleton className="h-5 w-32 mb-2.5" />
                <Skeleton className="h-3 w-40" />
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
              </svg>
            }
            title="No projects yet"
            description="Create a project, then drop your files into the deploy zone above to go live."
            action={
              <Link to="/projects" className="block w-full">
                <Button className="w-full justify-center">Create project</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {projects.slice(0, 6).map((project) => {
              const latestDeploy = project.deployments?.[0];
              const count = project._count?.deployments ?? project.deployments?.length ?? 0;
              return (
                <Link key={project.id} to={`/projects/${project.id}`} className="block">
                  <Card className="hover:border-cherry-500/40 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className={`shrink-0 w-2 h-2 rounded-full ${statusDotColor(latestDeploy?.status)}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-semibold text-ink truncate">{project.name}</h3>
                          {latestDeploy && (
                            <Badge
                              variant={
                                latestDeploy.status === 'ACTIVE'
                                  ? 'success'
                                  : latestDeploy.status === 'FAILED'
                                    ? 'error'
                                    : 'warning'
                              }
                            >
                              {latestDeploy.status}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-ink-mut">
                          <span className="font-mono">{count} deploy{count !== 1 ? 's' : ''}</span>
                          {latestDeploy && (
                            <>
                              <span className="text-surface-600">·</span>
                              <span>{relativeTime(latestDeploy.createdAt)}</span>
                            </>
                          )}
                          {project.customDomain && (
                            <>
                              <span className="text-surface-600">·</span>
                              <span className="font-mono text-cherry-300 truncate">{project.customDomain}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <svg className="shrink-0 text-ink-mut" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Deployment history */}
      {allDeployments.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-ink font-display mb-4 flex items-center gap-2.5">
            Deployment history
            <Badge variant="default">{allDeployments.length}</Badge>
          </h2>
          <div className="space-y-3">
            {allDeployments.slice(0, 10).map((d) => (
              <DeploymentCard key={d.id} deployment={d} />
            ))}
          </div>
          {allDeployments.length > 10 && (
            <p className="mt-5 text-center text-ink-mut text-sm">
              Showing 10 of {allDeployments.length}.{' '}
              <Link to="/projects" className="text-ink underline">
                Browse projects →
              </Link>
            </p>
          )}
        </section>
      )}
    </AppShell>
  );
}
