import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import StatTile from '../components/ui/StatTile';
import TierBadge from '../components/ui/TierBadge';
import EmptyState from '../components/ui/EmptyState';
import StorageBar from '../components/dashboard/StorageBar';
import DeploymentCard from '../components/dashboard/DeploymentCard';
import QuickDeploy from '../components/dashboard/QuickDeploy';
import Pirc2Subscription from '../components/dashboard/Pirc2Subscription';
import DomainGateway from '../components/dashboard/DomainGateway';
import Spinner from '../components/ui/Spinner';
import Skeleton from '../components/ui/Skeleton';
import SystemStatusBanner from '../components/SystemStatusBanner';
import { useAuth } from '../providers/AuthProvider';
import { projectsApi } from '../lib/api';
import { Deployment, Project } from '../types';
import { formatBytes } from '../lib/format';

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadProjects = useCallback(() => {
    projectsApi
      .list()
      .then((res) => setProjects((res.data as { projects: Project[] }).projects))
      .catch(console.error)
      .finally(() => setIsLoading(false));
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

  return (
    <AppShell>
      <SystemStatusBanner />

      {/* Greeting */}
      <div>
        <h1 className="text-xl font-bold text-ink tracking-tight">
          Welcome back{user?.username ? `, ${user.username}` : ''}
        </h1>
        <p className="text-ink-mut text-sm mt-0.5">
          Drop your build below for an instant deploy.
        </p>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Projects"
          value={projects.length}
          isLoading={isLoading}
        />
        <StatTile
          label="Deployments"
          value={totalDeployments}
          isLoading={isLoading}
        />
        <StatTile
          label="Plan"
          value={<TierBadge tier={user?.tier ?? 'FREE'} />}
          sub={
            user?.tier === 'FREE' ? (
              <Link to="/account" className="text-ink underline">
                Upgrade →
              </Link>
            ) : undefined
          }
        />
        <StatTile
          label="Storage"
          mono
          value={user ? formatBytes(user.storageUsed) : undefined}
          sub={user ? `of ${formatBytes(user.storageLimit)}` : undefined}
          isLoading={isLoading}
        />
      </div>

      {/* Quick deploy — primary action */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-ink font-display">Quick deploy</h2>
          <span className="text-xs text-ink-mut">
            Drop a <span className="font-mono text-ink">.zip</span> or files
          </span>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <QuickDeploy projects={projects} onDeploySuccess={handleDeploySuccess} />
        )}
      </Card>

      {/* Subscription + storage stack */}
      <Pirc2Subscription onChange={handleUpgradeSuccess} />
      <DomainGateway projects={projects} />

      {user && (
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Storage usage</h2>
          <StorageBar used={user.storageUsed} limit={user.storageLimit} />
          {user.tier === 'FREE' &&
            user.storageLimit > 0 &&
            user.storageUsed / user.storageLimit > 0.7 && (
              <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400">
                You're approaching your free storage limit.{' '}
                <Link to="/account" className="underline">
                  Upgrade
                </Link>{' '}
                for more space.
              </div>
            )}
        </Card>
      )}

      {/* Recent projects */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-ink font-display">Projects</h2>
          <Link to="/projects" className="text-ink-mut text-sm hover:text-ink transition-colors">
            View all →
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-3 w-40" />
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
              </svg>
            }
            title="No projects yet"
            description="Create a project, then drop your files into the deploy zone above."
            action={
              <Link to="/projects">
                <Button>Create a project</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {projects.slice(0, 6).map((project) => {
              const latestDeploy = project.deployments?.[0];
              const count = project._count?.deployments ?? project.deployments?.length ?? 0;
              return (
                <Link key={project.id} to={`/projects/${project.id}`}>
                  <Card className="hover:border-gold/40 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="font-medium text-ink truncate">{project.name}</h3>
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
                    {project.description && (
                      <p className="text-ink-mut text-xs truncate mb-1">{project.description}</p>
                    )}
                    <p className="text-ink-mut text-xs font-mono">
                      {count} deployment{count !== 1 ? 's' : ''}
                    </p>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Deployment history */}
      {allDeployments.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-ink font-display mb-3 flex items-center gap-2">
            Deployment history
            <Badge variant="default">{allDeployments.length}</Badge>
          </h2>
          <div className="space-y-3">
            {allDeployments.slice(0, 10).map((d) => (
              <DeploymentCard key={d.id} deployment={d} />
            ))}
          </div>
          {allDeployments.length > 10 && (
            <p className="mt-4 text-center text-ink-mut text-sm">
              Showing 10 of {allDeployments.length}.{' '}
              <Link to="/projects" className="text-ink underline">
                Browse projects →
              </Link>
            </p>
          )}
        </div>
      )}
    </AppShell>
  );
}
