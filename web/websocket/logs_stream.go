package websocket

// Log stream sources are encoded into logger.Entry.Source.
const (
	LogStreamSourcePanel = "panel"
	LogStreamSourceXray  = "xray"
	LogStreamSourceNode  = "node"
)

// UnifiedLogEntry is the payload shape consumed by dashboard logs UI.
// Keep JSON field names aligned with `panel/components/DashboardPage.tsx`.
type UnifiedLogEntry struct {
	Source   string `json:"source"`            // panel|xray|node
	Channel  string `json:"channel,omitempty"` // access|service|...
	Level    string `json:"level"`             // debug|info|notice|warn|warning|error
	Message  string `json:"message"`           // log line
	Ts       int64  `json:"ts"`                // unix milliseconds
	NodeID   string `json:"nodeId,omitempty"`
	NodeName string `json:"nodeName,omitempty"`
	// Component is the subsystem (xray, amneziawg, telemt, routing, health, ...). EntityType/EntityID (node, balancer)
	// select the per-entity journal; ConnID correlates the events of one connection.
	Component  string `json:"component,omitempty"`
	EntityType string `json:"entityType,omitempty"`
	EntityID   string `json:"entityId,omitempty"`
	ConnID     string `json:"connId,omitempty"`
}
