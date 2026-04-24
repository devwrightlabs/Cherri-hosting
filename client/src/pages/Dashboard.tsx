import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import StorageBar from '../components/dashboard/StorageBar';
import DeploymentCard from '../components/dashboard/DeploymentCard';
import QuickDeploy from '../components/dashboard/QuickDeploy';
import UpgradeBanner from '../components/dashboard/UpgradeBanner';
import Spinner from '../components/ui/Spinner';
import { useAuth } from '../providers/AuthProvider';
import { projectsApi } from '../lib/api';
import { Deployment, Project } from '../types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

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

  // Refresh user data (e.g. after an upgrade) then reload projects so the
  // UpgradeBanner reflects the updated subscription tier immediately.
  const handleUpgradeSuccess = useCallback(async () => {
    await refreshUser();
    loadProjects();
  }, [refreshUser, loadProjects]);

  // Flatten and sort all deployments across every project, newest first
  const allDeployments: Deployment[] = projects
    .flatMap((p) => p.deployments ?? [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalDeployments = projects.reduce(
    (acc, p) => acc + (p._count?.deployments ?? p.deployments?.length ?? 0),
    0,
  );

  // When a new deployment succeeds, refresh the project list so counts update
  const handleDeploySuccess = useCallback((_deployment: Deployment) => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

          {/* ── Header ── */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">
                Welcome back{user?.username ? `, ${user.username}` : ''}! 👋
              </h1>
              <p className="text-surface-400 text-sm mt-1">
                Drop your build files below for an instant IPFS deployment.
              </p>
            </div>
            <Link to="/projects">
              <Button variant="secondary" size="sm">Manage projects →</Button>
            </Link>
          </div>

          {/* ── Stats row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card>
              <p className="text-surface-400 text-xs uppercase tracking-wider mb-1">Projects</p>
              <p className="text-3xl font-bold text-white">{projects.length}</p>
            </Card>
            <Card>
              <p className="text-surface-400 text-xs uppercase tracking-wider mb-1">Deployments</p>
              <p className="text-3xl font-bold text-white">{totalDeployments}</p>
            </Card>
            <Card>
              <p className="text-surface-400 text-xs uppercase tracking-wider mb-1">Plan</p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <Badge variant={user?.tier === 'PREMIUM' ? 'premium' : 'default'}>
                  {user?.tier ?? 'FREE'}
                </Badge>
                {user?.tier === 'FREE' && (
                  <Link to="/pricing" className="text-xs text-cherry-400 hover:text-cherry-300">
                    Upgrade →
                  </Link>
                )}
              </div>
            </Card>
            <Card>
              <p className="text-surface-400 text-xs uppercase tracking-wider mb-1">Storage</p>
              {user ? (
                <p className="text-white text-sm font-semibold mt-1">
                  {formatBytes(user.storageUsed)}
                  <span className="text-surface-500 font-normal text-xs ml-1">
                    / {formatBytes(user.storageLimit)}
                  </span>
                </p>
              ) : (
                <p className="text-surface-500 text-sm">—</p>
              )}
            </Card>
          </div>

          {/* ── Main two-column layout ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

            {/* Left — 1-Click Deploy (centerpiece) */}
            <div className="lg:col-span-3">
              <Card className="h-full">
                <div className="flex items-center gap-2 mb-5">
                  <span className="text-lg">🚀</span>
                  <h2 className="text-base font-semibold text-white">1-Click Deploy</h2>
                  <span className="ml-auto text-xs text-surface-500">
                    Drag a <span className="font-mono text-cherry-400" aria-label="zip file">.zip</span> or any build files
                  </span>
                </div>

                {isLoading ? (
                  <div className="flex justify-center py-16">
                    <Spinner />
                  </div>
                ) : (
                  <QuickDeploy
                    projects={projects}
                    onDeploySuccess={handleDeploySuccess}
                  />
                )}
              </Card>
            </div>

            {/* Right — Subscription & Storage */}
            <div className="lg:col-span-2 space-y-4">

              {/* Subscription tier / upgrade card */}
              <UpgradeBanner onUpgradeSuccess={handleUpgradeSuccess} />

              {/* Storage bar */}
              {user && (
                <Card>
                  <h2 className="text-sm font-semibold text-white mb-4">Storage Usage</h2>
                  <StorageBar used={user.storageUsed} limit={user.storageLimit} />
                  {user.tier === 'FREE' && user.storageLimit > 0 && user.storageUsed / user.storageLimit > 0.7 && (
                    <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400">
                      You're approaching your free storage limit.{' '}
                      <Link to="/pricing" className="underline">Upgrade to Premium</Link> for 10 GB.
                    </div>
                  )}
                </Card>
              )}

              {/* Quick links */}
              <Card>
                <h2 className="text-sm font-semibold text-white mb-3">Quick Links</h2>
                <div className="space-y-1.5">
                  <Link
                    to="/projects"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
                  >
                    <span>📦</span> All Projects
                  </Link>
                  <Link
                    to="/deploy"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
                  >
                    <span>🚀</span> Full Deploy Page
                  </Link>
                  <Link
                    to="/pricing"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
                  >
                    <span>💎</span> Pricing & Plans
                  </Link>
                </div>
              </Card>
            </div>
          </div>

          {/* ── Recent Projects ── */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Projects</h2>
              <Link
                to="/projects"
                className="text-cherry-400 hover:text-cherry-300 text-sm transition-colors"
              >
                View all →
              </Link>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : projects.length === 0 ? (
              <Card className="text-center py-10">
                <p className="text-4xl mb-3">📦</p>
                <p className="text-white font-medium mb-2">No projects yet</p>
                <p className="text-surface-400 text-sm mb-5">
                  Create a project, then drop your files in the deploy zone above.
                </p>
                <Link to="/projects">
                  <Button>Create a project</Button>
                </Link>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.slice(0, 6).map((project) => {
                  const latestDeploy = project.deployments?.[0];
                  return (
                    <Link key={project.id} to={`/projects/${project.id}`}>
                      <Card className="h-full hover:border-cherry-500/40 transition-colors">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="font-medium text-white truncate">{project.name}</h3>
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
                          <p className="text-surface-400 text-xs truncate mb-2">
                            {project.description}
                          </p>
                        )}
                        <p className="text-surface-500 text-xs">
                          {project._count?.deployments ?? project.deployments?.length ?? 0} deployment
                          {(project._count?.deployments ?? project.deployments?.length ?? 0) !== 1
                            ? 's'
                            : ''}
                        </p>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Deployments History ── */}
          {allDeployments.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  Deployment History
                  <Badge variant="default" className="ml-2">{allDeployments.length}</Badge>
                </h2>
              </div>

              <div className="space-y-3">
                {allDeployments.slice(0, 10).map((d) => (
                  <DeploymentCard key={d.id} deployment={d} />
                ))}
              </div>

              {allDeployments.length > 10 && (
                <p className="mt-4 text-center text-surface-500 text-sm">
                  Showing 10 of {allDeployments.length} deployments.{' '}
                  <Link to="/projects" className="text-cherry-400 hover:text-cherry-300">
                    Browse projects →
                  </Link>
                </p>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
