package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
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

// NodeServerName is the fixed SNI/ServerName used by the panel when connecting to a node.
// The shared node TLS cert is issued for this DNS name so one cert works across all nodes.
const NodeServerName = "sharx-node"

// PanelPairingService owns the panel-wide SECRET_KEY bundle used to pair with every SharX node.
// All material is generated exactly once and persisted in the `panel_pairing` table.
type PanelPairingService struct{}

type pairingCache struct {
	loaded     bool
	row        model.PanelPairing
	secret     string
	tlsClient  *tls.Config
	jwtPrivate *rsa.PrivateKey
}

var (
	panelPairingOnce sync.Mutex
	panelPairingRef  *pairingCache
)

// Ensure makes sure the singleton row exists, generating material on first call.
// Safe to call multiple times; subsequent calls are no-ops.
func (s *PanelPairingService) Ensure() error {
	_, err := s.get()
	return err
}

// GetSecretKey returns the base64 SECRET_KEY value to embed in the node docker-compose.yml.
func (s *PanelPairingService) GetSecretKey() (string, error) {
	c, err := s.get()
	if err != nil {
		return "", err
	}
	return c.secret, nil
}

// GetClientTLSConfig returns a *tls.Config ready for mTLS to any pairing-mode node.
// The returned value must not be mutated by callers; clone it if you need to customize.
func (s *PanelPairingService) GetClientTLSConfig() (*tls.Config, error) {
	c, err := s.get()
	if err != nil {
		return nil, err
	}
	return c.tlsClient.Clone(), nil
}

// GetJWTPrivateKey returns the panel's RSA private key used to sign node API tokens.
func (s *PanelPairingService) GetJWTPrivateKey() (*rsa.PrivateKey, error) {
	c, err := s.get()
	if err != nil {
		return nil, err
	}
	return c.jwtPrivate, nil
}

// GetAuthSecret returns the persistent symmetric secret for panel↔node JWT/HMAC.
func (s *PanelPairingService) GetAuthSecret() (string, error) {
	c, err := s.get()
	if err != nil {
		return "", err
	}
	return c.row.AuthSecret, nil
}

// GetOutboundHMACKey returns the 32-byte key used for node→panel HMAC (log push, etc.).
func (s *PanelPairingService) GetOutboundHMACKey() ([32]byte, error) {
	c, err := s.get()
	if err != nil {
		return [32]byte{}, err
	}
	if strings.TrimSpace(c.row.AuthSecret) != "" {
		return pairing_outbound.KeyFromAuthSecret(c.row.AuthSecret), nil
	}
	return pairing_outbound.OutboundHMACKey(c.row.CaCertPem, c.row.JwtPublicKeyPem), nil
}

// Reset clears the cached material (for tests / migrations).
func (s *PanelPairingService) Reset() {
	panelPairingOnce.Lock()
	defer panelPairingOnce.Unlock()
	panelPairingRef = nil
}

func (s *PanelPairingService) get() (*pairingCache, error) {
	panelPairingOnce.Lock()
	defer panelPairingOnce.Unlock()
	if panelPairingRef != nil && panelPairingRef.loaded {
		return panelPairingRef, nil
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

	row, err = s.ensureAuthSecret(db, row)
	if err != nil {
		return nil, err
	}

	cache, err := buildPairingCache(row)
	if err != nil {
		return nil, err
	}
	panelPairingRef = cache
	return panelPairingRef, nil
}

func buildPairingCache(row model.PanelPairing) (*pairingCache, error) {
	tlsCfg, err := buildPanelClientTLS(row)
	if err != nil {
		return nil, err
	}
	var priv *rsa.PrivateKey
	if strings.TrimSpace(row.AuthSecret) == "" {
		priv, err = parseRSAPrivateKeyFromPEM(row.JwtPrivateKeyPem)
		if err != nil {
			return nil, fmt.Errorf("panel JWT key: %w", err)
		}
	}
	return &pairingCache{
		loaded:     true,
		row:        row,
		secret:     row.SecretKey,
		tlsClient:  tlsCfg,
		jwtPrivate: priv,
	}, nil
}

func buildPanelClientTLS(row model.PanelPairing) (*tls.Config, error) {
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(row.CaCertPem)) {
		return nil, fmt.Errorf("panel pairing CA cert: parse failed")
	}
	pair, err := tls.X509KeyPair([]byte(row.PanelClientCertPem), []byte(row.PanelClientKeyPem))
	if err != nil {
		return nil, fmt.Errorf("panel client cert: %w", err)
	}
	return &tls.Config{
		RootCAs:      pool,
		Certificates: []tls.Certificate{pair},
		ServerName:   NodeServerName,
		MinVersion:   tls.VersionTLS12,
	}, nil
}

