package service

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/konstpic/sharx-code/v2/database/model"
)

// PrepareNodePairing switches the node into auth_mode=pairing and returns the panel-wide
// plain SECRET_KEY (JWT/HMAC auth secret) that the worker consumes via environment variable.
//
// Starting with migration 0027 the panel uses a single shared pairing bundle
// so no per-node TLS/JWT material is created here. The same SECRET_KEY is reused for every node;
// this makes it easy to deploy many nodes with one docker-compose.yml.
func (s *NodeService) PrepareNodePairing(node *model.Node) (secretKey string, err error) {
	if strings.TrimSpace(node.Address) == "" {
		return "", fmt.Errorf("node address is required")
	}
	addr := strings.TrimSpace(node.Address)
	u, err := url.Parse(addr)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("invalid node address URL")
	}
	if u.Scheme == "" {
		scheme := "https"
		if !node.UseTLS {
			scheme = "http"
		}
		var errParse error
		u, errParse = url.Parse(scheme + "://" + addr)
		if errParse != nil {
			return "", fmt.Errorf("invalid node address URL")
		}
		node.Address = u.String()
	}

	pairing := &PanelPairingService{}
	secret, err := pairing.GetSecretKey()
	if err != nil {
		return "", fmt.Errorf("panel pairing secret: %w", err)
	}

	node.AuthMode = "pairing"
	// Panel→worker uses HTTP plus Bearer JWT signed with the shared SECRET_KEY.
	node.UseTLS = strings.EqualFold(u.Scheme, "https")
	node.InsecureTLS = false
	node.CertPath = ""
	node.KeyPath = ""
	// Per-node TLS/JWT fields are no longer used; keep them blank for new pairing nodes.
	node.CaCertPem = ""
	node.PanelClientCertPem = ""
	node.PanelClientKeyPem = ""
	node.JwtPrivateKeyPem = ""
	// Pairing does not use per-node API keys: panel↔node uses JWT; node→panel (logs/geo) uses HMAC from SECRET_KEY.
	node.ApiKey = ""

	return secret, nil
}
