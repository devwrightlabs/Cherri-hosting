import { useState, useEffect } from 'react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import { PI_DOMAIN_PORTAL_URL } from '../../lib/constants';
import { openExternal } from '../../lib/openExternal';
import { projectsApi } from '../../lib/api';
import { Project } from '../../types';
import { useAuth } from '../../providers/AuthProvider';
import { useToast } from '../ui/Toast';

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
  const { success, error } = useToast();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [domain, setDomain] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  // Projects that already have a domain recorded (for display).
  const [localMappings, setLocalMappings] = useState<Record<string, string>>({});

  // `projects` arrives empty then populates after the Dashboard fetch, so keep
  // the selection and recorded-domain cache in sync as it changes. Saved
  // domains are persisted to the server, so resetting from server data on a
  // refetch never loses an optimistic edit.
  useEffect(() => {
    setSelectedProjectId((prev) =>
      prev && projects.some((p) => p.id === prev) ? prev : (projects[0]?.id ?? ''),
    );
    setLocalMappings(
      Object.fromEntries(
        projects.filter((p) => p.customDomain).map((p) => [p.id, p.customDomain!]),
      ),
    );
  }, [projects]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  // The Dashboard fetch returns only the latest deployment per project.
  const latest = selectedProject?.deployments?.[0];

  const tierLimit = TIER_DOMAIN_LIMITS[user?.tier ?? 'FREE'] ?? 1;
  const mappedCount = Object.keys(localMappings).length;
  const canMapMore = tierLimit === -1 || mappedCount < tierLimit;

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      success(`${label} copied`);
    } catch {
      error('Could not copy — select the text and copy it manually.');
    }
  };

  const handleSaveMapping = async () => {
    if (!selectedProjectId || !domain.trim()) return;
    setIsSaving(true);
    setSaveError('');
    setSaveSuccess('');

    try {
      await projectsApi.update(selectedProjectId, { customDomain: domain.trim() });
      setLocalMappings((prev) => ({ ...prev, [selectedProjectId]: domain.trim() }));
      // Honest copy: saving only records the domain here. The live connection
      // is made in Pi's portal (step 3) — we never imply it is connected yet.
      setSaveSuccess(`Saved ${domain.trim()} to this project. Finish connecting it in step 3.`);
      setDomain('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save domain.';
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
      setSaveError('Failed to remove domain.');
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">🌐</span>
        <h2 className="text-sm font-semibold text-white">Connect a Pi domain</h2>
      </div>
      <p className="text-surface-500 text-xs leading-relaxed mb-4">
        Take your site to a <span className="font-mono">.pi</span> address in three steps.
        Pi Network controls <span className="font-mono">.pi</span> domains, so the final
        link-up happens in Pi's domain portal — not here.
      </p>

      {/* Step 1 — Win a domain at Pi's auction */}
      <div className="mb-4">
        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
          Step 1 — Win your domain
        </p>
        <p className="text-surface-400 text-xs leading-relaxed mb-3">
          Domains are bought at Pi Network's official auction — Sherry doesn't sell them.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-center"
          onClick={() => openExternal(PI_DOMAIN_PORTAL_URL)}
        >
          Browse domain auctions on Pi →
        </Button>
      </div>

      {/* Step 2 — Copy your site's live address */}
      <div className="border-t border-surface-700/40 pt-4 mb-4">
        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
          Step 2 — Copy your site address
        </p>
        <p className="text-surface-400 text-xs leading-relaxed mb-3">
          Pick the project you want on your domain, then copy its deployment address.
        </p>

        {projects.length === 0 ? (
          <p className="text-surface-500 text-xs">Create and deploy a project first.</p>
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

            {latest?.gateway ? (
              <div className="bg-surface-800/60 border border-surface-700/60 rounded-lg p-2.5 space-y-2">
                {latest.status !== 'ACTIVE' && (
                  <p className="text-amber-400 text-xs">
                    This deployment is {latest.status.toLowerCase()} — wait until it's live
                    before pointing your domain at it.
                  </p>
                )}
                <div>
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">
                    Latest deployment address
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink break-all min-w-0 flex-1">
                      {latest.gateway}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copy(latest.gateway, 'Address')}
                      className="text-cherry-400 hover:text-cherry-300 text-xs flex-shrink-0"
                    >
                      Copy
                    </button>
                  </div>
                </div>
                {latest.cid && (
                  <div className="border-t border-surface-700/40 pt-2">
                    <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">
                      Content id (CID)
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-surface-400 break-all min-w-0 flex-1">
                        ipfs://{latest.cid}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copy(latest.cid, 'CID')}
                        className="text-cherry-400 hover:text-cherry-300 text-xs flex-shrink-0"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-amber-400 text-xs">
                This project has no deployment yet. Deploy it first to get an address to point
                your domain at.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Step 3 — Point the domain in Pi's portal (manual, Pi-controlled) */}
      <div className="border-t border-surface-700/40 pt-4 mb-4">
        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
          Step 3 — Point it in Pi's portal
        </p>
        <p className="text-surface-400 text-xs leading-relaxed mb-3">
          Open your domain in Pi's portal and use the address from step 2 as its target,
          following Pi's instructions there. Sherry serves your site over HTTPS at that
          address; how a <span className="font-mono">.pi</span> domain resolves to it — and any{' '}
          <span className="font-mono">.pi</span> certificate — is controlled by Pi Network, not
          Sherry.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-center"
          onClick={() => openExternal(PI_DOMAIN_PORTAL_URL)}
        >
          Open Pi domain portal →
        </Button>
      </div>

      {/* Optional — record the domain on the project for your dashboard */}
      <div className="border-t border-surface-700/40 pt-4 mb-4">
        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
          Optional — label it here
        </p>
        <p className="text-surface-400 text-xs leading-relaxed mb-3">
          Save the domain so it shows on your project. This is a label for your dashboard — it
          doesn't connect anything on its own.
        </p>
        {projects.length > 0 && (
          <div className="space-y-2.5">
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveMapping(); }}
              placeholder="your-domain.pi"
              disabled={!canMapMore}
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-white text-xs placeholder-surface-500 focus:outline-none focus:border-cherry-500 disabled:opacity-50 font-mono"
            />

            {!canMapMore && (
              <p className="text-amber-400 text-xs">
                {tierLimit === 1
                  ? 'Your plan allows 1 domain. Upgrade to label more.'
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
              Save domain
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

      {/* Recorded domains list */}
      {Object.keys(localMappings).length > 0 && (
        <div className="border-t border-surface-700/40 pt-4">
          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
            Saved domains
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
