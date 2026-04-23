import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import StorageBar from '../components/dashboard/StorageBar';
import Spinner from '../components/ui/Spinner';
import { useAuth } from '../providers/AuthProvider';
import { projectsApi } from '../lib/api';
import { Project } from '../types';

export default function Dashboard() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    projectsApi
      .list()
      .then((res) => setProjects((res.data as { projects: Project[] }).projects))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const recentDeployment = projects
    .flatMap((p) => p.deployments ?? [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">
                Welcome back{user?.username ? `, ${user.username}` : ''}! 👋
              </h1>
              <p className="text-surface-400 text-sm mt-1">
                Here's what's happening with your projects.
              </p>
            </div>
            <Link to="/deploy">
              <Button leftIcon={<span>🚀</span>}>Deploy</Button>
            </Link>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <p className="text-surface-400 text-xs uppercase tracking-wider mb-1">Projects</p>
              <p className="text-3xl font-bold text-white">{projects.length}</p>
            </Card>
            <Card>
              <p className="text-surface-400 text-xs uppercase tracking-wider mb-1">Total Deployments</p>
              <p className="text-3xl font-bold text-white">
                {projects.reduce((a, p) => a + (p._count?.deployments ?? p.deployments?.length ?? 0), 0)}
              </p>
            </Card>
            <Card>
              <p className="text-surface-400 text-xs uppercase tracking-wider mb-1">Plan</p>
              <div className="mt-1">
                <Badge variant={user?.tier === 'PREMIUM' ? 'premium' : 'default'}>
                  {user?.tier ?? 'FREE'}
                </Badge>
                {user?.tier === 'FREE' && (
                  <Link to="/pricing" className="ml-2 text-xs text-cherry-400 hover:text-cherry-300">
                    Upgrade →
                  </Link>
                )}
              </div>
            </Card>
          </div>

          {/* Storage */}
          {user && (
            <Card>
              <h2 className="text-sm font-medium text-white mb-4">Storage</h2>
              <StorageBar used={user.storageUsed} limit={user.storageLimit} />
              {user.tier === 'FREE' && user.storageUsed / user.storageLimit > 0.7 && (
                <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400">
                  You're approaching your free storage limit.{' '}
                  <Link to="/pricing" className="underline">Upgrade to Premium</Link> for 10 GB.
                </div>
              )}
            </Card>
          )}

          {/* Recent project */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Recent Projects</h2>
              <Link to="/projects" className="text-cherry-400 hover:text-cherry-300 text-sm transition-colors">
                View all →
              </Link>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : projects.length === 0 ? (
              <Card className="text-center py-12">
                <p className="text-4xl mb-3">📦</p>
                <p className="text-white font-medium mb-2">No projects yet</p>
                <p className="text-surface-400 text-sm mb-5">
                  Deploy your first site to get started.
                </p>
                <Link to="/deploy">
                  <Button>🚀 Deploy now</Button>
                </Link>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {projects.slice(0, 4).map((project) => (
                  <Link key={project.id} to={`/projects/${project.id}`}>
                    <Card className="h-full hover:border-cherry-500/40">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <h3 className="font-medium text-white truncate">{project.name}</h3>
                        {project.deployments?.[0] && (
                          <Badge
                            variant={
                              project.deployments[0].status === 'ACTIVE'
                                ? 'success'
                                : project.deployments[0].status === 'FAILED'
                                ? 'error'
                                : 'warning'
                            }
                          >
                            {project.deployments[0].status}
                          </Badge>
                        )}
                      </div>
                      {project.description && (
                        <p className="text-surface-400 text-sm truncate mb-3">{project.description}</p>
                      )}
                      <p className="text-surface-500 text-xs">
                        {project._count?.deployments ?? project.deployments?.length ?? 0} deployment
                        {(project._count?.deployments ?? project.deployments?.length ?? 0) !== 1 ? 's' : ''}
                      </p>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Most recent deployment */}
          {recentDeployment && (
            <Card>
              <h2 className="text-sm font-medium text-white mb-3">Latest Deployment</h2>
              <div className="font-mono text-xs text-surface-400 space-y-1">
                <p>CID: <span className="text-cherry-400">{recentDeployment.cid || '—'}</span></p>
                {recentDeployment.gateway && (
                  <p>
                    URL:{' '}
                    <a
                      href={recentDeployment.gateway}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cherry-400 hover:text-cherry-300 underline"
                    >
                      {recentDeployment.gateway}
                    </a>
                  </p>
                )}
                <p>Status: <Badge variant={recentDeployment.status === 'ACTIVE' ? 'success' : 'warning'}>{recentDeployment.status}</Badge></p>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
