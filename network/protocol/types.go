// Package protocol defines the wire types shared between SharX panels and the
// SharX Network coordinator. Both sides must marshal/unmarshal exactly these
// shapes; field names are part of the contract.
package protocol

import "encoding/json"

// Protocol version negotiated at enrollment. Bumps are additive-only in v1.
const ProtocolVersion = 1

// Session/node statuses.
const (
	NodeStatusActive   = "active"
	NodeStatusPaused   = "paused"
	NodeStatusDraining = "draining"
	NodeStatusOffline  = "offline"
	NodeStatusRetired  = "retired"

	SessionProvisioning = "provisioning"
	SessionActive       = "active"
	SessionDegraded     = "degraded"
	SessionClosing      = "closing"
	SessionClosed       = "closed"
	SessionDisputed     = "disputed"
)

// Ledger directions and entry statuses.
const (
	DirCredit     = "credit"
	DirDebit      = "debit"
	DirReserve    = "reserve"
	DirRelease    = "release"
	DirBonus      = "bonus"
	DirAdjustment = "adjustment"

	EntrySettled = "settled"
	EntryHold    = "hold"
)

// Participant statuses.
const (
	ParticipantActive    = "active"
	ParticipantSuspended = "suspended"
	ParticipantBlocked   = "blocked"
)

// Err* codes returned in {"error": code}.
const (
	ErrUnauthorized         = "unauthorized"
	ErrForbidden            = "forbidden"
	ErrInvalidArgument      = "invalid_argument"
	ErrIdempotencyConflict  = "idempotency_conflict"
	ErrNotFound             = "not_found"
	ErrInsufficientBalance  = "insufficient_balance"
	ErrQuotaExceeded        = "quota_exceeded"
	ErrRateLimited          = "rate_limited"
	ErrEmergencyShutdown    = "emergency_shutdown"
	ErrParticipantSuspended = "participant_suspended"
	ErrNodeUnavailable      = "node_unavailable"
)

// AccessTemplate is the public connectivity descriptor of a shared node.
// Only whitelisted fields are stored; private keys are rejected by the coordinator.
type AccessTemplate struct {
	Security    string   `json:"security"`  // reality | tls
	Transport   string   `json:"transport"` // tcp | ws | grpc
	SNI         string   `json:"sni,omitempty"`
	PublicKey   string   `json:"public_key,omitempty"`  // reality x25519 public key
	ShortIDs    []string `json:"short_ids,omitempty"`   // reality short ids (public by design)
	Fingerprint string   `json:"fingerprint,omitempty"` // utls fingerprint, e.g. chrome
	Path        string   `json:"path,omitempty"`        // ws path
	Host        string   `json:"host,omitempty"`        // ws host header
}

// SharedNode describes a node published to the network by a provider panel.
type SharedNode struct {
	TariffRevision    int64          `json:"tariff_revision"`
	RateMicros        int64          `json:"rate_micros"`
	EvidencePublicKey string         `json:"evidence_public_key,omitempty"`
	ID                string         `json:"id"`
	NodeRef           string         `json:"node_ref,omitempty"` // provider-local node id (never exposed to consumers)
	ParticipantID     string         `json:"participant_id"`
	Label             string         `json:"label"`
	Country           string         `json:"country"`
	Region            string         `json:"region"`
	Protocols         []string       `json:"protocols"`
	EndpointHost      string         `json:"endpoint_host"`
	EndpointPort      int            `json:"endpoint_port"`
	AccessTemplate    AccessTemplate `json:"access_template"`
	CapacityMbps      int            `json:"capacity_mbps"`
	SpeedLimitMbps    int            `json:"speed_limit_mbps"`
	ReserveMbps       int            `json:"reserve_mbps"`
	MaxSessions       int            `json:"max_sessions"`
	ActiveSessions    int            `json:"active_sessions"`
	TrafficLimitGB    float64        `json:"traffic_limit_gb"`
	TrafficUsedGB     float64        `json:"traffic_used_gb"`
	PriceCreditsPerGB float64        `json:"price_credits_per_gb"`
	Status            string         `json:"status"`
	HealthAt          int64          `json:"health_at"`
	Health            NodeHealth     `json:"health"`
}

