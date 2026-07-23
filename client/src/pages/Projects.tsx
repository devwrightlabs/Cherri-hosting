import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import PageHeader from '../components/ui/PageHeader';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { projectsApi, extractApiError } from '../lib/api';
import { Project } from '../types';

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

function CreateProjectSheet({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { success } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await projectsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onCreate((res.data as { project: Project }).project);
      success('Project created');
      onClose();
    } catch (err) {
      setError(extractApiError(err, 'We could not create the project. Try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-900 border border-hairline rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] shadow-sheet animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-surface-700 mx-auto mb-6 sm:hidden" />
        <h2 className="text-2xl font-bold text-ink font-display mb-6 tracking-tight">New project</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="Project Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-awesome-site"
            className="font-mono"
            maxLength={80}
            autoFocus
            required
          />
          <div>
            <label className="block text-xs font-semibold tracking-wide uppercase text-ink-mut mb-2">
              Description (Optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              className="w-full bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 text-ink text-sm focus:outline-none focus:border-cherry-500/50 focus:ring-2 focus:ring-cherry-500 focus:ring-offset-2 focus:ring-offset-surface-950 hover:bg-surface-700/50 transition-all duration-200 resize-none"
              rows={3}
              maxLength={500}
            />
          </div>
          {error && <p className="text-red-400 text-xs animate-fade-in">{error}</p>}
          <div className="flex gap-3 pt-2">
            <Button type="submit" isLoading={isLoading} className="flex-1 justify-center">
              Create project
            </Button>
            <Button type="button" variant="secondary" className="flex-1 justify-center" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [showSheet, setShowSheet] = useState(false);
  const { error: toastError } = useToast();

  useEffect(() => {
    projectsApi
      .list()
      .then((res) => setProjects((res.data as { projects: Project[] }).projects))
      .catch((err) => {
        const msg = extractApiError(err, 'Could not load your projects. Please refresh.');
        setListError(msg);
        toastError(msg);
      })
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell>
      <PageHeader
        title="Projects"
        subtitle="Every site you deploy to the permanent web."
        action={
          <Button size="sm" onClick={() => setShowSheet(true)}>
            New
          </Button>
        }
      />

      {listError && !isLoading && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400 flex items-center justify-between gap-3">
          <span>{listError}</span>
          <button
            className="shrink-0 inline-flex items-center min-h-[44px] px-2 text-xs font-medium underline"
            onClick={() => { setListError(''); window.location.reload(); }}
          >
            Retry
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-6 w-32 mb-3" />
              <Skeleton className="h-4 w-44 mb-4" />
              <Skeleton className="h-3 w-24" />
            </Card>
          ))}
        </div>
      ) : listError ? null : projects.length === 0 ? (
        <EmptyState
          icon={
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
            </svg>
          }
          title="No projects yet"
          description="Create your first project to start deploying sites."
          action={<Button onClick={() => setShowSheet(true)} className="w-full justify-center">Create project</Button>}
        />
      ) : (
        <div className="space-y-4">
          {projects.map((project) => {
            const latest = project.deployments?.[0];
            const count = project._count?.deployments ?? project.deployments?.length ?? 0;
            return (
              <Link key={project.id} to={`/projects/${project.id}`} className="block">
                <Card className="hover:border-cherry-500/40 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${statusDotColor(latest?.status)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-ink truncate">{project.name}</h3>
                        {latest && (
                          <Badge
                            variant={
                              latest.status === 'ACTIVE'
                                ? 'success'
                                : latest.status === 'FAILED'
                                  ? 'error'
                                  : 'warning'
                            }
                          >
                            {latest.status}
                          </Badge>
                        )}
                      </div>
                      {project.description && (
                        <p className="text-ink-mut text-sm mt-1 line-clamp-1">{project.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-xs text-ink-mut">
                        <span className="font-mono">
                          {count} deploy{count !== 1 ? 's' : ''}
                        </span>
                        <span className="text-surface-600">·</span>
                        <span>
                          {latest ? relativeTime(latest.createdAt) : new Date(project.updatedAt).toLocaleDateString()}
                        </span>
                        {project.customDomain && (
                          <>
                            <span className="text-surface-600">·</span>
                            <span className="font-mono text-cherry-300 truncate min-w-0">{project.customDomain}</span>
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

      {showSheet && (
        <CreateProjectSheet
          onClose={() => setShowSheet(false)}
          onCreate={(p) => setProjects((prev) => [p, ...prev])}
        />
      )}
    </AppShell>
  );
}
