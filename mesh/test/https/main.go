// HTTPS traffic fixture for the disposable Docker stand, not a panel/worker service.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"time"
)

func main() {
	k, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		log.Fatal(e)
	}
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "mesh.test"}, DNSNames: []string{"mesh.test"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(1, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, e := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	if e != nil {
		log.Fatal(e)
	}
	server := &http.Server{Addr: ":9443", ReadHeaderTimeout: 3 * time.Second, TLSConfig: &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: k}}, MinVersion: tls.VersionTLS12}, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _ := os.Hostname()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"fixture": "sharx-mesh-test", "node": host, "host": r.Host, "sni": r.TLS.ServerName, "remote": r.RemoteAddr, "ok": true})
	})}
	l, e := net.Listen("tcp", server.Addr)
	if e != nil {
		log.Fatal(e)
	}
	log.Fatal(server.Serve(tls.NewListener(l, server.TLSConfig)))
}
