/**
 * The single master "GO-LIVE" switch for the backend lane (WOODSTICK 3 Phases
 * 2-7) and its per-capability readiness.
 *
 * ONE flag (GoLiveConfig.goLiveEnabled) turns the whole backend lane from inert
 * to live. But the flag ALONE never makes a capability "ready": each capability
 * also requires its own real-world keys/config, so flipping the switch on a host
 * that is missing (say) the snapshot store can never fake a snapshot or start
 * billing for it. Every consumer must check the capability it needs via
 * isCapabilityEnabled() / goLiveReadiness() and, when it is NOT enabled, take the
 * honest inert path (503 / *_PENDING / real error) — never fake success.
 *
 * An env kill switch (BACKEND_LANE_HARD_DISABLE=true) force-disables everything
 * regardless of the DB flag, for emergency operator use.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prismaClient';
import {
  isRailwayConfigured,
  isBackendTemplateConfigured,
  isSnapshotStoreConfigured,
  isSnapshotEncryptionConfigured,
  isPinataConfigured,
} from '../utils/integrations';
import { getCostControlConfig } from './costControlService';

export const GO_LIVE_CONFIG_ID = 'singleton';

export type CapabilityKey =
  | 'provisioning'
  | 'envWiring'
  | 'metering'
  | 'dormancyDetection'
  | 'dormancySnapshotDelete'
  // Phase 10: non-destructive periodic DB backups (data safety). Needs a private
  // encrypted store + a live DB to dump, but NOT the destructive operator
  // snapshotDeleteEnabled flag, a backend template, or paid attestation.
  | 'databaseBackups'
  // Phase 10: tearing down provider resources on app deletion. Needs only the
  // cleanup credentials (Railway token + Pinata) — deliberately NOT gated on
  // provisioning's template/paid-attestation, so an owner can always delete
  // their app and stop billing the operator even if provisioning is off.
  | 'providerTeardown';

export interface CapabilityReadiness {
  enabled: boolean;
  blockedReason: string | null;
  /** Human-readable required keys/config that are still missing. */
  missing: string[];
}

export interface GoLiveReadiness {
  /** The DB master flag AND not hard-disabled. */
  masterEnabled: boolean;
  /** Whether the env kill switch is engaged. */
  hardDisabled: boolean;
  /** Operator attestation that the Railway account is paid. */
  railwayPaidAttested: boolean;
  capabilities: Record<CapabilityKey, CapabilityReadiness>;
}

/** Fetch the singleton GO-LIVE config, creating it (OFF) on first access. */
export async function getGoLiveConfig() {
  return prisma.goLiveConfig.upsert({
    where: { id: GO_LIVE_CONFIG_ID },
    update: {},
    create: { id: GO_LIVE_CONFIG_ID },
  });
}

export interface GoLiveConfigPatch {
  goLiveEnabled?: boolean;
  railwayPaidAttestation?: boolean;
}

export async function updateGoLiveConfig(patch: GoLiveConfigPatch) {
  const data: Prisma.GoLiveConfigUpdateInput = {};
  if (patch.goLiveEnabled !== undefined) {
    data.goLiveEnabled = Boolean(patch.goLiveEnabled);
  }
  if (patch.railwayPaidAttestation !== undefined) {
    data.railwayPaidAttestation = Boolean(patch.railwayPaidAttestation);
  }
  await getGoLiveConfig(); // ensure the row exists
  return prisma.goLiveConfig.update({
    where: { id: GO_LIVE_CONFIG_ID },
    data,
  });
}

/** True when the operator-only env kill switch is engaged. */
export function isHardDisabled(): boolean {
  return process.env.BACKEND_LANE_HARD_DISABLE?.trim() === 'true';
}

interface Requirement {
  label: string;
  ok: boolean;
}

function evalCapability(
  masterEnabled: boolean,
  hardDisabled: boolean,
  requirements: Requirement[],
): CapabilityReadiness {
  const missing = requirements.filter((r) => !r.ok).map((r) => r.label);
  if (hardDisabled) {
    return {
      enabled: false,
      blockedReason: 'Backend lane is hard-disabled (BACKEND_LANE_HARD_DISABLE=true)',
      missing,
    };
  }
  if (!masterEnabled) {
    return {
      enabled: false,
      blockedReason: 'GO-LIVE master switch is OFF',
      missing,
    };
  }
  if (missing.length > 0) {
    return {
      enabled: false,
      blockedReason: `Missing required config: ${missing.join(', ')}`,
      missing,
    };
  }
  return { enabled: true, blockedReason: null, missing: [] };
}

