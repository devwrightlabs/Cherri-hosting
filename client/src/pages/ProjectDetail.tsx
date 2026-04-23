import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import DeploymentCard from '../components/dashboard/DeploymentCard';
import Spinner from '../components/ui/Spinner';
import { projectsApi, deploymentsApi } from '../lib/api';
import { Project, Deployment } from '../types';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      projectsApi.get(id),
      deploymentsApi.listByProject(id),
    ])
      .then(([projRes, deplRes]) => {
        setProject((projRes.data as { project: Project }).project);
        setDeployments((deplRes.data as { deployments: Deployment[] }).deployments);
      })
      .catch(() => setError('Failed to load project'))
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex h-screen overflow-hidden bg-surface-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <Spinner size="lg" />
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-screen overflow-hidden bg-surface-950">
        <Sidebar />
        <main className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-red-400">{error || 'Project not found'}</p>
          <Link to="/projects">
            <Button variant="secondary">← Back to Projects</Button>
          </Link>
        </main>
      </div>
    );
  }

  const activeDeployment = deployments.find((d) => d.status === 'ACTIVE');

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-surface-500 text-sm mb-1">
                <Link to="/projects" className="hover:text-white transition-colors">Projects</Link>
                <span>/</span>
                <span className="text-white">{project.name}</span>
              </div>
              <h1 className="text-2xl font-bold text-white">{project.name}</h1>
              {project.description && (
                <p className="text-surface-400 text-sm mt-1">{project.description}</p>
              )}
            </div>
            <Link to={`/deploy?projectId=${project.id}`}>
              <Button leftIcon={<span>🚀</span>}>New Deploy</Button>
            </Link>
          </div>

          {/* Active deployment info */}
          {activeDeployment && (
            <Card className="border-cherry-500/25">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-slow" />
                <span className="text-sm font-medium text-white">Live deployment</span>
              </div>
              <div className="space-y-2 font-mono text-xs">
                <div className="flex items-start gap-2">
                  <span className="text-surface-500 shrink-0">CID</span>
                  <span className="text-cherry-400 break-all">{activeDeployment.cid}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-surface-500 shrink-0">URL</span>
                  <a
                    href={activeDeployment.gateway}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cherry-400 hover:text-cherry-300 underline break-all"
                  >
                    {activeDeployment.gateway}
                  </a>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <a href={activeDeployment.gateway} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="secondary">Open site ↗</Button>
                </a>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(activeDeployment.gateway);
                  }}
                >
                  Copy URL
                </Button>
              </div>
            </Card>
          )}

          {/* Deployments */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">
              Deployment history
              <Badge variant="default" className="ml-2">{deployments.length}</Badge>
            </h2>
            {deployments.length === 0 ? (
              <Card className="text-center py-10">
                <p className="text-surface-400 text-sm">No deployments yet for this project.</p>
                <Link to={`/deploy?projectId=${project.id}`} className="mt-4 inline-block">
                  <Button>🚀 Deploy now</Button>
                </Link>
              </Card>
            ) : (
              <div className="space-y-3">
                {deployments.map((d) => (
                  <DeploymentCard key={d.id} deployment={d} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
