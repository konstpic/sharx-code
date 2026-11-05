package model

// SharX Network panel-side models (tables sn_*, migration 0075_network_panel.sql).

// SnParticipant is the single-row local record of this panel's network enrollment.
type SnParticipant struct {
	Id                 int    `json:"id" gorm:"primaryKey"`
	ParticipantID      string `json:"participantId" gorm:"column:participant_id"`
	CoordinatorURL     string `json:"coordinatorUrl" gorm:"column:coordinator_url"`
	Name               string `json:"name"`
	Status             string `json:"status" gorm:"default:disabled"` // disabled | enrolling | active | suspended | error
	Enabled            bool   `json:"enabled" gorm:"default:false"`
	TLSCertPEM         string `json:"-" gorm:"column:tls_cert_pem"`
	TLSKeyPEM          string `json:"-" gorm:"column:tls_key_pem"`
	CaPEM              string `json:"-" gorm:"column:ca_pem"`
	SigningPublicKey   string `json:"-" gorm:"column:signing_public_key"`
	SigningPrivateKey  string `json:"-" gorm:"column:signing_private_key"`
	RiskAckVersion     string `json:"riskAckVersion" gorm:"column:risk_ack_version"`
	RiskAckAt          int64  `json:"riskAckAt" gorm:"column:risk_ack_at"`
	EnrolledAt         int64  `json:"enrolledAt" gorm:"column:enrolled_at"`
	LastSyncAt         int64  `json:"lastSyncAt" gorm:"column:last_sync_at"`
	SyncCursor         int64  `json:"syncCursor" gorm:"column:sync_cursor"`
	SyncCursorConsumer int64  `json:"syncCursorConsumer" gorm:"column:sync_cursor_consumer"`
	LedgerCursor       int64  `json:"ledgerCursor" gorm:"column:ledger_cursor"`
	CreatedAt          int64  `json:"createdAt" gorm:"autoCreateTime"`
	UpdatedAt          int64  `json:"updatedAt" gorm:"autoUpdateTime"`
}

func (SnParticipant) TableName() string { return "sn_participant" }

// SnSharedNode is a local node the owner chose to publish to SharX Network.
type SnSharedNode struct {
	Id                  int     `json:"id" gorm:"primaryKey;autoIncrement"`
	NodeId              int     `json:"nodeId" gorm:"column:node_id"`
	CoordinatorNodeId   string  `json:"coordinatorNodeId" gorm:"column:coordinator_node_id"`
	Label               string  `json:"label"`
	Protocols           string  `json:"protocols" gorm:"type:text"` // JSON array
	TrafficLimitGB      float64 `json:"trafficLimitGB" gorm:"column:traffic_limit_gb"`
	SpeedLimitMbps      int     `json:"speedLimitMbps" gorm:"column:speed_limit_mbps"`
	ReserveMbps         int     `json:"reserveMbps" gorm:"column:reserve_mbps"`
	MaxSessions         int     `json:"maxSessions" gorm:"column:max_sessions"`
	PriceCreditsPerGB   float64 `json:"priceCreditsPerGB" gorm:"column:price_credits_per_gb"`
	Enabled             bool    `json:"enabled" gorm:"default:false"`
	Paused              bool    `json:"paused" gorm:"default:false"`
	RiskAck             bool    `json:"riskAck" gorm:"column:risk_ack;default:false"`
	Status              string  `json:"status" gorm:"default:draft"` // draft | publishing | published | draining | error
	Error               string  `json:"error"`
	CoordinatorSnapshot string  `json:"coordinatorSnapshot" gorm:"column:coordinator_snapshot;type:text"` // JSON snapshot from coordinator
	CreatedAt           int64   `json:"createdAt" gorm:"autoCreateTime"`
	UpdatedAt           int64   `json:"updatedAt" gorm:"autoUpdateTime"`
}

func (SnSharedNode) TableName() string { return "sn_shared_node" }

