export type Tier = 'FREE' | 'PREMIUM' | 'TIER1' | 'TIER2' | 'TIER3' | 'TIER4';

export type DeploymentStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'PINNING'
  | 'ACTIVE'
  | 'FAILED';

export interface User {
  id: string;
  piUserId: string;
  username: string;
  email?: string;
  tier: Tier;
  storageUsed: number;
  storageLimit: number;
  createdAt: string;
}

/** Operator-safe backend backup status. NEVER carries Railway ids/domains. */
export interface BackendBackupStatus {
  status: string;
  lastBackupAt?: string | null;
  lastBackupStatus?: string | null;
  lastBackupFailureReason?: string | null;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  userId: string;
  customDomain?: string;
  lifecycleStatus?: string;
  deletionFailureReason?: string | null;
  createdAt: string;
  updatedAt: string;
  deployments: Deployment[];
  /** Present only when the project has a provisioned backend. */
  backendService?: BackendBackupStatus | null;
  _count?: { deployments: number };
}

/** Post-pin live-link verification result. VERIFIED = the gateway actually
 *  returned the site's HTML; anything less is shown honestly, never as "live". */
export type LiveCheckStatus = 'UNCHECKED' | 'VERIFIED' | 'INDETERMINATE' | 'FAILED';

export interface Deployment {
  id: string;
  projectId: string;
  cid: string;
  gateway: string;
  size: number;
  status: DeploymentStatus;
  /** Human-readable failure detail (real Pinata error) when status === 'FAILED'. */
  failureReason?: string | null;
  /** Entry file within the pinned directory (e.g. "index.html"). */
  entryPath?: string | null;
  liveCheckStatus?: LiveCheckStatus;
  /** Honest detail for INDETERMINATE / FAILED live checks. */
  liveCheckDetail?: string | null;
  liveCheckAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  userId: string;
  tier: Tier;
  piTxId?: string;
  amount: number;
  currency: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

// Pi Network SDK types
export interface PiUser {
  uid: string;
  username: string;
  /** Wallet address, present when 'wallet_address' scope is granted. */
  walletAddress?: string;
}

export interface PiAuthResult {
  accessToken: string;
  user: PiUser;
}

export interface PiPaymentCallbacks {
  onReadyForServerApproval: (paymentId: string) => void;
  onReadyForServerCompletion: (paymentId: string, txid: string) => void;
  onCancel: (paymentId: string) => void;
  onError: (error: Error, payment?: PiPaymentDTO) => void;
}

export interface PiPaymentDTO {
  identifier: string;
  user_uid: string;
  amount: number;
  memo: string;
  metadata: Record<string, unknown>;
  status: {
    developer_approved: boolean;
    transaction_verified: boolean;
    developer_completed: boolean;
    cancelled: boolean;
    user_cancelled: boolean;
  };
}

declare global {
  interface Window {
    Pi?: {
      init: (config: { version: string; sandbox?: boolean }) => Promise<void> | void;
      authenticate: (
        scopes: string[],
        onIncompletePaymentFound?: (payment: PiPaymentDTO) => void,
      ) => Promise<PiAuthResult>;
      createPayment: (
        paymentData: { amount: number; memo: string; metadata: Record<string, unknown> },
        callbacks: PiPaymentCallbacks,
      ) => void;
      /**
       * PiRC2 recurring-subscription allowance approval. This is part of Pi's
       * on-chain subscription standard and is only present in Pi Browser builds
       * that support PiRC2. Optional so the app degrades honestly where absent.
       */
      createSubscription?: (
        subscriptionData: {
          amount: number;
          interval: { days: number };
          cycles: number;
          memo: string;
          metadata: Record<string, unknown>;
        },
      ) => Promise<PiAllowanceApproval>;
    };
  }
}

export interface PiAllowanceApproval {
  /** Hash of the on-chain allowance approval transaction. */
  txid: string;
  /** Subscriber's on-chain account address that granted the allowance. */
  address: string;
}
