package client

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"
)

func TestVerifyEnrollCARequiresServerCertificateForHost(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	root := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test root"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature}
	der, err := x509.CreateCertificate(rand.Reader, root, root, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pemCA := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	issue := func(usage x509.ExtKeyUsage) *x509.Certificate {
		t.Helper()
		leaf := &x509.Certificate{SerialNumber: big.NewInt(2), DNSNames: []string{"localhost"}, NotBefore: root.NotBefore, NotAfter: root.NotAfter, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{usage}}
		d, e := x509.CreateCertificate(rand.Reader, leaf, ca, &key.PublicKey, key)
		if e != nil {
			t.Fatal(e)
		}
		c, e := x509.ParseCertificate(d)
		if e != nil {
			t.Fatal(e)
		}
		return c
	}
	server := issue(x509.ExtKeyUsageServerAuth)
	if err := verifyEnrollCA(server, pemCA, "localhost"); err != nil {
		t.Fatal(err)
	}
	if err := verifyEnrollCA(server, pemCA, "attacker.invalid"); err == nil {
		t.Fatal("wrong hostname accepted")
	}
	if err := verifyEnrollCA(issue(x509.ExtKeyUsageClientAuth), pemCA, "localhost"); err == nil {
		t.Fatal("participant certificate accepted for server TLS")
	}
}