// NodeHealth is the last heartbeat reported by the owning panel.
type NodeHealth struct {
	Status    string  `json:"status"` // online | degraded | offline
	RTTMs     float64 `json:"rtt_ms"`
	Bandwidth float64 `json:"bandwidth_used_mbps"`
	XrayUp    bool    `json:"xray_up"`
}

// ScoreParts explains a candidate's score (observability + tests).
type ScoreParts struct {
	Health      float64 `json:"health"`
	Latency     float64 `json:"latency"`
	Headroom    float64 `json:"headroom"`
	CapacityFit float64 `json:"capacity_fit"`
}

// Candidate is a catalog entry offered to a consumer panel.
type Candidate struct {
	Node          SharedNode `json:"node"`
	Score         float64    `json:"score"`
	Parts         ScoreParts `json:"score_parts"`
	AvailableMbps int        `json:"available_mbps"`
	RemainingGB   float64    `json:"remaining_traffic_gb"`
}

// Session is the network session between a consumer's client and a provider node.
type Session struct {
	ContractVersion int     `json:"contract_version"`
	SpeedLimitMbps  int     `json:"speed_limit_mbps"`
	SecurityHold    bool    `json:"security_hold"`
	TariffRevision  int64   `json:"tariff_revision"`
	RateMicros      int64   `json:"rate_micros"`
	QuotaBytes      int64   `json:"quota_bytes"`
	ReserveMicros   int64   `json:"reserve_micros"`
	ID              string  `json:"id"`
	ChangeSeq       int64   `json:"change_seq"`
	NodeID          string  `json:"node_id"`
	ProviderID      string  `json:"provider_participant_id"`
	ConsumerID      string  `json:"consumer_participant_id"`
	ClientRef       string  `json:"client_ref"` // UUID; also the VLESS client UUID
	ClientEntityID  int64   `json:"client_entity_id,omitempty"`
	Protocol        string  `json:"protocol"`
	InboundTag      string  `json:"inbound_tag"`
	QuotaGB         float64 `json:"quota_gb"`
	Status          string  `json:"status"`
	// Link is filled by the coordinator once the session is active: everything a
	// consumer panel needs to build a share-link for its subscription.
	Link            *SessionLink `json:"link,omitempty"`
	ServedUpBytes   int64        `json:"served_up_bytes"`
	ServedDownBytes int64        `json:"served_down_bytes"`
	OpenedAt        int64        `json:"opened_at"`
	LastUsageAt     int64        `json:"last_usage_at"`
	ClosedAt        int64        `json:"closed_at"`
	CloseReason     string       `json:"close_reason"`
	ReserveCredits  float64      `json:"reserve_credits"`
}

// SessionLink carries connectivity data for the consumer's subscription.
type SessionLink struct {
	ProbeUUID      string         `json:"probe_uuid,omitempty"` // service-only credential, excluded from customer billing
	Protocol       string         `json:"protocol"`
	EndpointHost   string         `json:"endpoint_host"`
	EndpointPort   int            `json:"endpoint_port"`
	AccessTemplate AccessTemplate `json:"access_template"`
	ClientUUID     string         `json:"client_uuid"`  // == ClientRef
	ClientEmail    string         `json:"client_email"` // sn-<hex(client_ref)>, provider-side stats key
	// Provision is non-nil only in provider sync responses: command to create
	// the user on the provider's node.
	Provision *ProvisionCommand `json:"provision,omitempty"`
}

// ProvisionCommand tells a provider panel which user to create on which node.
type ProvisionCommand struct {
	ProbeUUID   string `json:"probe_uuid,omitempty"`
	NodeRef     string `json:"node_ref"` // provider-local node id
	InboundTag  string `json:"inbound_tag"`
	ClientUUID  string `json:"client_uuid"`
	ClientEmail string `json:"client_email"`
	Protocol    string `json:"protocol"`
}

// UsageReport is one provider-side traffic report (cumulative, monotonic seq).
type UsageReport struct {
	Evidence     *NodeEvidence `json:"evidence,omitempty"`
	SessionID    string        `json:"session_id"`
	Seq          int64         `json:"seq"`
	UpBytes      int64         `json:"up_bytes"`
	DownBytes    int64         `json:"down_bytes"`
	CumUpBytes   int64         `json:"cum_up_bytes"`
	CumDownBytes int64         `json:"cum_down_bytes"`
	Ts           int64         `json:"ts"`
	Signature    string        `json:"signature"` // ed25519 over canonical report JSON (sans signature)
}

