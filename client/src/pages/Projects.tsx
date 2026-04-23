import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { projectsApi } from '../lib/api';
import { Project } from '../types';

function CreateProjectModal({
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await projectsApi.create({ name: name.trim(), description: description.trim() || undefined });
      onCreate((res.data as { project: Project }).project);
      onClose();
    } catch {
      setError('Failed to create project. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="glass rounded-2xl w-full max-w-md p-6 animate-fade-in">
        <h2 className="text-lg font-bold text-white mb-5">New Project</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-surface-300 mb-1.5">Project name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-awesome-site"
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cherry-500 transition-colors"
              maxLength={80}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-surface-300 mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-cherry-500 transition-colors resize-none"
              rows={3}
              maxLength={500}
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex gap-3 pt-1">
            <Button type="submit" isLoading={isLoading} className="flex-1 justify-center">
              Create Project
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
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    projectsApi
      .list()
      .then((res) => setProjects((res.data as { projects: Project[] }).projects))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">Projects</h1>
            <Button onClick={() => setShowModal(true)} leftIcon={<span>+</span>}>
              New Project
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : projects.length === 0 ? (
            <Card className="text-center py-16">
              <p className="text-4xl mb-3">📦</p>
              <p className="text-white font-medium mb-2">No projects yet</p>
              <p className="text-surface-400 text-sm mb-5">
                Create a project to start deploying sites.
              </p>
              <Button onClick={() => setShowModal(true)}>+ New Project</Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => {
                const latest = project.deployments?.[0];
                return (
                  <Link key={project.id} to={`/projects/${project.id}`}>
                    <Card className="h-full group">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-semibold text-white group-hover:text-cherry-400 transition-colors truncate">
                          {project.name}
                        </h3>
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
                        <p className="text-surface-400 text-sm mb-3 line-clamp-2">
                          {project.description}
                        </p>
                      )}
                      <div className="flex items-center justify-between text-xs text-surface-500 mt-auto pt-3 border-t border-surface-700/50">
                        <span>
                          {project._count?.deployments ?? project.deployments?.length ?? 0} deployment
                          {(project._count?.deployments ?? project.deployments?.length ?? 0) !== 1 ? 's' : ''}
                        </span>
                        <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {showModal && (
        <CreateProjectModal
          onClose={() => setShowModal(false)}
          onCreate={(p) => setProjects((prev) => [p, ...prev])}
        />
      )}
    </div>
  );
}