func (s *PanelPairingService) generateAndStore(db *gorm.DB) (model.PanelPairing, error) {
	material, err := generatePanelPairingMaterial()
	if err != nil {
		return model.PanelPairing{}, err
	}
	now := time.Now().Unix()
	row := model.PanelPairing{
		Id:                 1,
		SecretKey:          material.secretKey,
		CaCertPem:          material.caCertPem,
		CaKeyPem:           material.caKeyPem,
		NodeCertPem:        material.nodeCertPem,
		NodeKeyPem:         material.nodeKeyPem,
		PanelClientCertPem: material.panelClientCertPem,
		PanelClientKeyPem:  material.panelClientKeyPem,
		JwtPrivateKeyPem:   material.jwtPrivateKeyPem,
		JwtPublicKeyPem:    material.jwtPublicKeyPem,
		AuthSecret:         material.authSecret,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if err := db.Create(&row).Error; err != nil {
		// Retry read in case another process raced us.
		var existing model.PanelPairing
		if rerr := db.First(&existing, 1).Error; rerr == nil {
			return existing, nil
		}
		return model.PanelPairing{}, fmt.Errorf("store panel pairing: %w", err)
	}
	return row, nil
}

type pairingMaterial struct {
	secretKey          string
	authSecret         string
	caCertPem          string
	caKeyPem           string
	nodeCertPem        string
	nodeKeyPem         string
	panelClientCertPem string
	panelClientKeyPem  string
	jwtPrivateKeyPem   string
	jwtPublicKeyPem    string
}

func ensurePanelAuthSecret(row model.PanelPairing) (model.PanelPairing, bool) {
	if strings.TrimSpace(row.AuthSecret) != "" {
		return row, false
	}
	row.AuthSecret = random.Seq(32)
	row.SecretKey = encodeSecretKeyBundle(row)
	row.UpdatedAt = time.Now().Unix()
	return row, true
}

func (s *PanelPairingService) ensureAuthSecret(db *gorm.DB, row model.PanelPairing) (model.PanelPairing, error) {
	updated, changed := ensurePanelAuthSecret(row)
	if !changed {
		return updated, nil
	}
	if err := db.Model(&model.PanelPairing{}).Where("id = ?", 1).Updates(map[string]any{
		"auth_secret": updated.AuthSecret,
		"secret_key":  updated.SecretKey,
		"updated_at":  updated.UpdatedAt,
	}).Error; err != nil {
		return model.PanelPairing{}, fmt.Errorf("backfill panel auth secret: %w", err)
	}
	logger.Info("Panel node auth secret initialized (persistent JWT/HMAC key). Update SECRET_KEY on all nodes from Settings → Nodes.")
	return updated, nil
}

func encodeSecretKeyBundle(row model.PanelPairing) string {
	payload := struct {
		CACertPem   string `json:"caCertPem"`
		NodeCertPem string `json:"nodeCertPem"`
		NodeKeyPem  string `json:"nodeKeyPem"`
		AuthSecret  string `json:"authSecret"`
	}{
		CACertPem:   row.CaCertPem,
		NodeCertPem: row.NodeCertPem,
		NodeKeyPem:  row.NodeKeyPem,
		AuthSecret:  row.AuthSecret,
	}
	raw, _ := json.Marshal(payload)
	return base64.StdEncoding.EncodeToString(raw)
}

func generatePanelPairingMaterial() (*pairingMaterial, error) {
	authSecret := random.Seq(32)
	caPriv, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return nil, err
	}
	caSN, err := randomSerial()
	if err != nil {
		return nil, err
	}
	caTmpl := &x509.Certificate{
		SerialNumber: caSN,
		Subject: pkix.Name{
			Organization: []string{"SharX"},
			CommonName:   "SharX panel CA",
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().AddDate(20, 0, 0),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caPriv.PublicKey, caPriv)
	if err != nil {
		return nil, err
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		return nil, err
	}
	caCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	caKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(caPriv)})

	nodePriv, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return nil, err
	}
	nodeSN, err := randomSerial()
	if err != nil {
		return nil, err
	}
	nodeTmpl := &x509.Certificate{
		SerialNumber: nodeSN,
		Subject: pkix.Name{
			Organization: []string{"SharX"},
			CommonName:   NodeServerName,
		},
		NotBefore:   time.Now().Add(-1 * time.Hour),
		NotAfter:    time.Now().AddDate(20, 0, 0),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:    []string{NodeServerName, "localhost"},
	}
	nodeDER, err := x509.CreateCertificate(rand.Reader, nodeTmpl, caCert, &nodePriv.PublicKey, caPriv)
	if err != nil {
		return nil, err
	}
	nodeCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: nodeDER})
	nodeKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(nodePriv)})

	clientPriv, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return nil, err
	}
	clientSN, err := randomSerial()
	if err != nil {
		return nil, err
	}
	clientTmpl := &x509.Certificate{
		SerialNumber: clientSN,
		Subject: pkix.Name{
			Organization: []string{"SharX"},
			CommonName:   "sharx-panel-client",
		},
		NotBefore:   time.Now().Add(-1 * time.Hour),
		NotAfter:    time.Now().AddDate(20, 0, 0),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	clientDER, err := x509.CreateCertificate(rand.Reader, clientTmpl, caCert, &clientPriv.PublicKey, caPriv)
	if err != nil {
		return nil, err
	}
	clientCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: clientDER})
	clientKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(clientPriv)})

	jwtPriv, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return nil, err
	}
	jwtPubDER, err := x509.MarshalPKIXPublicKey(&jwtPriv.PublicKey)
	if err != nil {
		return nil, err
	}
	jwtPubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: jwtPubDER})
	jwtPrivPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(jwtPriv)})

	payload := struct {
		CACertPem   string `json:"caCertPem"`
		NodeCertPem string `json:"nodeCertPem"`
		NodeKeyPem  string `json:"nodeKeyPem"`
		AuthSecret  string `json:"authSecret"`
	}{
		CACertPem:   string(caCertPEM),
		NodeCertPem: string(nodeCertPEM),
		NodeKeyPem:  string(nodeKeyPEM),
		AuthSecret:  authSecret,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	return &pairingMaterial{
		secretKey:          base64.StdEncoding.EncodeToString(raw),
		authSecret:         authSecret,
		caCertPem:          string(caCertPEM),
		caKeyPem:           string(caKeyPEM),
		nodeCertPem:        string(nodeCertPEM),
		nodeKeyPem:         string(nodeKeyPEM),
		panelClientCertPem: string(clientCertPEM),
		panelClientKeyPem:  string(clientKeyPEM),
		jwtPrivateKeyPem:   string(jwtPrivPEM),
		jwtPublicKeyPem:    string(jwtPubPEM),
	}, nil
}

func randomSerial() (*big.Int, error) {
	return rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
}

func parseRSAPrivateKeyFromPEM(pemStr string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("jwt private key: no PEM block")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("jwt private key is not RSA")
	}
	return rsaKey, nil
}
