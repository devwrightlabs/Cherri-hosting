/**
 * PiRC2 adapter — Pi Network's on-chain recurring-subscription standard.
 *
 * PiRC2 is a Soroban (Stellar) smart-contract standard (PiNetwork/SmartContracts
 * `contracts/subscription`). It is **testnet-only** at time of writing (under
 * audit; no Mainnet deployment exists). A subscriber calls the contract's
 * `subscribe(subscriber, service_id, auto_renew)` which internally grants the
 * contract a token *allowance*; funds stay in the subscriber's wallet. The
 * merchant later draws due cycles by calling `process(merchant, service_id,
 * offset, limit)` — a BATCH operation that iterates the service's on-chain
 * subscriptions and `transfer_from`s every cycle that is currently due. The
 * contract is the source of truth for timing and for the charge/fail decision.
 *
 * Honesty rules (never relaxed):
 *   - When PiRC2 (or its merchant signer) is not configured, on-chain mutating
 *     operations throw IntegrationUnavailableError so callers degrade to a clear
 *     503 — they NEVER report a fabricated/successful charge.
 *   - The draw NEVER infers "this subscriber was charged" from the aggregate
 *     ProcessResult counts; it reconciles from the contract's per-subscriber
 *     `charge` / `chg_fail` events.
 *   - Draws are refused on a known production/mainnet network passphrase
 *     (defense-in-depth on top of the GO-LIVE master switch) because PiRC2 has
 *     no Mainnet contract.
 *
 * Live drawing requires PIRC2_CONTRACT_ID, SOROBAN_RPC_URL,
 * PIRC2_NETWORK_PASSPHRASE and PIRC2_MERCHANT_SECRET, plus the GO-LIVE switch.
 */
import {
  rpc,
  Contract,
  Keypair,
  TransactionBuilder,
  Address,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  humanizeEvents,
  xdr,
} from '@stellar/stellar-sdk';
import { logger } from '../utils/logger';
import { isPirc2Configured, IntegrationUnavailableError } from '../utils/integrations';

const PIRC2_INTEGRATION = 'pirc2';

/** Soroban tx assembly/polling tunables. */
const SOROBAN_TX_TIMEOUT_SECS = 30;
const POLL_ATTEMPTS = 10;

/**
 * PiRC2 is testnet-only and has no Mainnet contract, so draws are FAIL-CLOSED:
 * they proceed only on an explicitly allowed (testnet) network passphrase, never
 * merely "not on a denylist". Known production/mainnet passphrases are blocked
 * outright and win over the allowlist. Operators may extend either list
 * (comma-separated) via PIRC2_ALLOWED_PASSPHRASES / PIRC2_BLOCKED_PASSPHRASES.
 */
const BUILTIN_BLOCKED_PASSPHRASES = [
  'Public Global Stellar Network ; September 2015', // Stellar mainnet
  'Pi Network', // Pi mainnet
];
const BUILTIN_ALLOWED_PASSPHRASES = [
  'Pi Testnet',
  'Test SDF Network ; September 2015', // Stellar testnet
];

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------
export interface AllowanceApproval {
  /** On-chain account that granted the allowance (called subscribe()). */
  subscriberAddress: string;
  /** Hash of the subscriber's subscribe()/approval transaction. */
  approvalTxId: string;
}

export interface AllowanceVerification {
  /** True only when the tx invoked the configured contract's subscribe(),
   *  succeeded, and was authored by the expected subscriber. */
  verified: boolean;
  /** On-chain service id the subscriber subscribed to (when decodable). */
  serviceId: string | null;
  /** On-chain subscription id (sub_id) returned by subscribe() (when decodable). */
  subId: string | null;
}

/** One per-subscriber outcome emitted by the contract during a `process` call. */
export interface ChargeEvent {
  /** `charge` = cycle drawn successfully; `chg_fail` = transfer_from failed
   *  (insufficient balance/allowance) and the contract disabled auto_renew. */
  kind: 'charge' | 'chg_fail';
  subscriberAddress: string;
  serviceId: string;
  /** Hash of the `process` transaction that produced this event. */
  txId: string;
}

