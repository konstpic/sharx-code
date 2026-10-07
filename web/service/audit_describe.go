package service

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/web/websocket"
)

// The audit trail is shown like every other journal in the panel (nodes, balancers, the panel itself): one readable
// sentence per event - who did what to which object and how it ended - followed by key=value fields.

func quote(s string) string { return `"` + s + `"` }

func stateMap(s string) map[string]any {
	if s == "" {
		return nil
	}
	var m map[string]any
	_ = json.Unmarshal([]byte(s), &m)
	return m
}

func strOf(m map[string]any, k string) string {
	if v, ok := m[k]; ok && v != nil {
		return fmt.Sprint(v)
	}
	return ""
}

func permList(m map[string]any) []string {
	var out []string
	if arr, ok := m["permissions"].([]any); ok {
		for _, v := range arr {
			out = append(out, fmt.Sprint(v))
		}
	}
	sort.Strings(out)
	return out
}

func permDiff(before, after []string) (added, removed []string) {
	b, a := map[string]bool{}, map[string]bool{}
	for _, p := range before {
		b[p] = true
	}
	for _, p := range after {
		a[p] = true
		if !b[p] {
			added = append(added, p)
		}
	}
	for _, p := range before {
		if !a[p] {
			removed = append(removed, p)
		}
	}
	return
}

func clip(list []string, n int) string {
	if len(list) > n {
		return strings.Join(list[:n], ", ") + fmt.Sprintf(" and %d more", len(list)-n)
	}
	return strings.Join(list, ", ")
}

// DescribeAudit turns one audit row into a log level and a sentence with fields.
func DescribeAudit(e model.AuditLog) (level, component, message string) {
	actor := e.ActorName
	if actor == "" {
		actor = "someone"
	}
	target := quote(e.TargetName)
	before, after := stateMap(e.Before), stateMap(e.After)
	denied := e.Result != "ok"

	var what string // the action as a verb phrase ("created user X")
	switch e.Action {
	case "user.create":
		what = fmt.Sprintf("created user %s with role %s", target, quote(strOf(after, "role")))
	case "user.update":
		var ch []string
		if strOf(before, "username") != strOf(after, "username") && after != nil {
			ch = append(ch, fmt.Sprintf("renamed to %s", quote(strOf(after, "username"))))
		}
		what = fmt.Sprintf("changed user %s", target)
		if len(ch) > 0 {
			what += " (" + strings.Join(ch, ", ") + ")"
		}
	case "user.role_change":
		what = fmt.Sprintf("changed the role of user %s from %s to %s", target, quote(strOf(before, "role")), quote(strOf(after, "role")))
	case "user.disable":
		what = fmt.Sprintf("disabled user %s (sessions and API tokens ended)", target)
	case "user.enable":
		what = fmt.Sprintf("enabled user %s", target)
	case "user.delete":
		what = fmt.Sprintf("deleted user %s (role %s)", target, quote(strOf(before, "role")))
	case "user.password_reset":
		what = fmt.Sprintf("set a new password for user %s (their sessions ended)", target)
	case "user.two_factor_reset":
		what = fmt.Sprintf("reset two-factor authentication of user %s (their sessions ended)", target)
	case "user.two_factor_enable":
		what = "turned on two-factor authentication for their own account"
	case "user.two_factor_disable":
		what = "turned off two-factor authentication for their own account"
	case "role.create":
		perms := permList(after)
		what = fmt.Sprintf("created role %s with %d permission(s)", target, len(perms))
	case "role.update":
		added, removed := permDiff(permList(before), permList(after))
		what = fmt.Sprintf("changed role %s", target)
		var parts []string
		if len(added) > 0 {
			parts = append(parts, "granted "+clip(added, 6))
		}
		if len(removed) > 0 {
			parts = append(parts, "revoked "+clip(removed, 6))
		}
		if strOf(before, "name") != "" && strOf(before, "name") != strOf(after, "name") {
			parts = append(parts, fmt.Sprintf("renamed from %s", quote(strOf(before, "name"))))
		}
		if len(parts) > 0 {
			what += " (" + strings.Join(parts, "; ") + ")"
		}
	case "role.delete":
		what = fmt.Sprintf("deleted role %s", target)
	case "access.denied":
		what = fmt.Sprintf("call %s", e.TargetName)
	default:
		what = fmt.Sprintf("performed %s", e.Action)
		if e.TargetName != "" {
			what += " on " + target
		}
	}

	if denied {
		level = "warn"
		message = fmt.Sprintf("%s tried to %s - refused", actor, strings.Replace(what, " (their sessions ended)", "", 1))
		if e.Action == "access.denied" {
			message = fmt.Sprintf("%s was refused %s", actor, what)
		}
		if e.Detail != "" {
			message += ": " + e.Detail
		}
	} else {
		level = "info"
		message = fmt.Sprintf("%s %s", actor, what)
		if e.Detail != "" {
			message += ": " + e.Detail
		}
	}
	message += fmt.Sprintf(" result=%s", map[bool]string{true: "refused", false: "ok"}[denied])
	if e.IP != "" {
		message += " ip=" + e.IP
	}
	if e.TargetId != "" {
		message += " id=" + e.TargetId
	}
	component = e.TargetType
	if component == "" {
		component = "access"
	}
	return level, component, message
}

// auditEntries reads the audit trail as journal entries (newest first), limited to the query window.
func auditEntries(since, until int64, max int) []websocket.UnifiedLogEntry {
	db := database.GetDB().Model(&model.AuditLog{})
	if since > 0 {
		db = db.Where("ts >= ?", since)
	}
	if until > 0 {
		db = db.Where("ts <= ?", until)
	}
	var rows []model.AuditLog
	if err := db.Order("ts DESC, id DESC").Limit(max).Find(&rows).Error; err != nil {
		logger.Warningf("audit journal: %v", err)
		return nil
	}
	out := make([]websocket.UnifiedLogEntry, 0, len(rows))
	for _, r := range rows {
		lv, comp, msg := DescribeAudit(r)
		out = append(out, websocket.UnifiedLogEntry{Source: "panel", Channel: "audit", Level: lv, Message: msg, Ts: r.Ts, Component: comp, EntityType: "audit", EntityID: "0"})
	}
	return out
}

// PurgeAuditOlderThan applies the same retention as the other journals (log rotation "max age"): older rows are removed.
func PurgeAuditOlderThan(days int) (int64, error) {
	if days < 1 {
		return 0, nil
	}
	cutoff := time.Now().UnixMilli() - int64(days)*24*3600*1000
	res := database.GetDB().Where("ts < ?", cutoff).Delete(&model.AuditLog{})
	return res.RowsAffected, res.Error
}
