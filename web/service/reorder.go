package service

import (
	"errors"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"gorm.io/gorm"
)

// mergeOrder returns the full ordering: the requested ids first (in the given order, only ids that exist,
// duplicates ignored), then every remaining id in its current order. That makes a partial or stale request safe.
func mergeOrder(current, requested []int) []int {
	exists := make(map[int]bool, len(current))
	for _, id := range current {
		exists[id] = true
	}
	seen := make(map[int]bool, len(current))
	out := make([]int, 0, len(current))
	for _, id := range requested {
		if exists[id] && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	for _, id := range current {
		if !seen[id] {
			out = append(out, id)
		}
	}
	return out
}

// ReorderInbounds stores a new manual order for the user's inbounds (positions 1..n).
func (s *InboundService) ReorderInbounds(userId int, ids []int) error {
	if len(ids) == 0 {
		return errors.New("ids are required")
	}
	db := database.GetDB()
	var current []int
	if err := db.Model(&model.Inbound{}).Where("user_id = ?", userId).Order("sort_order ASC, id ASC").Pluck("id", &current).Error; err != nil {
		return err
	}
	final := mergeOrder(current, ids)
	return db.Transaction(func(tx *gorm.DB) error {
		for i, id := range final {
			if err := tx.Exec("UPDATE inbounds SET sort_order = ? WHERE id = ? AND user_id = ?", i+1, id, userId).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ReorderNodes stores a new manual order for all nodes (positions 1..n).
func (s *NodeService) ReorderNodes(ids []int) error {
	if len(ids) == 0 {
		return errors.New("ids are required")
	}
	db := database.GetDB()
	var current []int
	if err := db.Model(&model.Node{}).Order("sort_order ASC, id ASC").Pluck("id", &current).Error; err != nil {
		return err
	}
	final := mergeOrder(current, ids)
	return db.Transaction(func(tx *gorm.DB) error {
		for i, id := range final {
			if err := tx.Exec("UPDATE nodes SET sort_order = ? WHERE id = ?", i+1, id).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