export interface ProcessResultCounts {
  charged: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface ProcessPageResult {
  txId: string;
  result: ProcessResultCounts;
  events: ChargeEvent[];
}

/**
 * Seam between this service and the chain. The default implementation talks to
 * Soroban via @stellar/stellar-sdk; tests inject a fake so no network is touched
 * and the gating/reconciliation logic can be verified deterministically.
 */
export interface Pirc2ChainClient {
  /** Submit one `process(merchant, service_id, offset, limit)` page. */
  submitProcess(input: {
    serviceId: string;
    offset: number;
    limit: number;
  }): Promise<ProcessPageResult>;
  /** Fetch + decode a subscriber's subscribe()/approval transaction. */
  fetchApprovalTx(txId: string): Promise<ApprovalTxInfo | null>;
}

export interface ApprovalTxInfo {
  succeeded: boolean;
  contractId: string | null;
  functionName: string | null;
  subscriberAddress: string | null;
  serviceId: string | null;
  subId: string | null;
}

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------
function assertConfigured(): void {
  if (!isPirc2Configured()) {
    throw new IntegrationUnavailableError(
      PIRC2_INTEGRATION,
      'PiRC2 is not configured on the server (PIRC2_CONTRACT_ID, SOROBAN_RPC_URL, ' +
        'PIRC2_NETWORK_PASSPHRASE required). Recurring subscriptions are unavailable.',
    );
  }
}

/** True when the merchant signer needed to author on-chain draws is present. */
function hasMerchantSigner(): boolean {
  return Boolean(process.env.PIRC2_MERCHANT_SECRET);
}

function assertCanDraw(): void {
  assertConfigured();
  if (!hasMerchantSigner()) {
    throw new IntegrationUnavailableError(
      PIRC2_INTEGRATION,
      'PiRC2 merchant signer is not configured (PIRC2_MERCHANT_SECRET). The server ' +
        'cannot author on-chain draws until it is set.',
    );
  }
}

function envPassphraseSet(name: string): Set<string> {
  const extra = (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(extra);
}

function blockedPassphrases(): Set<string> {
  return new Set([...BUILTIN_BLOCKED_PASSPHRASES, ...envPassphraseSet('PIRC2_BLOCKED_PASSPHRASES')]);
}

function allowedPassphrases(): Set<string> {
  return new Set([...BUILTIN_ALLOWED_PASSPHRASES, ...envPassphraseSet('PIRC2_ALLOWED_PASSPHRASES')]);
}

/**
 * Fail-closed network guard. A draw proceeds only when the configured network
 * passphrase is on the testnet allowlist AND not on the mainnet denylist (the
 * denylist wins), and the RPC endpoint is HTTPS. An unknown/empty passphrase is
 * refused. This is the last line of defense behind the GO-LIVE switch against
 * ever drawing real funds on a production network.
 */
function assertDrawNetworkAllowed(): void {
  const passphrase = (process.env.PIRC2_NETWORK_PASSPHRASE ?? '').trim();
  const rpcUrl = (process.env.SOROBAN_RPC_URL ?? '').trim();

  if (blockedPassphrases().has(passphrase)) {
    throw new IntegrationUnavailableError(
      PIRC2_INTEGRATION,
      'PiRC2 recurring draws are blocked: the configured network passphrase is a ' +
        'known production/mainnet network. PiRC2 is testnet-only.',
    );
  }
  if (!allowedPassphrases().has(passphrase)) {
    throw new IntegrationUnavailableError(
      PIRC2_INTEGRATION,
      'PiRC2 recurring draws are refused: the configured network passphrase is not ' +
        'on the testnet allowlist. PiRC2 is testnet-only (set PIRC2_ALLOWED_PASSPHRASES ' +
        'to opt a testnet network in).',
    );
  }
  if (!rpcUrl.startsWith('https://')) {
    throw new IntegrationUnavailableError(
      PIRC2_INTEGRATION,
      'PiRC2 recurring draws are refused: SOROBAN_RPC_URL must be an https:// endpoint.',
    );
  }
}

// ---------------------------------------------------------------------------
// Chain client (default = Soroban via stellar-sdk; overridable for tests)
// ---------------------------------------------------------------------------
let injectedClient: Pirc2ChainClient | null = null;

/** Test-only: inject a fake chain client (pass null to restore the default). */
export function __setPirc2ChainClient(client: Pirc2ChainClient | null): void {
  injectedClient = client;
}

function getChainClient(): Pirc2ChainClient {
  return injectedClient ?? createStellarChainClient();
}

function newRpcServer(): rpc.Server {
  const url = process.env.SOROBAN_RPC_URL as string;
  return new rpc.Server(url, { allowHttp: url.startsWith('http://') });
}

/** Decode the contract's per-subscriber events from a transaction's meta. */
function extractChargeEvents(
  meta: xdr.TransactionMeta,
  contractId: string,
  txId: string,
): ChargeEvent[] {
  const events: ChargeEvent[] = [];
  let raw: xdr.ContractEvent[] = [];
  try {
    const sorobanMeta = typeof meta.v3 === 'function' ? meta.v3().sorobanMeta() : null;
    raw = sorobanMeta ? sorobanMeta.events() : [];
  } catch {
    raw = [];
  }
  // Decode with the SDK's own helper (authoritative contractId strkey + native
  // topics/data) rather than hand-rolling the XDR walk.
  let humanized: ReturnType<typeof humanizeEvents>;
  try {
    humanized = humanizeEvents(raw);
  } catch {
    return events;
  }
  for (const ev of humanized) {
    try {
      if (ev.type !== 'contract') continue;
      // Only trust events emitted by the configured contract.
      if (ev.contractId && ev.contractId !== contractId) continue;
      const kind = ev.topics[0];
      if (kind !== 'charge' && kind !== 'chg_fail') continue;
      const data = ev.data;
      const arr = Array.isArray(data) ? data : [];
      events.push({
        kind,
        subscriberAddress: arr[0] != null ? String(arr[0]) : '',
        serviceId: arr[1] != null ? String(arr[1]) : '',
        txId,
      });
    } catch {
      // An undecodable event is skipped rather than guessed at.
    }
  }
  return events;
}

function decodeProcessResult(value: xdr.ScVal | undefined): ProcessResultCounts {
  const native = value ? (scValToNative(value) as Record<string, unknown>) : {};
  const num = (v: unknown): number => {
    const n = typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    charged: num(native.charged),
    failed: num(native.failed),
    skipped: num(native.skipped),
    total: num(native.total),
  };
}

/** Decode the invoked contract id / function / args from a tx envelope. */
function decodeInvokeContract(
  envelope: xdr.TransactionEnvelope,
): { contractId: string; functionName: string; args: unknown[] } | null {
  try {
    const ops = envelope.v1().tx().operations();
    for (const op of ops) {
      const body = op.body();
      if (body.switch().name !== 'invokeHostFunction') continue;
      const hostFn = body.invokeHostFunctionOp().hostFunction();
      if (hostFn.switch().name !== 'hostFunctionTypeInvokeContract') continue;
      const ic = hostFn.invokeContract();
      return {
        contractId: Address.fromScAddress(ic.contractAddress()).toString(),
        functionName: ic.functionName().toString(),
        args: ic.args().map((a) => scValToNative(a)),
      };
    }
  } catch {
    return null;
  }
  return null;
}

function createStellarChainClient(): Pirc2ChainClient {
  const contractId = process.env.PIRC2_CONTRACT_ID as string;
  const passphrase = process.env.PIRC2_NETWORK_PASSPHRASE as string;

  return {
    async submitProcess({ serviceId, offset, limit }): Promise<ProcessPageResult> {
      const server = newRpcServer();
      const merchant = Keypair.fromSecret(process.env.PIRC2_MERCHANT_SECRET as string);
      const contract = new Contract(contractId);
      const source = await server.getAccount(merchant.publicKey());

      const op = contract.call(
        'process',
        nativeToScVal(merchant.publicKey(), { type: 'address' }),
        nativeToScVal(BigInt(serviceId), { type: 'u64' }),
        nativeToScVal(offset, { type: 'u32' }),
        nativeToScVal(limit, { type: 'u32' }),
      );

      const built = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: passphrase,
      })
        .addOperation(op)
        .setTimeout(SOROBAN_TX_TIMEOUT_SECS)
        .build();

      const prepared = await server.prepareTransaction(built);
      prepared.sign(merchant);

      const sent = await server.sendTransaction(prepared);
      if (sent.status === 'ERROR') {
        throw new Error('PiRC2 process submission was rejected by the network.');
      }

      const final = await server.pollTransaction(sent.hash, { attempts: POLL_ATTEMPTS });
      if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        // The whole process tx failed (e.g. auth/resource). Insufficient funds is
        // NOT a tx failure — it surfaces as a per-subscriber chg_fail event.
        throw new Error(`PiRC2 process transaction did not succeed (status=${final.status}).`);
      }

      return {
        txId: sent.hash,
        result: decodeProcessResult(final.returnValue),
        events: extractChargeEvents(final.resultMetaXdr, contractId, sent.hash),
      };
    },

