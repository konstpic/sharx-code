package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"gorm.io/gorm"
)

// Organizations are tenants: a named set of users and client groups. An account that belongs to an organization is limited
// to the client groups of that organization and the clients in them (the scope guard in the controller enforces it for every
// request); accounts without an organization are not limited. The model is deliberately small: the unit of ownership is the
// client group, because that is what a client already belongs to.

// OrgView is an organization for the UI.
type OrgView struct {
	Id          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Users       int64  `json:"users"`
	Groups      int64  `json:"groups"`
	CreatedAt   int64  `json:"createdAt"`
}

// ListOrgs returns the organizations with their sizes.
func (s *RBACService) ListOrgs() ([]OrgView, error) {
	var rows []model.Organization
	if err := database.GetDB().Order("name").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]OrgView, 0, len(rows))
	for _, o := range rows {
		v := OrgView{Id: o.Id, Name: o.Name, Description: o.Description, CreatedAt: o.CreatedAt}
		database.GetDB().Model(&model.User{}).Where("org_id = ? AND deleted_at IS NULL", o.Id).Count(&v.Users)
		database.GetDB().Model(&model.ClientGroup{}).Where("org_id = ?", o.Id).Count(&v.Groups)
		out = append(out, v)
	}
	return out, nil
}

// SaveOrg creates (id 0) or renames an organization.
func (s *RBACService) SaveOrg(a Actor, id int, name, description string) (*OrgView, error) {
	name, err := cleanName(name, 100, "organization name")
	if err != nil {
		return nil, err
	}
	var o model.Organization
	err = withLock(func(tx *gorm.DB) error {
		var n int64
		q := tx.Model(&model.Organization{}).Where("LOWER(name) = LOWER(?)", name)
		if id != 0 {
			q = q.Where("id <> ?", id)
		}
		q.Count(&n)
		if n > 0 {
			return conflict("an organization named %q already exists", name)
		}
		now := time.Now().Unix()
		if id == 0 {
			o = model.Organization{Name: name, Description: strings.TrimSpace(description), CreatedAt: now, UpdatedAt: now}
			return tx.Create(&o).Error
		}
		if err := tx.First(&o, id).Error; err != nil {
			return notFound("organization")
		}
		o.Name, o.Description, o.UpdatedAt = name, strings.TrimSpace(description), now
		return tx.Save(&o).Error
	})
	if err != nil {
		return nil, err
	}
	action := "org.update"
	if id == 0 {
		action = "org.create"
	}
	Audit.Record(a, action, "organization", fmt.Sprint(o.Id), o.Name, nil, map[string]any{"name": o.Name}, "ok", "")
	return &OrgView{Id: o.Id, Name: o.Name, Description: o.Description, CreatedAt: o.CreatedAt}, nil
}

// DeleteOrg removes an empty organization.
func (s *RBACService) DeleteOrg(a Actor, id int) error {
	var o model.Organization
	err := withLock(func(tx *gorm.DB) error {
		if err := tx.First(&o, id).Error; err != nil {
			return notFound("organization")
		}
		var users, groups int64
		tx.Model(&model.User{}).Where("org_id = ? AND deleted_at IS NULL", id).Count(&users)
		tx.Model(&model.ClientGroup{}).Where("org_id = ?", id).Count(&groups)
		if users > 0 || groups > 0 {
			return conflict("the organization still has %d user(s) and %d group(s): move them out first", users, groups)
		}
		return tx.Delete(&model.Organization{}, id).Error
	})
	if err != nil {
		return err
	}
	Audit.Record(a, "org.delete", "organization", fmt.Sprint(id), o.Name, map[string]any{"name": o.Name}, nil, "ok", "")
	return nil
}

// SetGroupOrg hands a client group to an organization (orgID nil: to nobody). Its clients follow, because scope is decided by
// the group a client is in.
func (s *RBACService) SetGroupOrg(a Actor, groupID int, orgID *int) error {
	var g model.ClientGroup
	var orgName string
	err := withLock(func(tx *gorm.DB) error {
		if err := tx.First(&g, groupID).Error; err != nil {
			return notFound("group")
		}
		if orgID != nil {
			var o model.Organization
			if err := tx.First(&o, *orgID).Error; err != nil {
				return invalid("organization does not exist")
			}
			orgName = o.Name
		}
		return tx.Model(&model.ClientGroup{}).Where("id = ?", groupID).Update("org_id", orgID).Error
	})
	if err != nil {
		return err
	}
	Audit.Record(a, "group.org", "group", fmt.Sprint(groupID), g.Name, map[string]any{"orgId": g.OrgId}, map[string]any{"orgId": orgID, "org": orgName}, "ok", "")
	return nil
}

// OrgGroupIDs lists the client groups an organization owns.
func OrgGroupIDs(orgID int) []int {
	var ids []int
	database.GetDB().Model(&model.ClientGroup{}).Where("org_id = ?", orgID).Pluck("id", &ids)
	return ids
}

// ClientInOrg reports whether the client belongs to a group of the organization.
func ClientInOrg(orgID, clientID int) bool {
	var n int64
	database.GetDB().Raw(`SELECT COUNT(*) FROM client_entities c JOIN client_groups g ON g.id = c.group_id WHERE c.id = ? AND g.org_id = ?`, clientID, orgID).Scan(&n)
	return n > 0
}

// GroupInOrg reports whether the group belongs to the organization.
func GroupInOrg(orgID, groupID int) bool {
	var n int64
	database.GetDB().Model(&model.ClientGroup{}).Where("id = ? AND org_id = ?", groupID, orgID).Count(&n)
	return n > 0
}
