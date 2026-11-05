// Command sharx-verifier runs an independent SharX Network witness and probe origin.
package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"github.com/konstpic/sharx-code/v2/network/verification"
	"log"
	"net/http"
	"os"
	"time"
)

func run() error {
	seed, err := base64.StdEncoding.DecodeString(os.Getenv("SHARX_VERIFIER_SEED"))
	if err != nil || len(seed) != ed25519.SeedSize {
		return errors.New("SHARX_VERIFIER_SEED must contain a base64 Ed25519 seed")
	}
	id, operator, token := os.Getenv("SHARX_VERIFIER_ID"), os.Getenv("SHARX_VERIFIER_OPERATOR_ID"), os.Getenv("SHARX_VERIFIER_TOKEN")
	cert, key := os.Getenv("SHARX_VERIFIER_TLS_CERT"), os.Getenv("SHARX_VERIFIER_TLS_KEY")
	target := os.Getenv("SHARX_VERIFIER_PROBE_URL")
	journal := os.Getenv("SHARX_VERIFIER_JOURNAL")
	if id == "" || operator == "" || token == "" || cert == "" || key == "" || target == "" || journal == "" {
		return errors.New("verifier identity, TLS, token, probe URL and persistent journal are required")
	}
	service := &verification.Service{ID: id, OperatorID: operator, Token: token, PrivateKey: ed25519.NewKeyFromSeed(seed), JournalPath: journal, Probe: verification.DataPathProbe{XrayPath: os.Getenv("SHARX_VERIFIER_XRAY"), Target: target, AllowPrivate: os.Getenv("SHARX_VERIFIER_ALLOW_PRIVATE") == "1"}}
	listen := os.Getenv("SHARX_VERIFIER_LISTEN")
	if listen == "" {
		listen = ":9444"
	}
	server := &http.Server{Addr: listen, Handler: service.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 << 10}
	return server.ListenAndServeTLS(cert, key)
}
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
