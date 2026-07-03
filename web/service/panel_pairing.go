package service

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/pairing_outbound"
	"github.com/konstpic/sharx-code/v2/util/random"

	"gorm.io/gorm"
)

const nodeAuthSecretLen = 128

// PanelPairingService owns the panel-wide SECRET_KEY shared by every SharX node.
// It is a persistent random string used for JWT (panel→node) and HMAC (node→panel).
type PanelPairingService struct{}

type pairingCache struct {
	loaded bool
	row    model.PanelPairing
	secret string
}

var (
	panelPairingOnce sync.Mutex
	panelPairingRef  *pairingCache
)

// Ensure makes sure the singleton row exists, generating the secret on first call.
func (s *PanelPairingService) Ensure() error {
	_, err := s.get()
	return err
}

// GetSecretKey returns the plain SECRET_KEY value for the node docker-compose.yml.
func (s *PanelPairingService) GetSecretKey() (string, error) {
	c, err := s.get()
	if err != nil {
		return "", err
	}
	return c.secret, nil
}

// GetAuthSecret returns the persistent symmetric secret for panel↔node JWT/HMAC.
func (s *PanelPairingService) GetAuthSecret() (string, error) {
	return s.GetSecretKey()
}

// GetOutboundHMACKey returns the 32-byte key used for node→panel HMAC.
func (s *PanelPairingService) GetOutboundHMACKey() ([32]byte, error) {
	secret, err := s.GetAuthSecret()
	if err != nil {
		return [32]byte{}, err
	}
	return pairing_outbound.KeyFromAuthSecret(secret), nil
}

// Reset clears the cached material (for tests).
func (s *PanelPairingService) Reset() {
	panelPairingOnce.Lock()
	defer panelPairingOnce.Unlock()
	panelPairingRef = nil
}

func (s *PanelPairingService) get() (*pairingCache, error) {
	panelPairingOnce.Lock()
	defer panelPairingOnce.Unlock()
	if panelPairingRef != nil && panelPairingRef.loaded {
		if !pairing_outbound.IsLegacyCertBundle(panelPairingRef.secret) {
			return panelPairingRef, nil
		}
		panelPairingRef = nil
	}

	db := database.GetDB()
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}

	var row model.PanelPairing
	err := db.First(&row, 1).Error
	if err != nil {
		if err != gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("load panel pairing: %w", err)
		}
		row, err = s.generateAndStore(db)
		if err != nil {
			return nil, err
		}
	}

	row, err = s.normalizeRow(db, row)
	if err != nil {
		return nil, err
	}

	cache := &pairingCache{
		loaded: true,
		row:    row,
		secret: row.AuthSecret,
	}
	panelPairingRef = cache
	return panelPairingRef, nil
}

func (s *PanelPairingService) generateAndStore(db *gorm.DB) (model.PanelPairing, error) {
	secret := random.Seq(nodeAuthSecretLen)
	now := time.Now().Unix()
	row := model.PanelPairing{
		Id:         1,
		SecretKey:  secret,
		AuthSecret: secret,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := db.Create(&row).Error; err != nil {
		var existing model.PanelPairing
		if rerr := db.First(&existing, 1).Error; rerr == nil {
			return existing, nil
		}
		return model.PanelPairing{}, fmt.Errorf("store panel pairing: %w", err)
	}
	return row, nil
}

func (s *PanelPairingService) normalizeRow(db *gorm.DB, row model.PanelPairing) (model.PanelPairing, error) {
	secret := pairing_outbound.ExtractAuthSecretFromStored(row.AuthSecret)
	if secret == "" {
		secret = pairing_outbound.ExtractAuthSecretFromStored(row.SecretKey)
	}
	if secret == "" || pairing_outbound.IsLegacyCertBundle(secret) {
		secret = random.Seq(nodeAuthSecretLen)
	}
	changed := secret != strings.TrimSpace(row.AuthSecret) || secret != strings.TrimSpace(row.SecretKey)
	if !changed {
		return row, nil
	}
	row.AuthSecret = secret
	row.SecretKey = secret
	row.UpdatedAt = time.Now().Unix()
	if err := db.Model(&model.PanelPairing{}).Where("id = ?", 1).Updates(map[string]any{
		"auth_secret": secret,
		"secret_key":  secret,
		"updated_at":  row.UpdatedAt,
	}).Error; err != nil {
		return model.PanelPairing{}, fmt.Errorf("normalize panel auth secret: %w", err)
	}
	logger.Info("Panel node SECRET_KEY is a plain auth secret. Update SECRET_KEY on all nodes from Settings → Nodes.")
	return row, nil
}
