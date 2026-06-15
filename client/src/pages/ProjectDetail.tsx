import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import DeploymentCard from '../components/dashboard/DeploymentCard';
import { useToast } from '../components/ui/Toast';
import { projectsApi, deploymentsApi } from '../lib/api';
import { Project, Deployment } from '../types';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { success } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

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
    </AppShell>
  );
}
