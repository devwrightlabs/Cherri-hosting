import { useState } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { PI_DOMAIN_PORTAL_URL } from '../../lib/constants';
import { projectsApi } from '../../lib/api';
import { Project } from '../../types';
import { useAuth } from '../../providers/AuthProvider';

interface DomainGatewayProps {
  projects: Project[];
}

const TIER_DOMAIN_LIMITS: Record<string, number> = {
  FREE: 1,
  TIER1: 1,
  TIER2: 5,
  TIER3: -1,
  TIER4: -1,
  PREMIUM: 5,
};

export default function DomainGateway({ projects }: DomainGatewayProps) {
  const { user } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? '');
  const [domain, setDomain] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  // Projects that already have a domain mapped (for display).
  const [localMappings, setLocalMappings] = useState<Record<string, string>>(
    Object.fromEntries(
      projects
        .filter((p) => p.customDomain)
        .map((p) => [p.id, p.customDomain!]),
    ),
  );

  const tierLimit = TIER_DOMAIN_LIMITS[user?.tier ?? 'FREE'] ?? 1;
  const mappedCount = Object.keys(localMappings).length;
  const canMapMore = tierLimit === -1 || mappedCount < tierLimit;

  const handleSaveMapping = async () => {
    if (!selectedProjectId || !domain.trim()) return;
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');

    try {
      await projectsApi.update(selectedProjectId, { customDomain: domain.trim() });
      setLocalMappings((prev) => ({ ...prev, [selectedProjectId]: domain.trim() }));
      setSaveSuccess(`Domain "${domain.trim()}" mapped successfully.`);
      setDomain('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save domain mapping.';
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveMapping = async (projectId: string) => {
    try {
      await projectsApi.update(projectId, { customDomain: '' });
      setLocalMappings((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
    } catch {
      setSaveError('Failed to remove mapping.');
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🌐</span>
        <h2 className="text-sm font-semibold text-white">Custom Pi Domain</h2>
      </div>

      {/* Step 1 — Acquire on Pi Network */}
      <div className="mb-4">
        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
          Step 1 — Acquire your domain
        </p>
        <p className="text-surface-400 text-xs leading-relaxed mb-3">
          Domains are purchased through Pi Network's official auction — Sherry doesn't sell domains.
          Win a domain there, then map it to your deployment here.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-center"
          onClick={() => { window.location.href = PI_DOMAIN_PORTAL_URL; }}
        >
          Browse domain auctions on Pi →
        </Button>
      </div>

      <div className="border-t border-surface-700/40 pt-4 mb-4">
        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-3">
          Step 2 — Map it to a project
        </p>

        {projects.length === 0 ? (
          <p className="text-surface-500 text-xs">Create a project first to map a domain.</p>
        ) : (
          <div className="space-y-2.5">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cherry-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{localMappings[p.id] ? ` → ${localMappings[p.id]}` : ''}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveMapping(); }}
              placeholder="your-domain.pi"
              disabled={!canMapMore}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-white text-xs placeholder-surface-500 focus:outline-none focus:border-cherry-500 disabled:opacity-50"
            />

            {!canMapMore && (
              <p className="text-amber-400 text-xs">
                {tierLimit === 1
                  ? 'Your plan allows 1 domain. Upgrade to map more.'
                  : `You've reached the ${tierLimit}-domain limit for your plan.`}
              </p>
            )}

            <Button
              size="sm"
              className="w-full justify-center"
              disabled={!domain.trim() || !selectedProjectId || !canMapMore}
              isLoading={isSaving}
              onClick={() => void handleSaveMapping()}
            >
              Save mapping
            </Button>
          </div>
        )}

        {saveSuccess && (
          <p className="text-emerald-400 text-xs mt-2">{saveSuccess}</p>
        )}
        {saveError && (
          <p className="text-red-400 text-xs mt-2">{saveError}</p>
        )}
      </div>

      {/* Current mappings list */}
      {Object.keys(localMappings).length > 0 && (
        <div className="border-t border-surface-700/40 pt-4">
          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
            Active mappings
          </p>
          <div className="space-y-1.5">
            {Object.entries(localMappings).map(([projectId, mappedDomain]) => {
              const project = projects.find((p) => p.id === projectId);
              return (
                <div
                  key={projectId}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <span className="text-surface-300 truncate block font-mono">
                      {mappedDomain}
                    </span>
                    <span className="text-surface-500">{project?.name ?? projectId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemoveMapping(projectId)}
                    className="text-surface-600 hover:text-red-400 transition-colors flex-shrink-0 text-xs"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
