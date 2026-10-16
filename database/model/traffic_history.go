package model

// Origins retain the existing accumulated volume without inventing timestamps for it.
type TrafficHistoryOrigin struct {
	Kind      string `gorm:"primaryKey;size:8"`
	EntityID  int    `gorm:"primaryKey"`
	NodeID    int    `gorm:"primaryKey"`
	Up        int64
	Down      int64
	StartedAt int64
}

func (TrafficHistoryOrigin) TableName() string { return "traffic_history_origins" }

// Minute buckets are retained for detailed charts, daily buckets preserve older volume.
// NodeID -1 is the entity total; 0 is unattributed; positive IDs are worker nodes.
type TrafficHistoryBucket struct {
	Kind       string `gorm:"primaryKey;size:8"`
	EntityID   int    `gorm:"primaryKey"`
	NodeID     int    `gorm:"primaryKey"`
	Resolution int    `gorm:"primaryKey"`
	Bucket     int64  `gorm:"primaryKey"`
	Up         int64
	Down       int64
}

func (TrafficHistoryBucket) TableName() string { return "traffic_history_buckets" }

type TrafficHistoryCoverage struct {
	Kind       string `gorm:"primaryKey;size:8"`
	EntityID   int    `gorm:"primaryKey"`
	Resolution int    `gorm:"primaryKey"`
	Bucket     int64  `gorm:"primaryKey"`
}

func (TrafficHistoryCoverage) TableName() string { return "traffic_history_coverage" }

// ClientNodePresence remembers on which node a client was last seen online (one row per client and node).
// Timestamps are unix milliseconds. Rows disappear only through ON DELETE CASCADE (migration 0071).
type ClientNodePresence struct {
	ClientID    int   `gorm:"primaryKey;column:client_id"`
	NodeID      int   `gorm:"primaryKey;column:node_id"`
	FirstSeenAt int64 `gorm:"column:first_seen_at"`
	LastSeenAt  int64 `gorm:"column:last_seen_at"`
	Sessions    int64 `gorm:"column:sessions"`
}

func (ClientNodePresence) TableName() string { return "client_node_presence" }

// ClientConnectedNode is the API view of one ClientNodePresence row (plus the live online flag).
type ClientConnectedNode struct {
	NodeId     int    `json:"nodeId"`
	NodeName   string `json:"nodeName"`
	LastSeenAt int64  `json:"lastSeenAt"` // unix ms
	Online     bool   `json:"online"`
}
