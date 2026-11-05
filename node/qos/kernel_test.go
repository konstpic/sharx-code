package qos

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Run only in a disposable Linux network namespace; see network/test/qos-kernel.sh.
func TestKernelTrafficLimits(t *testing.T) {
	if os.Getenv("SHARX_QOS_KERNEL_TEST") != "1" {
		t.Skip("requires isolated Linux namespaces and NET_ADMIN")
	}
	spec := Spec{Interface: "sx0", Port: 30001, CapacityMbps: 40, SpeedLimitMbps: 10, ReserveMbps: 20}
	manager := NewManager(filepath.Join(t.TempDir(), "qos.json"))
	if err := manager.Apply(context.Background(), spec); err != nil {
		t.Fatal(err)
	}
	// Restart reconciliation must recognise its persisted ownership.
	restored := NewManager(manager.cachePath)
	if err := restored.LoadAndApplyCache(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, port := range []string{"30001", "30002"} {
		cmd := exec.Command("iperf3", "-s", "-B", "10.203.0.1", "-p", port)
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	}
	ipv6Server := exec.Command("iperf3", "-s", "-B", "fd42:203::1", "-p", "30001")
	if err := ipv6Server.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ipv6Server.Process.Kill(); _ = ipv6Server.Wait() }()
	time.Sleep(200 * time.Millisecond)
	measure := func(address string, port int, reverse bool) (float64, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		args := []string{"netns", "exec", "sxclient", "iperf3", "-c", address, "-p", fmt.Sprint(port), "-t", "5", "-P", "4", "-J"}
		if reverse {
			args = append(args, "-R")
		}
		out, err := exec.CommandContext(ctx, "ip", args...).CombinedOutput()
		if err != nil {
			return 0, fmt.Errorf("iperf: %w: %s", err, out)
		}
		var report struct {
			End struct {
				Received struct {
					Rate float64 `json:"bits_per_second"`
				} `json:"sum_received"`
			} `json:"end"`
			Error string `json:"error"`
		}
		if err := json.Unmarshal(out, &report); err != nil {
			return 0, err
		}
		if report.Error != "" {
			return 0, fmt.Errorf("iperf: %s", report.Error)
		}
		return report.End.Received.Rate / 1e6, nil
	}
	// Own inbound and shared inbound compete for one controlled egress bottleneck.
	type result struct {
		rate float64
		err  error
	}
	network := make(chan result, 1)
	go func() { rate, err := measure("10.203.0.1", 30001, true); network <- result{rate, err} }()
	own, err := measure("10.203.0.1", 30002, true)
	if err != nil {
		t.Fatal(err)
	}
	n := <-network
	if n.err != nil {
		t.Fatal(n.err)
	}
	t.Logf("simultaneous: shared %.2f Mbps, own %.2f Mbps", n.rate, own)
	if n.rate < 1 || n.rate > 12 {
		t.Fatalf("egress ceiling: %.2f Mbps", n.rate)
	}
	if own < 18 {
		t.Fatalf("own-client reservation not met: %.2f Mbps", own)
	}
	upload, err := measure("10.203.0.1", 30001, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("shared ingress: %.2f Mbps", upload)
	if upload < 0.1 || upload > 12 {
		t.Fatalf("ingress ceiling: %.2f Mbps", upload)
	}
	for _, reverse := range []bool{true, false} {
		go func() { rate, err := measure("10.203.0.1", 30001, reverse); network <- result{rate, err} }()
		v6, err := measure("fd42:203::1", 30001, reverse)
		if err != nil {
			t.Fatal(err)
		}
		v4 := <-network
		if v4.err != nil {
			t.Fatal(v4.err)
		}
		t.Logf("shared IPv4+IPv6 reverse=%v: %.2f + %.2f = %.2f Mbps", reverse, v4.rate, v6, v4.rate+v6)
		if v4.rate <= 0 || v6 <= 0 || v4.rate+v6 > 12 {
			t.Fatalf("aggregate dual-stack ceiling violated")
		}
	}
	if out, err := exec.Command("ip", "netns", "exec", "sxclient", "tc", "qdisc", "replace", "dev", "sx1", "root", "netem", "delay", "30ms", "loss", "1%").CombinedOutput(); err != nil {
		t.Fatalf("netem: %v %s", err, out)
	}
	impaired, err := measure("10.203.0.1", 30001, false)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("30ms/1%% loss: %.2f Mbps", impaired)
	if impaired <= 0 || impaired > 12 {
		t.Fatalf("impaired traffic: %.2f Mbps", impaired)
	}
	if err := manager.Clear(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestRevocationOnlyNetworkPort(t *testing.T) {
	if os.Getenv("SHARX_QOS_KERNEL_TEST") != "1" {
		t.Skip("requires isolated Linux network namespace")
	}
	startEcho := func() (net.Listener, net.Conn) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		go func() {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			defer connection.Close()
			_, _ = io.Copy(connection, connection)
		}()
		connection, err := net.Dial("tcp", listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		return listener, connection
	}
	network, networkClient := startEcho()
	defer network.Close()
	defer networkClient.Close()
	own, ownClient := startEcho()
	defer own.Close()
	defer ownClient.Close()
	exchange := func(connection net.Conn) error {
		_ = connection.SetDeadline(time.Now().Add(time.Second))
		if _, err := connection.Write([]byte{42}); err != nil {
			return err
		}
		var reply [1]byte
		_, err := io.ReadFull(connection, reply[:])
		return err
	}
	if err := exchange(networkClient); err != nil {
		t.Fatal(err)
	}
	if err := exchange(ownClient); err != nil {
		t.Fatal(err)
	}
	if err := RevokeConnections(context.Background(), network.Addr().(*net.TCPAddr).Port); err != nil {
		t.Fatal(err)
	}
	if err := exchange(networkClient); err == nil {
		t.Fatal("network TCP connection survived exclusion")
	}
	if err := exchange(ownClient); err != nil {
		t.Fatalf("own-client connection was interrupted: %v", err)
	}
}
