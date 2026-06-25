/**
 * Railway "landlord" provisioning client.
 *
 * Railway runs the per-app BACKEND services and Postgres databases on the
 * operator's own Railway account. End users never see Railway — to them an app
 * simply "got a backend + database". This module is the single, server-side
 * seam that talks to Railway's public GraphQL API.
 *
 * Honesty rules (match the rest of Cherri):
 *  - Never fake success. Every call surfaces the REAL HTTP status + GraphQL
 *    error messages via `RailwayApiError`, or an honest provider-outage error
 *    on network/timeout. Callers decide how to degrade.
 *  - Missing token → `IntegrationUnavailableError` (routes map this to 503),
 *    never a crash and never a silent no-op.
 *
 * Auth: the configured token is a Railway *team* token, sent as
 * `Authorization: Bearer <token>`. (Team tokens authenticate as the workspace,
 * so the `me` query is intentionally unavailable — we operate at project scope.)
 *
 * Scope note (WOODSTICK 3 phasing): the READ methods (`listProjects`,
 * `getProject`) are verified live in Phase 1. The MUTATION methods
 * (create/provision/deploy/variables/usage/stop/delete) are built against the
 * verified Railway schema but are first EXERCISED live in Phase 2+, because they
 * create real, billable resources on the operator's account.
 *
 * FUTURE OPTIMIZATION (Phase 11, requirement 4 — DO NOT BUILD NOW): if idle
 * Postgres cost or Railway reliability becomes a problem at scale, evaluate
 * moving each app's database to Neon (scale-to-zero Postgres, so an idle DB
 * costs ~nothing without our snapshot/delete dance) and/or introducing
 * multi-provider failover so a single-landlord outage cannot take every backend
 * down at once. This is intentionally deferred — Phase 11 only makes the current
 * single-landlord (Railway) outage path HONEST and self-healing, it does not add
 * a second provider.
 */

import { IntegrationUnavailableError } from '../utils/integrations';
import { logger } from '../utils/logger';

const RAILWAY_API_URL =
  process.env.RAILWAY_API_URL?.trim() || 'https://backboard.railway.com/graphql/v2';

/** Default image used when provisioning a managed Postgres service. */
const DEFAULT_POSTGRES_IMAGE =
  process.env.RAILWAY_POSTGRES_IMAGE?.trim() ||
  'ghcr.io/railwayapp-templates/postgres-ssl:16';

const DEFAULT_TIMEOUT_MS = 20_000;

/** True when the Railway provisioning token is present. */
export function isRailwayConfigured(): boolean {
  return Boolean(process.env.RAILWAY_API_TOKEN?.trim());
}

function railwayToken(): string {
  const token = process.env.RAILWAY_API_TOKEN?.trim();
  if (!token) {
    throw new IntegrationUnavailableError(
      'railway',
      'Backend provisioning is not configured (RAILWAY_API_TOKEN is missing).',
    );
  }
  return token;
}

export interface RailwayGraphQLError {
  message: string;
  path?: (string | number)[];
}

/**
 * Error from the Railway API. `status` is the HTTP status (0 means the request
 * never completed — network error / timeout / DNS, i.e. a provider outage).
 */
export class RailwayApiError extends Error {
  readonly status: number;
  readonly graphqlErrors: RailwayGraphQLError[];
  /** True when the request never reached Railway (outage / timeout). */
  readonly isOutage: boolean;

