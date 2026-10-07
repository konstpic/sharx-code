package service

import (
	"encoding/json"

	"github.com/konstpic/sharx-code/v2/database/model"
)

// An inbound row carries three kinds of sensitive data that belong to different permissions:
//
//   - the client list inside settings ("clients", WireGuard/AmneziaWG "peers"): client credentials, owned by clients:*;
//   - server secrets (Reality private key, TLS private keys, SOCKS/HTTP account passwords): owned by inbounds:update, because
//     whoever can read them can impersonate the server;
//   - everything else (name, port, protocol, transport): inbounds:read.
//
// These helpers apply that split on the way out (redaction) and on the way in (the guard), so inbounds:update cannot be used
// to read or rewrite clients, and inbounds:read does not hand out keys.

// clientListKeys are the settings keys that hold client credentials.
var clientListKeys = []string{"clients", "peers"}

// RedactInbound returns a copy of the inbound without the parts the caller may not see. The original is not modified (it may
// be shared with a broadcast to other users).
func RedactInbound(in *model.Inbound, canClients, canSecrets bool) *model.Inbound {
	if in == nil || (canClients && canSecrets) {
		return in
	}
	out := *in
	if !canClients {
		out.ClientStats = nil
		out.Settings = mutateJSON(in.Settings, func(m map[string]any) {
			for _, k := range clientListKeys {
				if _, ok := m[k]; ok {
					m[k] = []any{}
				}
			}
		})
	}
	if !canSecrets {
		out.Settings = mutateJSON(out.Settings, func(m map[string]any) {
			if accs, ok := m["accounts"].([]any); ok {
				for _, a := range accs {
					if am, ok := a.(map[string]any); ok {
						if _, has := am["pass"]; has {
							am["pass"] = ""
						}
					}
				}
			}
			for _, k := range []string{"privateKey", "preSharedKey", "psk", "password", "auth"} {
				if _, ok := m[k]; ok {
					m[k] = ""
				}
			}
		})
		out.StreamSettings = mutateJSON(in.StreamSettings, func(m map[string]any) {
			if rs, ok := m["realitySettings"].(map[string]any); ok {
				rs["privateKey"] = ""
			}
			if ts, ok := m["tlsSettings"].(map[string]any); ok {
				if certs, ok := ts["certificates"].([]any); ok {
					for _, c := range certs {
						if cm, ok := c.(map[string]any); ok {
							if _, has := cm["key"]; has {
								cm["key"] = []any{}
							}
						}
					}
				}
			}
		})
	}
	return &out
}

// RedactInbounds applies RedactInbound to a list.
func RedactInbounds(list []*model.Inbound, canClients, canSecrets bool) []*model.Inbound {
	if canClients && canSecrets {
		return list
	}
	out := make([]*model.Inbound, 0, len(list))
	for _, in := range list {
		out = append(out, RedactInbound(in, canClients, canSecrets))
	}
	return out
}

// GuardInboundClients makes sure a caller who may not manage clients cannot change them through an inbound request. The
// client lists of the incoming settings are replaced by the stored ones (an update) or emptied (a new inbound); a caller who
// holds the client permissions is left alone. existing is nil for a new inbound. It returns true when something was replaced,
// so the handler can tell the caller their client changes were ignored.
func GuardInboundClients(incoming *model.Inbound, existing *model.Inbound, canManageClients bool) bool {
	if incoming == nil || canManageClients {
		return false
	}
	changed := false
	var stored map[string]any
	if existing != nil {
		_ = json.Unmarshal([]byte(existing.Settings), &stored)
	}
	incoming.Settings = mutateJSON(incoming.Settings, func(m map[string]any) {
		for _, k := range clientListKeys {
			cur, had := m[k]
			var keep any = []any{}
			if v, ok := stored[k]; ok {
				keep = v
			}
			if !had && (stored == nil || stored[k] == nil) {
				continue
			}
			a, _ := json.Marshal(cur)
			b, _ := json.Marshal(keep)
			if string(a) != string(b) {
				changed = true
			}
			m[k] = keep
		}
	})
	return changed
}

// mutateJSON parses raw as a JSON object, applies fn and re-encodes it. Input that is not a JSON object is returned as is.
func mutateJSON(raw string, fn func(map[string]any)) string {
	if raw == "" {
		return raw
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil || m == nil {
		return raw
	}
	fn(m)
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return raw
	}
	return string(b)
}
