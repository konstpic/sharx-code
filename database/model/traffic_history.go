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