  constructor(
    message: string,
    status: number,
    graphqlErrors: RailwayGraphQLError[] = [],
  ) {
    super(message);
    this.name = 'RailwayApiError';
    this.status = status;
    this.graphqlErrors = graphqlErrors;
    this.isOutage = status === 0;
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: RailwayGraphQLError[];
}

/**
 * Phase 11 — health observer hook. The status monitor registers a callback here
 * so EVERY real Railway call reports its outcome (reachable vs outage) without
 * railway.ts importing the monitor (which would create an import cycle). A
 * successful call or any HTTP/GraphQL error means Railway answered (reachable);
 * only a network error/timeout (isOutage) means unreachable.
 */
type RailwayOutcomeObserver = (outcome: {
  ok: boolean;
  isOutage: boolean;
  reason?: string;
}) => void;

let outcomeObserver: RailwayOutcomeObserver | null = null;

export function setRailwayOutcomeObserver(
  fn: RailwayOutcomeObserver | null,
): void {
  outcomeObserver = fn;
}

function reportOutcome(ok: boolean, isOutage: boolean, reason?: string): void {
  if (!outcomeObserver) return;
  try {
    outcomeObserver({ ok, isOutage, reason });
  } catch {
    // The monitor must never break a real provider call.
  }
}

/**
 * Execute a GraphQL operation against Railway. Throws `RailwayApiError` on any
 * non-success (HTTP error, GraphQL error, malformed body, network/timeout).
 * Never returns a partial/faked result.
 */
async function railwayRequest<T>(
  query: string,
  variables: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const token = railwayToken();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let resp: Response;
  try {
    resp = await fetch(RAILWAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    const message = aborted
      ? 'Railway API request timed out (backend provider may be experiencing an outage).'
      : 'Railway API was unreachable (backend provider may be experiencing an outage).';
    // Network error / timeout = the provider never answered = outage.
    reportOutcome(false, true, message);
    throw new RailwayApiError(message, 0);
  } finally {
    clearTimeout(timer);
  }

  const text = await resp.text();
  let body: GraphQLResponse<T> | null = null;
  try {
    body = text ? (JSON.parse(text) as GraphQLResponse<T>) : null;
  } catch {
    body = null;
  }

  // Railway answered (any HTTP/GraphQL response) => the provider is REACHABLE,
  // even when it returns an error. Only a network/timeout (above) is an outage.
  if (!resp.ok) {
    reportOutcome(false, false);
    throw new RailwayApiError(
      `Railway API returned HTTP ${resp.status}: ${text.slice(0, 300)}`,
      resp.status,
      body?.errors ?? [],
    );
  }
  if (body?.errors?.length) {
    reportOutcome(false, false);
    throw new RailwayApiError(
      `Railway API error: ${body.errors.map((e) => e.message).join('; ')}`,
      resp.status,
      body.errors,
    );
  }
  if (!body || body.data === undefined || body.data === null) {
    reportOutcome(false, false);
    throw new RailwayApiError(
      'Railway API returned an unexpected response (no data).',
      resp.status,
      body?.errors ?? [],
    );
  }
  reportOutcome(true, false);
  return body.data;
}

// ---------------------------------------------------------------------------
// READ — verified live in Phase 1
// ---------------------------------------------------------------------------

export interface RailwayProject {
  id: string;
  name: string;
  createdAt?: string;
}

/** List the projects this token can see. Used to confirm the connection. */
export async function listProjects(): Promise<RailwayProject[]> {
  const data = await railwayRequest<{
    projects: { edges: { node: RailwayProject }[] };
  }>(`query { projects { edges { node { id name createdAt } } } }`);
  return data.projects.edges.map((e) => e.node);
}

/** Fetch a single project (with its environments + services) by id. */
export async function getProject(projectId: string): Promise<{
  id: string;
  name: string;
  environments: { id: string; name: string }[];
  services: { id: string; name: string }[];
}> {
  const data = await railwayRequest<{
    project: {
      id: string;
      name: string;
      environments: { edges: { node: { id: string; name: string } }[] };
      services: { edges: { node: { id: string; name: string } }[] };
    };
  }>(
    `query getProject($id: String!) {
       project(id: $id) {
         id
         name
         environments { edges { node { id name } } }
         services { edges { node { id name } } }
       }
     }`,
    { id: projectId },
  );
  return {
    id: data.project.id,
    name: data.project.name,
    environments: data.project.environments.edges.map((e) => e.node),
    services: data.project.services.edges.map((e) => e.node),
  };
}

/**
 * Lightweight connection check for operator diagnostics. Returns whether the
 * token is configured and, if so, whether Railway is reachable + the visible
 * project count. Never throws — folds outages into `{ reachable: false }`.
 */
export async function getConnectionStatus(): Promise<{
  configured: boolean;
  reachable: boolean;
  projectCount?: number;
  reason?: string;
}> {
  if (!isRailwayConfigured()) return { configured: false, reachable: false };
  try {
    const projects = await listProjects();
    return { configured: true, reachable: true, projectCount: projects.length };
  } catch (err) {
    const reason =
      err instanceof RailwayApiError ? err.message : (err as Error).message;
    logger.warn('Railway connection check failed', { reason });
    return { configured: true, reachable: false, reason };
  }
}

// ---------------------------------------------------------------------------
// MUTATIONS — schema-verified; first exercised live in Phase 2+
// (they create real, billable resources on the operator's Railway account).
// ---------------------------------------------------------------------------

export interface CreateProjectInput {
  name: string;
  description?: string;
  workspaceId?: string;
  defaultEnvironmentName?: string;
  isPublic?: boolean;
}

/** Create a new Railway project (one project per Cherri app). */
export async function createProject(input: CreateProjectInput): Promise<{
  id: string;
  name: string;
  environments: { id: string; name: string }[];
}> {
  const data = await railwayRequest<{
    projectCreate: {
      id: string;
      name: string;
      environments: { edges: { node: { id: string; name: string } }[] };
    };
  }>(
    `mutation createProject($input: ProjectCreateInput!) {
       projectCreate(input: $input) {
         id
         name
         environments { edges { node { id name } } }
       }
     }`,
    { input },
  );
  return {
    id: data.projectCreate.id,
    name: data.projectCreate.name,
    environments: data.projectCreate.environments.edges.map((e) => e.node),
  };
}

export interface CreateServiceInput {
  projectId: string;
  name?: string;
  environmentId?: string;
  /** Deploy source — exactly one of `repo` (GitHub "owner/name") or `image`. */
  source?: { repo?: string; image?: string };
  branch?: string;
}

/** Create a service in a project, from a GitHub repo or a container image. */
export async function createService(input: CreateServiceInput): Promise<{
  id: string;
  name: string;
}> {
  const data = await railwayRequest<{
    serviceCreate: { id: string; name: string };
  }>(
    `mutation createService($input: ServiceCreateInput!) {
       serviceCreate(input: $input) { id name }
     }`,
    { input },
  );
  return data.serviceCreate;
}

/**
 * Provision a managed Postgres database as a service from the Postgres image.
 * (Railway has no dedicated Postgres mutation — DBs are services from an image
 * or template.) Phase 2 verifies the exact image yields working connection vars.
 */
export async function provisionPostgres(args: {
  projectId: string;
  environmentId?: string;
  name?: string;
  image?: string;
}): Promise<{ id: string; name: string }> {
  return createService({
    projectId: args.projectId,
    environmentId: args.environmentId,
    name: args.name ?? 'postgres',
    source: { image: args.image ?? DEFAULT_POSTGRES_IMAGE },
  });
}

/** Deploy a GitHub repo into a project (creates/links a service). */
export async function deployGithubRepo(args: {
  projectId: string;
  repo: string;
  branch?: string;
  environmentId?: string;
}): Promise<boolean> {
  const data = await railwayRequest<{ githubRepoDeploy: boolean }>(
    `mutation githubRepoDeploy($input: GitHubRepoDeployInput!) {
       githubRepoDeploy(input: $input)
     }`,
    { input: args },
  );
  return data.githubRepoDeploy;
}

/** Trigger (re)deploy of a service instance in an environment. */
export async function deployServiceInstance(args: {
  serviceId: string;
  environmentId: string;
  commitSha?: string;
}): Promise<boolean> {
  const data = await railwayRequest<{ serviceInstanceDeployV2: boolean }>(
    `mutation deployInstance($serviceId: String!, $environmentId: String!, $commitSha: String) {
       serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha)
     }`,
    args,
  );
  return data.serviceInstanceDeployV2;
}

/**
 * Upsert an environment variable on a service (used to inject the Postgres
 * connection string and the app's own keys into the backend — server-side only,
 * never written into IPFS files).
 */
export async function upsertVariable(input: {
  projectId: string;
  environmentId: string;
  serviceId?: string;
  name: string;
  value: string;
  skipDeploys?: boolean;
}): Promise<boolean> {
  const data = await railwayRequest<{ variableUpsert: boolean }>(
    `mutation variableUpsert($input: VariableUpsertInput!) {
       variableUpsert(input: $input)
     }`,
    { input },
  );
  return data.variableUpsert;
}

/**
 * Create a public Railway-generated domain (`*.up.railway.app`) for a service so
 * the provisioned backend has a reachable public URL. Schema per Railway's
 * public API; first EXERCISED live in Phase 2+ — a wrong shape surfaces a real
 * RailwayApiError (we never fabricate a URL). The resulting provider domain is
 * operator-only; it is never exposed to end users (a branded domain is used for
 * that), so this value must not be returned to clients or written into IPFS.
 */
export async function createServiceDomain(args: {
  serviceId: string;
  environmentId: string;
  targetPort?: number;
}): Promise<{ domain: string }> {
  const data = await railwayRequest<{ serviceDomainCreate: { domain: string } }>(
    `mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
       serviceDomainCreate(input: $input) { domain }
     }`,
    { input: args },
  );
  return data.serviceDomainCreate;
}

/** Railway deployment status enum (subset; per the public API schema). */
export type RailwayDeploymentStatus =
  | 'BUILDING'
  | 'DEPLOYING'
  | 'INITIALIZING'
  | 'QUEUED'
  | 'WAITING'
  | 'NEEDS_APPROVAL'
  | 'SUCCESS'
  | 'FAILED'
  | 'CRASHED'
  | 'REMOVED'
  | 'SKIPPED'
  | 'SLEEPING';

/**
 * Fetch the latest deployment (id + status) for a service in an environment,
 * used to VERIFY a deploy actually reached SUCCESS before a service is marked
 * ACTIVE — we never mark ACTIVE off an unverified/in-progress deploy. Returns
 * null when there is no deployment yet. Schema per Railway's public API; first
 * exercised live in Phase 2+.
 */
export async function getLatestDeploymentStatus(args: {
  projectId: string;
  serviceId: string;
  environmentId: string;
}): Promise<{ id: string; status: RailwayDeploymentStatus } | null> {
  const data = await railwayRequest<{
    deployments: {
      edges: { node: { id: string; status: RailwayDeploymentStatus } }[];
    };
  }>(
    `query deployments($input: DeploymentListInput!) {
       deployments(first: 1, input: $input) {
         edges { node { id status } }
       }
     }`,
    {
      input: {
        projectId: args.projectId,
        serviceId: args.serviceId,
        environmentId: args.environmentId,
      },
    },
  );
  return data.deployments.edges[0]?.node ?? null;
}

/** A Railway `MetricMeasurement` enum value (verified via introspection). */
export type RailwayMeasurement =
  | 'CPU_USAGE'
  | 'CPU_LIMIT'
  | 'MEMORY_USAGE_GB'
  | 'MEMORY_LIMIT_GB'
  | 'DISK_USAGE_GB'
  | 'EPHEMERAL_DISK_USAGE_GB'
  | 'BACKUP_USAGE_GB'
  | 'NETWORK_RX_GB'
  | 'NETWORK_TX_GB';

export interface RailwayEstimatedUsage {
  measurement: string;
  estimatedValue: number;
  projectId: string;
}

/**
 * Read CURRENT estimated usage for a project (no date range — this is the
 * present-period estimate). For historical/billed usage over a window, Phase 4
 * uses the `usage` / `projectServiceUsage` queries (which take start/end dates).
 * Selection set + enum values verified live against the Railway schema.
 */
export async function getEstimatedUsage(args: {
  projectId: string;
  measurements: RailwayMeasurement[];
}): Promise<RailwayEstimatedUsage[]> {
  const data = await railwayRequest<{ estimatedUsage: RailwayEstimatedUsage[] }>(
    `query estimatedUsage($projectId: String, $measurements: [MetricMeasurement!]!) {
       estimatedUsage(projectId: $projectId, measurements: $measurements) {
         estimatedValue
         measurement
         projectId
       }
     }`,
    { projectId: args.projectId, measurements: args.measurements },
  );
  return data.estimatedUsage;
}

/** Stop a running deployment (used to pause an app on non-payment). */
export async function stopDeployment(deploymentId: string): Promise<boolean> {
  const data = await railwayRequest<{ deploymentStop: boolean }>(
    `mutation deploymentStop($id: String!) { deploymentStop(id: $id) }`,
    { id: deploymentId },
  );
  return data.deploymentStop;
}

/** Delete a service (and stop its billing). */
export async function deleteService(args: {
  id: string;
  environmentId?: string;
}): Promise<boolean> {
  const data = await railwayRequest<{ serviceDelete: boolean }>(
    `mutation serviceDelete($id: String!, $environmentId: String) {
       serviceDelete(id: $id, environmentId: $environmentId)
     }`,
    args,
  );
  return data.serviceDelete;
}

/** Delete an entire project (full teardown — stops all its billing). */
export async function deleteProject(projectId: string): Promise<boolean> {
  const data = await railwayRequest<{ projectDelete: boolean }>(
    `mutation projectDelete($id: String!) { projectDelete(id: $id) }`,
    { id: projectId },
  );
  return data.projectDelete;
}