    async fetchApprovalTx(txId): Promise<ApprovalTxInfo | null> {
      const server = newRpcServer();
      const tx = await server.getTransaction(txId);
      if (tx.status === rpc.Api.GetTransactionStatus.NOT_FOUND) return null;
      const succeeded = tx.status === rpc.Api.GetTransactionStatus.SUCCESS;
      const invoked = succeeded ? decodeInvokeContract(tx.envelopeXdr) : null;
      const subId =
        succeeded && tx.returnValue ? String(scValToNative(tx.returnValue)) : null;
      return {
        succeeded,
        contractId: invoked?.contractId ?? null,
        functionName: invoked?.functionName ?? null,
        subscriberAddress:
          invoked?.args?.[0] != null ? String(invoked.args[0]) : null,
        serviceId: invoked?.args?.[1] != null ? String(invoked.args[1]) : null,
        subId,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------
/**
 * Verify a subscriber's one-time allowance approval (their `subscribe()` tx) on
 * chain. Verification is fail-closed: it returns verified=false unless the tx
 * succeeded, invoked the CONFIGURED contract's `subscribe`, and was authored by
 * the expected subscriber address — so an unrelated successful transaction can
 * never be accepted as an approval. Throws IntegrationUnavailableError when
 * PiRC2 is not configured.
 */
export async function verifyAllowanceApproval(
  approval: AllowanceApproval,
): Promise<AllowanceVerification> {
  assertConfigured();
  const configuredContract = (process.env.PIRC2_CONTRACT_ID ?? '').trim();
  const info = await getChainClient().fetchApprovalTx(approval.approvalTxId);

  const verified = Boolean(
    info &&
      info.succeeded &&
      info.functionName === 'subscribe' &&
      info.contractId === configuredContract &&
      info.subscriberAddress === approval.subscriberAddress,
  );

  logger.info('PiRC2 allowance approval verification', {
    approvalTxId: approval.approvalTxId,
    subscriberAddress: approval.subscriberAddress,
    succeeded: info?.succeeded ?? false,
    functionName: info?.functionName ?? null,
    contractMatched: info?.contractId === configuredContract,
    verified,
  });

  return {
    verified,
    serviceId: verified ? (info?.serviceId ?? null) : null,
    subId: verified ? (info?.subId ?? null) : null,
  };
}

/**
 * Draw one `process(merchant, service_id, offset, limit)` page for a service.
 * Returns the decoded counts plus the authoritative per-subscriber events.
 * Throws IntegrationUnavailableError when PiRC2 / the merchant signer is not
 * provisioned, or when the network is a blocked (production) network. It never
 * fabricates a charge.
 */
export async function processServicePage(
  serviceId: string,
  offset: number,
  limit: number,
): Promise<ProcessPageResult> {
  assertCanDraw();
  assertDrawNetworkAllowed();
  return getChainClient().submitProcess({ serviceId, offset, limit });
}

/**
 * Merchant-side allowance revocation request on cancellation.
 *
 * The PiRC2 contract exposes `cancel()` / `toggle_auto_renew()` as
 * SUBSCRIBER-authorized operations only — a merchant cannot revoke a
 * subscriber's allowance or cancel their on-chain subscription. The honest
 * behavior is therefore a no-op: the app stops processing the subscription
 * locally and the on-chain allowance lapses at its approve_periods/expiration
 * horizon; the subscriber may also cancel on-chain themselves. This never
 * throws, so local cancellation always proceeds.
 */
export async function revokeAllowance(subscriberAddress: string): Promise<void> {
  logger.info(
    'PiRC2 merchant-side allowance revoke is a no-op (contract allows subscriber-authorized cancel only)',
    { subscriberAddress },
  );
}
