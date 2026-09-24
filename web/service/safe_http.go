package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"syscall"
	"time"
)

// allowPrivateDownloads lets an operator fetch from internal mirrors (XUI_ALLOW_PRIVATE_DOWNLOADS=true).
func allowPrivateDownloads() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("XUI_ALLOW_PRIVATE_DOWNLOADS")), "true")
}

// isPublicIP reports whether ip is a globally routable unicast address (not loopback, private, link-local
// incl. cloud metadata 169.254.169.254, CGNAT, multicast or unspecified).
func isPublicIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1]&0xc0 == 64 { // 100.64.0.0/10 carrier-grade NAT
			return false
		}
		if v4[0] == 0 || v4[0] >= 240 {
			return false
		}
	}
	return true
}

// errBlockedAddress is returned when a download target resolves to a non-public address.
var errBlockedAddress = errors.New("destination address is not allowed (private, loopback or link-local)")

// newSafeDownloadClient returns an HTTP client that refuses to connect to non-public addresses.
// The check runs on the address actually dialled (after DNS resolution, for every redirect hop), so DNS
// rebinding and redirects to internal hosts are blocked too.
func newSafeDownloadClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{
		Timeout: 15 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			if allowPrivateDownloads() {
				return nil
			}
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if !isPublicIP(net.ParseIP(host)) {
				return fmt.Errorf("%w: %s", errBlockedAddress, host)
			}
			return nil
		},
	}
	tr := &http.Transport{
		Proxy:               nil,
		DialContext:         func(ctx context.Context, network, addr string) (net.Conn, error) { return dialer.DialContext(ctx, network, addr) },
		TLSHandshakeTimeout: 15 * time.Second,
		MaxIdleConns:        2,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: tr,
		CheckRedirect: func(_ *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}
}
