package service

import (
	"encoding/json"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
)

// auditService writes and reads the audit trail of access-control changes (users, roles, role assignment, denied
// attempts). The panel had no audit mechanism before; this is deliberately small and append-only.
type auditService struct{}

// Audit is the shared audit trail.
var Audit = auditService{}

func jsonOrEmpty(v any) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// Record appends one entry. It never fails the operation that is being audited: an error is logged and swallowed.
func (auditService) Record(a Actor, action, targetType, targetID, targetName string, before, after any, result, detail string) {
	e := model.AuditLog{
		Ts: time.Now().UnixMilli(), Action: action, TargetType: targetType, TargetId: targetID, TargetName: targetName,
		Before: jsonOrEmpty(before), After: jsonOrEmpty(after), IP: a.IP, Result: result, Detail: detail,
	}
	if a.Principal != nil {
		id := a.Principal.UserId
		e.ActorId, e.ActorName = &id, a.Principal.Username
	}
	if err := database.GetDB().Create(&e).Error; err != nil {
		logger.Warningf("audit: cannot record %s: %v", action, err)
		return
	}
	logger.WithComponent("audit").Infof("%s by %s on %s %q (%s)%s", action, e.ActorName, targetType, targetName, result, map[bool]string{true: ": " + detail, false: ""}[detail != ""])
}

// AuditQuery filters the trail.
type AuditQuery struct {
	Limit      int
	BeforeID   int64
	Action     string
	TargetType string
	Result     string
}

// List returns entries newest first.
func (auditService) List(q AuditQuery) ([]model.AuditLog, error) {
	if q.Limit <= 0 || q.Limit > 500 {
		q.Limit = 100
	}
	db := database.GetDB().Model(&model.AuditLog{})
	if q.BeforeID > 0 {
		db = db.Where("id < ?", q.BeforeID)
	}
	if q.Action != "" {
		db = db.Where("action LIKE ?", q.Action+"%")
	}
	if q.TargetType != "" {
		db = db.Where("target_type = ?", q.TargetType)
	}
	if q.Result != "" {
		db = db.Where("result = ?", q.Result)
	}
	var rows []model.AuditLog
	err := db.Order("id DESC").Limit(q.Limit).Find(&rows).Error
	return rows, err
}