// SnSession is the local mirror of a network session (provider or consumer role).
type SnSession struct {
	Id                string  `json:"id" gorm:"primaryKey"`
	Role              string  `json:"role"` // provider | consumer
	CoordinatorNodeId string  `json:"coordinatorNodeId" gorm:"column:coordinator_node_id"`
	PeerParticipantId string  `json:"peerParticipantId" gorm:"column:peer_participant_id"`
	NodeId            *int    `json:"nodeId" gorm:"column:node_id"`
	InboundId         *int    `json:"inboundId" gorm:"column:inbound_id"`
	ClientEntityId    *int    `json:"clientEntityId" gorm:"column:client_entity_id"`
	ClientRef         string  `json:"clientRef" gorm:"column:client_ref"`
	ClientEmail       string  `json:"clientEmail" gorm:"column:client_email"`
	Link              string  `json:"link" gorm:"type:text"` // JSON protocol.SessionLink
	Protocol          string  `json:"protocol"`
	QuotaGB           float64 `json:"quotaGB" gorm:"column:quota_gb"`
	Status            string  `json:"status"`
	UsageUpBytes      int64   `json:"usageUpBytes" gorm:"column:usage_up_bytes"`
	UsageDownBytes    int64   `json:"usageDownBytes" gorm:"column:usage_down_bytes"`
	SyncSeq           int64   `json:"syncSeq" gorm:"column:sync_seq"`
	OpenedAt          int64   `json:"openedAt" gorm:"column:opened_at"`
	ClosedAt          int64   `json:"closedAt" gorm:"column:closed_at"`
	UpdatedAt         int64   `json:"updatedAt" gorm:"autoUpdateTime"`
}

func (SnSession) TableName() string { return "sn_session" }

// SnUsageMirror keeps provider-side usage reports locally for reconciliation.
type SnUsageMirror struct {
	SessionID    string `json:"sessionId" gorm:"column:session_id;primaryKey"`
	Seq          int    `json:"seq" gorm:"primaryKey"`
	UpBytes      int64  `json:"upBytes" gorm:"column:up_bytes"`
	DownBytes    int64  `json:"downBytes" gorm:"column:down_bytes"`
	CumUpBytes   int64  `json:"cumUpBytes" gorm:"column:cum_up_bytes"`
	CumDownBytes int64  `json:"cumDownBytes" gorm:"column:cum_down_bytes"`
	ReportedAt   int64  `json:"reportedAt" gorm:"column:reported_at"`
}

func (SnUsageMirror) TableName() string { return "sn_usage_mirror" }

// SnLedgerMirror is the local read model of the coordinator ledger.
type SnLedgerMirror struct {
	EntryUID                  string  `json:"entryUid" gorm:"column:entry_uid;primaryKey"`
	Direction                 string  `json:"direction"`
	AmountCredits             float64 `json:"amountCredits" gorm:"column:amount_credits"`
	AmountBytes               int64   `json:"amountBytes" gorm:"column:amount_bytes"`
	CounterpartyParticipantID string  `json:"counterpartyParticipantId" gorm:"column:counterparty_participant_id"`
	SessionID                 string  `json:"sessionId" gorm:"column:session_id"`
	Status                    string  `json:"status"`
	Reason                    string  `json:"reason"`
	Memo                      string  `json:"memo"`
	Ts                        int64   `json:"ts"`
}

func (SnLedgerMirror) TableName() string { return "sn_ledger_mirror" }

// SnProvisionQueue holds at-least-once commands to provision/deprovision users
// on the panel's own worker nodes.
type SnProvisionQueue struct {
	Id            int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	SessionID     string `json:"sessionId" gorm:"column:session_id"`
	NodeId        int    `json:"nodeId" gorm:"column:node_id"`
	Op            string `json:"op"`                            // add_user | remove_user
	Payload       string `json:"payload" gorm:"type:text"`      // JSON
	Status        string `json:"status" gorm:"default:pending"` // pending | done | failed
	Attempts      int    `json:"attempts" gorm:"default:0"`
	NextAttemptAt int64  `json:"nextAttemptAt" gorm:"column:next_attempt_at"`
	CreatedAt     int64  `json:"createdAt" gorm:"autoCreateTime"`
	UpdatedAt     int64  `json:"updatedAt" gorm:"autoUpdateTime"`
}

func (SnProvisionQueue) TableName() string { return "sn_provision_queue" }
