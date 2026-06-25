import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Skeleton from '../components/ui/Skeleton';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../components/ui/Toast';
import { projectsApi, extractApiError } from '../lib/api';
import { Project } from '../types';

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
        className="bg-surface-900 border border-hairline rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-sheet animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-surface-700 mx-auto mb-4 sm:hidden" />
        <h2 className="text-lg font-bold text-ink font-display mb-4">New project</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-ink-mut mb-1.5">Project name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-site"
              className="w-full bg-surface-800 border border-hairline rounded-lg px-3 py-2.5 text-ink text-sm font-mono focus:outline-none focus:border-gold transition-colors"
              maxLength={80}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm text-ink-mut mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              className="w-full bg-surface-800 border border-hairline rounded-lg px-3 py-2.5 text-ink text-sm focus:outline-none focus:border-gold transition-colors resize-none"
              rows={3}
              maxLength={500}
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-1">
            <Button type="submit" isLoading={isLoading} className="flex-1 justify-center">
              Create project
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink font-display tracking-tight">Projects</h1>
        <Button size="sm" onClick={() => setShowSheet(true)}>
          New project
        </Button>
      </div>

      {listError && !isLoading && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400 flex items-center justify-between gap-3">
          <span>{listError}</span>
          <button
            className="shrink-0 text-xs underline"
            onClick={() => { setListError(''); window.location.reload(); }}
          >
            Retry
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-3 w-44 mb-3" />
              <Skeleton className="h-3 w-24" />
            </Card>
          ))}
        </div>
      ) : listError ? null : projects.length === 0 ? (
        <EmptyState
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
            </svg>
          }
          title="No projects yet"
          description="Create a project to start deploying sites to the permanent web."
          action={<Button onClick={() => setShowSheet(true)}>Create a project</Button>}
        />
      ) : (
        <div className="space-y-3">
          {projects.map((project) => {
            const latest = project.deployments?.[0];
            const count = project._count?.deployments ?? project.deployments?.length ?? 0;
            return (
              <Link key={project.id} to={`/projects/${project.id}`}>
                <Card className="hover:border-gold/40 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
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
                    <p className="text-ink-mut text-sm mb-3 line-clamp-2">{project.description}</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-ink-mut pt-3 border-t border-hairline">
                    <span className="font-mono">
                      {count} deployment{count !== 1 ? 's' : ''}
                    </span>
                    <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
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
