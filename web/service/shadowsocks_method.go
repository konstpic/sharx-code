package service

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/konstpic/sharx-code/v2/util/common"
	"github.com/konstpic/sharx-code/v2/util/random"
)

// IsShadowsocks2022Method reports AEAD 2022 ciphers (multi-user: method only on inbound).
func IsShadowsocks2022Method(method string) bool {
	return strings.HasPrefix(strings.TrimSpace(method), "2022")
}

// ShadowsocksMethodFromSettings reads inbound settings.method.
func ShadowsocksMethodFromSettings(settingsJSON string) string {
	settingsJSON = strings.TrimSpace(settingsJSON)
	if settingsJSON == "" {
		return ""
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(settingsJSON), &root); err != nil || root == nil {
		return ""
	}
	m, _ := root["method"].(string)
	return strings.TrimSpace(m)
}

func shadowsocksServerKeyBytes(method string) int {
	if !IsShadowsocks2022Method(method) {
		return 0
	}
	if strings.Contains(method, "128") {
		return 16
	}
	return 32
}

func shadowsocksUserKeyBytes(method string) int {
	if !IsShadowsocks2022Method(method) {
		return 0
	}
	return shadowsocksServerKeyBytes(method)
}

func randomBase64Key(n int) (string, error) {
	if n <= 0 {
		return "", common.NewError("invalid shadowsocks key length")
	}
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

// RandomShadowsocksServerPassword returns a server password for inbound settings.password.
func RandomShadowsocksServerPassword(method string) (string, error) {
	method = strings.TrimSpace(method)
	if method == "" {
		method = "aes-256-gcm"
	}
	if n := shadowsocksServerKeyBytes(method); n > 0 {
		return randomBase64Key(n)
	}
	return random.Seq(32), nil
}

// RandomShadowsocksUserPassword returns a client secret for ClientEntity.password / clients[].password.
func RandomShadowsocksUserPassword(method string) (string, error) {
	method = strings.TrimSpace(method)
	if method == "" {
		method = "aes-256-gcm"
	}
	if n := shadowsocksUserKeyBytes(method); n > 0 {
		return randomBase64Key(n)
	}
	return random.Seq(32), nil
}

func shadowsocks2022KeyValid(method, password string) bool {
	password = strings.TrimSpace(password)
	if password == "" {
		return false
	}
	raw, err := base64.StdEncoding.DecodeString(password)
	if err != nil {
		return false
	}
	return len(raw) == shadowsocksServerKeyBytes(method)
}

// EnsureShadowsocksUserPassword returns a client secret valid for the inbound cipher.
// For SS2022 it must be a base64 PSK of the correct byte length; regenerates when invalid or empty.
func EnsureShadowsocksUserPassword(method, password string) (string, error) {
	method = strings.TrimSpace(method)
	if method == "" {
		method = "aes-256-gcm"
	}
	password = strings.TrimSpace(password)
	if IsShadowsocks2022Method(method) {
		if shadowsocks2022KeyValid(method, password) {
			return password, nil
		}
		return RandomShadowsocksUserPassword(method)
	}
	if password == "" {
		return RandomShadowsocksUserPassword(method)
	}
	return password, nil
}

// ShadowsocksCipherForAddUser returns gRPC AddUser cipher for classic SS only (empty for 2022).
func ShadowsocksCipherForAddUser(settingsJSON string) string {
	method := ShadowsocksMethodFromSettings(settingsJSON)
	if method == "" || IsShadowsocks2022Method(method) {
		return ""
	}
	return method
}

// ApplyShadowsocksClientFields sets Xray clients[] fields for the given inbound method.
func ApplyShadowsocksClientFields(method string, client map[string]any) {
	if client == nil {
		return
	}
	if IsShadowsocks2022Method(method) {
		delete(client, "method")
		return
	}
	if method != "" {
		client["method"] = method
	}
}

// SanitizeShadowsocksInboundSettings normalizes settings JSON before push to Xray.
func SanitizeShadowsocksInboundSettings(settingsJSON string) (string, error) {
	settingsJSON = strings.TrimSpace(settingsJSON)
	if settingsJSON == "" {
		return settingsJSON, nil
	}
	var root map[string]any
	if err := json.Unmarshal([]byte(settingsJSON), &root); err != nil || root == nil {
		return settingsJSON, err
	}
	method, _ := root["method"].(string)
	method = strings.TrimSpace(method)
	if method == "" {
		method = "aes-256-gcm"
		root["method"] = method
	}
	pw, _ := root["password"].(string)
	if IsShadowsocks2022Method(method) && !shadowsocks2022KeyValid(method, pw) {
		newPw, err := RandomShadowsocksServerPassword(method)
		if err != nil {
			return settingsJSON, err
		}
		root["password"] = newPw
	}
	if clients, ok := root["clients"].([]any); ok {
		for i, c := range clients {
			cm, ok := c.(map[string]any)
			if !ok {
				continue
			}
			ApplyShadowsocksClientFields(method, cm)
			if pw, _ := cm["password"].(string); pw != "" {
				if fixed, err := EnsureShadowsocksUserPassword(method, pw); err == nil {
					cm["password"] = fixed
				}
			}
			clients[i] = cm
		}
		root["clients"] = clients
	}
	out, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return settingsJSON, err
	}
	return string(out), nil
}
