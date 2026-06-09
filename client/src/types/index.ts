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

export interface Project {
  id: string;
  name: string;
  description?: string;
  userId: string;
  customDomain?: string;
  createdAt: string;
  updatedAt: string;
  deployments: Deployment[];
  _count?: { deployments: number };
}

export interface Deployment {
  id: string;
  projectId: string;
  cid: string;
  gateway: string;
  size: number;
  status: DeploymentStatus;
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
      init: (config: { version: string; sandbox?: boolean }) => void;
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
