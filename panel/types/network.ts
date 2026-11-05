/**
 * SharX Network — contracts of `web/controller/network.go` (panel API).
 * All responses are wrapped in `Msg<T>` (see lib/api.ts). Optional fields
 * default in the UI when the corresponding resource has not been created yet.
 */

export type NetworkParticipantStatus =
  | "disabled"
  | "enrolling"
  | "active"
  | "suspended"
  | "error";

export type NetworkStatus = {
  enabled: boolean;
  status: NetworkParticipantStatus;
  participantId?: string;
  name?: string;
  coordinatorUrl?: string;
  balance?: number;
  reserved?: number;
  heldCredits?: number;
  earnedPeriod?: number;
  spentPeriod?: number;
  /** The operator of the network paused new connections for everyone. */
  emergencyShutdown?: boolean;
  lastSyncAt?: number;
  error?: string;
  /** Version of the risk text the participant acknowledged. */
  riskAckVersion?: string;
};

export type EnrollPayload = {
  coordinatorUrl: string;
  inviteCode: string;
  name: string;
};

export type LeavePayload = {
  confirm: "LEAVE";
};

export type NetworkNodeSecurity = "reality" | "tls";

/** One published (or being published) node of this panel. */
export type NetworkNode = {
  id: number;
  nodeId: number;
  nodeName: string;
  nodeOnline?: boolean;
  coordinatorNodeId?: string;
  label?: string;
  protocols?: string[];
  trafficLimitGB?: number;
  speedLimitMbps?: number;
  reserveMbps?: number;
  maxSessions?: number;
  priceCreditsPerGB?: number;
  enabled?: boolean;
  paused?: boolean;
  /** draft / published / draining / error */
  status?: string;
  error?: string;
  activeSessions?: number;
  trafficUsedGB?: number;
  coordinatorSnapshot?: unknown;
};

export type PublishNodePayload = {
  nodeId: number;
  label?: string;
  security: NetworkNodeSecurity;
  endpointHost?: string;
  trafficLimitGB: number;
  speedLimitMbps: number;
  reserveMbps: number;
  maxSessions: number;
  priceCreditsPerGB: number;
  riskAck: boolean;
};

export type UpdateNodePayload = {
  id: number;
  trafficLimitGB: number;
  speedLimitMbps: number;
  reserveMbps: number;
  maxSessions: number;
  priceCreditsPerGB: number;
  paused: boolean;
};

export type NetworkNodesResponse = {
  nodes?: NetworkNode[];
};

/** A node offered by other participants, as listed by the coordinator. */
export type CatalogNode = {
  id: number | string;
  tariff_revision: number;
  rate_micros: number;
  label: string;
  country?: string;
  region?: string;
  protocols?: string[];
  endpoint_host?: string;
  endpoint_port?: number;
  capacity_mbps?: number;
  speed_limit_mbps?: number;
  max_sessions?: number;
  active_sessions?: number;
  traffic_limit_gb?: number;
  traffic_used_gb?: number;
  price_credits_per_gb?: number;
  status?: string;
};

export type CatalogScoreParts = {
  health?: number;
  latency?: number;
  headroom?: number;
  capacity_fit?: number;
};

export type CatalogCandidate = {
  node: CatalogNode;
  /** 0..1 overall fit score. */
  score?: number;
  score_parts?: CatalogScoreParts;
  available_mbps?: number;
  remaining_traffic_gb?: number;
};

export type NetworkCatalogResponse = {
  candidates?: CatalogCandidate[];
};

export type NetworkSessionRole = "provider" | "consumer";

/** A traffic session: either a foreign client on our node (provider) or our client on a foreign node (consumer). */
export type NetworkSession = {
  id: string;
  role?: NetworkSessionRole | string;
  coordinatorNodeId?: string;
  peerParticipantId?: string;
  clientEntityId?: number;
  clientEmail?: string;
  inboundId?: number;
  hostId?: number;
  bundleIds?: number[];
  protocol?: string;
  quotaGB?: number;
  /** provisioning / active / degraded / closing / closed / disputed */
  status?: string;
  usageUpBytes?: number;
  usageDownBytes?: number;
  openedAt?: number;
  closedAt?: number;
};

export type NetworkSessionsResponse = {
  sessions?: NetworkSession[];
};

export type NetworkResourcesResponse = {
  resources?: NetworkSession[];
};

export type OpenSessionPayload = {
  nodeId: number | string;
  quotaGB: number;
};

export type NetworkBundle = {
  id: number;
  name: string;
  clientCount?: number;
  hosts?: { hostId: number; host?: { source?: string } }[];
};

export type CreateNetworkBundleResponse = {
  bundle?: NetworkBundle;
};

export type CreateNetworkBundlePayload = {
  name: string;
  sessionIds: string[];
};

export type AssignNetworkBundlePayload = {
  bundleId: number;
  clientIds: number[];
};

export type DisputeSessionPayload = {
  id: string;
  reason: string;
};

export type LedgerDirection =
  | "credit"
  | "debit"
  | "reserve"
  | "release"
  | "bonus"
  | "adjustment"
  | string;

export type LedgerEntry = {
  entryUid?: string;
  direction?: LedgerDirection;
  amountCredits?: number;
  amountBytes?: number;
  counterpartyParticipantId?: string;
  sessionId?: string;
  /** settled / hold */
  status?: string;
  reason?: string;
  memo?: string;
  ts?: number;
};

export type NetworkLedgerResponse = {
  entries?: LedgerEntry[];
  nextCursor?: number;
};

export type NetworkOverview = {
  balance?: number;
  reserved?: number;
  heldCredits?: number;
  earnedPeriod?: number;
  spentPeriod?: number;
  servedUpGB?: number;
  servedDownGB?: number;
  receivedUpGB?: number;
  receivedDownGB?: number;
  publishedNodes?: number;
  activeProviderSessions?: number;
  activeConsumerSessions?: number;
};