// LivenessItem is a consumer-side session activity report.
type LivenessItem struct {
	SessionID string `json:"session_id"`
	State     string `json:"state"` // active | idle
	Ts        int64  `json:"ts"`
}

// LedgerEntry is one append-only accounting record.
type LedgerEntry struct {
	EntryUID       string  `json:"entry_uid"`
	Ts             int64   `json:"ts"`
	Direction      string  `json:"direction"`
	AmountCredits  float64 `json:"amount_credits"`
	AmountBytes    int64   `json:"amount_bytes"`
	CounterpartyID string  `json:"counterparty_participant_id,omitempty"`
	SessionID      string  `json:"session_id,omitempty"`
	Status         string  `json:"status"`
	Reason         string  `json:"reason"`
	Memo           string  `json:"memo"`
}

// EnrollRequest/Response bootstrap a panel into the network.
type EnrollRequest struct {
	InviteCode       string `json:"invite_code"`
	Name             string `json:"name"`
	CSRPem           string `json:"csr_pem"`
	SigningPublicKey string `json:"signing_public_key"` // base64 raw ed25519
	PanelVersion     string `json:"panel_version"`
}

type EnrollResponse struct {
	ParticipantID         string  `json:"participant_id"`
	CertificatePEM        string  `json:"certificate_pem"`
	CertificateExpiresAt  int64   `json:"certificate_expires_at"`
	CAPEM                 string  `json:"ca_pem"`
	InitialBalanceCredits float64 `json:"initial_balance_credits"`
}

// MeResponse is the panel's own network state.
type MeResponse struct {
	HeldCredits         float64 `json:"held_credits"`
	ParticipantID       string  `json:"participant_id"`
	Name                string  `json:"name"`
	Status              string  `json:"status"`
	BalanceCredits      float64 `json:"balance_credits"`
	ReservedCredits     float64 `json:"reserved_credits"`
	EarnedPeriodCredits float64 `json:"earned_period_credits"`
	SpentPeriodCredits  float64 `json:"spent_period_credits"`
	EmergencyShutdown   bool    `json:"emergency_shutdown"`
	Limits              Limits  `json:"limits"`
	ServerTime          int64   `json:"server_time"`
}

// Limits are per-participant beta guardrails.
type Limits struct {
	MaxSessions                   int     `json:"max_sessions"`
	MaxPairTurnoverCredits        float64 `json:"max_pair_turnover_credits"`
	MaxParticipantTurnoverCredits float64 `json:"max_participant_turnover_credits"`
}

// API error envelope.
type ErrorResponse struct {
	Code    string `json:"error"`
	Message string `json:"message"`
}

func (e ErrorResponse) Error() string { return e.Code + ": " + e.Message }

// CanonicalJSON marshals v with sorted keys (encoding/json sorts map keys by
// default; struct field order is fixed here) for signatures.
func CanonicalReportForSignature(r UsageReport) ([]byte, error) {
	type canonical struct {
		EvidenceHash string `json:"evidence_hash,omitempty"`
		SessionID    string `json:"session_id"`
		Seq          int64  `json:"seq"`
		UpBytes      int64  `json:"up_bytes"`
		DownBytes    int64  `json:"down_bytes"`
		CumUpBytes   int64  `json:"cum_up_bytes"`
		CumDownBytes int64  `json:"cum_down_bytes"`
		Ts           int64  `json:"ts"`
	}
	evidenceHash := ""
	if r.Evidence != nil {
		digest, err := r.Evidence.Digest()
		if err != nil {
			return nil, err
		}
		evidenceHash = digest.String()
	}
	return json.Marshal(canonical{EvidenceHash: evidenceHash,
		SessionID: r.SessionID, Seq: r.Seq, UpBytes: r.UpBytes, DownBytes: r.DownBytes,
		CumUpBytes: r.CumUpBytes, CumDownBytes: r.CumDownBytes, Ts: r.Ts,
	})
}

// EconomyPolicy is operator-managed. Credits are service units, not cash claims.
type EconomyPolicy struct {
	Revision    int64 `json:"revision"`
	RateMicros  int64 `json:"rate_micros"`
	HoldSeconds int64 `json:"hold_seconds"`
	UpdatedAt   int64 `json:"updated_at"`
}