/**
 * Compute the full readiness picture for the backend lane. Each capability is
 * enabled only when the master switch is on AND its specific real-world
 * dependencies are present. Used by routes/services to decide live vs inert.
 */
export async function goLiveReadiness(): Promise<GoLiveReadiness> {
  const [config, costConfig] = await Promise.all([
    getGoLiveConfig(),
    getCostControlConfig(),
  ]);
  const hardDisabled = isHardDisabled();
  const masterEnabled = config.goLiveEnabled && !hardDisabled;

  const railwayOk = isRailwayConfigured();
  const paidOk = config.railwayPaidAttestation;
  const templateOk = isBackendTemplateConfigured();

  // Provisioning is the root capability; env wiring depends on it producing a
  // real verified backend URL, so it shares the same prerequisites.
  const provisioningReqs: Requirement[] = [
    { label: 'RAILWAY_API_TOKEN', ok: railwayOk },
    { label: 'Railway paid attestation (operator)', ok: paidOk },
    {
      label: 'backend template (RAILWAY_BACKEND_TEMPLATE_REPO or RAILWAY_BACKEND_IMAGE)',
      ok: templateOk,
    },
  ];

  const provisioning = evalCapability(masterEnabled, hardDisabled, provisioningReqs);
  const envWiring = evalCapability(masterEnabled, hardDisabled, provisioningReqs);
  const metering = evalCapability(masterEnabled, hardDisabled, [
    { label: 'RAILWAY_API_TOKEN', ok: railwayOk },
  ]);
  const dormancyDetection = evalCapability(masterEnabled, hardDisabled, [
    { label: 'RAILWAY_API_TOKEN', ok: railwayOk },
  ]);
  // The only destructive capability — additionally gated on a configured PRIVATE
  // encrypted store. This is the true NEEDS-APPROVAL dependency; until it is set
  // dormant DBs are flagged but never snapshotted/deleted.
  const dormancySnapshotDelete = evalCapability(masterEnabled, hardDisabled, [
    { label: 'RAILWAY_API_TOKEN', ok: railwayOk },
    { label: 'cost-control snapshotDeleteEnabled=true', ok: costConfig.snapshotDeleteEnabled },
    { label: 'SNAPSHOT_STORE_PROVIDER (private store)', ok: isSnapshotStoreConfigured() },
    { label: 'SNAPSHOT_ENCRYPTION_KEY', ok: isSnapshotEncryptionConfigured() },
  ]);

  // Non-destructive backups: a private encrypted store + a way to reach the live
  // DB (Railway token). NOT gated on the destructive snapshotDeleteEnabled flag,
  // a backend template, or paid attestation — preserving data must never depend
  // on the operator having enabled deletion.
  const databaseBackups = evalCapability(masterEnabled, hardDisabled, [
    { label: 'RAILWAY_API_TOKEN', ok: railwayOk },
    { label: 'SNAPSHOT_STORE_PROVIDER (private store)', ok: isSnapshotStoreConfigured() },
    { label: 'SNAPSHOT_ENCRYPTION_KEY', ok: isSnapshotEncryptionConfigured() },
  ]);

  // Provider teardown for deletion: only the cleanup credentials. Deliberately
  // NOT gated on template/paid attestation so an owner can always delete their
  // app and stop billing the operator, regardless of provisioning state.
  const providerTeardown = evalCapability(masterEnabled, hardDisabled, [
    { label: 'RAILWAY_API_TOKEN', ok: railwayOk },
    { label: 'Pinata/IPFS credentials', ok: isPinataConfigured() },
  ]);

  return {
    masterEnabled,
    hardDisabled,
    railwayPaidAttested: paidOk,
    capabilities: {
      provisioning,
      envWiring,
      metering,
      dormancyDetection,
      dormancySnapshotDelete,
      databaseBackups,
      providerTeardown,
    },
  };
}

/** Convenience: is a single capability live-enabled right now? */
export async function isCapabilityEnabled(key: CapabilityKey): Promise<boolean> {
  const readiness = await goLiveReadiness();
  return readiness.capabilities[key].enabled;
}

/**
 * Is the backend lane live at all? True only when the GO-LIVE master switch is on
 * AND the env kill switch is not engaged. Billing loops gate on this so nothing
 * charges/pauses until the operator flips the switch.
 */
export async function isBackendLaneLive(): Promise<boolean> {
  const readiness = await goLiveReadiness();
  return readiness.masterEnabled;
}

/** Convenience: full readiness for a single capability (enabled + reason). */
export async function getCapabilityReadiness(
  key: CapabilityKey,
): Promise<CapabilityReadiness> {
  const readiness = await goLiveReadiness();
  return readiness.capabilities[key];
}
