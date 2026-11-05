package qos

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type recordedCommand struct {
	name string
	args []string
}

type fakeRunner struct {
	mu       sync.Mutex
	outputs  map[string]string
	commands []recordedCommand
	run      func(ctx context.Context, name string, args ...string) (string, error)
}

func (f *fakeRunner) Run(ctx context.Context, name string, args ...string) (string, error) {
	f.mu.Lock()
	f.commands = append(f.commands, recordedCommand{name: name, args: append([]string(nil), args...)})
	run := f.run
	f.mu.Unlock()
	if run != nil {
		return run(ctx, name, args...)
	}
	key := name + " " + strings.Join(args, " ")
	f.mu.Lock()
	defer f.mu.Unlock()
	if strings.HasSuffix(key, " root") || strings.HasSuffix(key, " ingress") {
		applied := false
		for _, cmd := range f.commands {
			if strings.Contains(strings.Join(cmd.args, " "), "qdisc replace") {
				applied = true
			}
		}
		if !applied && strings.HasSuffix(key, " ingress") && strings.Contains(f.outputs["tc qdisc show dev eth0 root"], "qdisc htb 1:") {
			return "", nil
		}
		if !applied && strings.Contains(f.outputs[key], "qdisc htb 1:") {
			return "qdisc noqueue 0: root", nil
		}
	}
	if output, ok := f.outputs[key]; ok {
		return output, nil
	}
	return "", nil
}

func (f *fakeRunner) commandsSnapshot() []recordedCommand {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]recordedCommand(nil), f.commands...)
}

func readyOutputs(spec Spec) map[string]string {
	iface := spec.Interface
	port := strconvItoa(spec.Port)
	return map[string]string{
		"tc qdisc show dev " + iface + " root":    "qdisc htb 1: root refcnt 2 r2q 10 default 0x20 direct_packets_stat 0",
		"tc qdisc show dev " + iface + " ingress": "qdisc ingress ffff: parent ffff:fff1",
		"tc class show dev " + iface + " parent 1:": "class htb 1:1 parent 1: rate " + rate(spec.CapacityMbps) + " ceil " + rate(spec.CapacityMbps) + "\n" +
			"class htb 1:10 parent 1:1 leaf 110: prio 7 rate " + rate(spec.SpeedLimitMbps) + " ceil " + rate(spec.SpeedLimitMbps) + "\n" +
			"class htb 1:20 parent 1:1 leaf 120: prio 0 rate " + rate(spec.ReserveMbps) + " ceil " + rate(spec.CapacityMbps),
		"tc filter show dev " + iface + " parent 1:": "filter protocol ip pref 10 flower handle 1\n  src_port " + port + "\n  classid 1:10\n" +
			"filter protocol ipv6 pref 11 flower handle 2\n  src_port " + port + "\n  classid 1:10",
		"tc filter show dev " + iface + " parent ffff:": "filter protocol ip pref 10 flower handle 1\n  dst_port " + port + "\n  police rate " + rate(spec.SpeedLimitMbps) + "\n" +
			"filter protocol ipv6 pref 11 flower handle 2\n  dst_port " + port + "\n  police rate " + rate(spec.SpeedLimitMbps),
	}
}

func strconvItoa(v int) string {
	return strconv.FormatInt(int64(v), 10)
}

func TestApplyCommandsPersistAndIdempotent(t *testing.T) {
	spec := Spec{Interface: "eth0", Port: 30443, CapacityMbps: 100, SpeedLimitMbps: 40, ReserveMbps: 40}
	runner := &fakeRunner{outputs: readyOutputs(spec)}
	cache := filepath.Join(t.TempDir(), "node-cache", "network-qos.json")
	manager := NewManager(cache)
	manager.runner = runner
	if err := manager.Apply(context.Background(), spec); err != nil {
		t.Fatal(err)
	}
	firstCount := len(runner.commandsSnapshot())
	if err := manager.Apply(context.Background(), spec); err != nil {
		t.Fatal(err)
	}
	second := runner.commandsSnapshot()
	if len(second) >= firstCount*2 {
		t.Fatalf("idempotent apply must retain existing root and ingress: %d -> %d", firstCount, len(second))
	}
	var replaces int
	for _, cmd := range second {
		joined := strings.Join(cmd.args, " ")
		if strings.Contains(joined, " replace ") {
			replaces++
		}
		if strings.Contains(joined, " add ") {
			t.Fatalf("non-idempotent tc add command: %v", cmd.args)
		}
	}
	if replaces != 22 {
		t.Fatalf("expected existing root and ingress to be retained, got %d replacements", replaces)
	}
	if status := manager.Status(); !status.Ready || status.AppliedHash == "" || status.AppliedHash != status.DesiredHash {
		t.Fatalf("applied state not confirmed: %+v", status)
	}
	data, err := os.ReadFile(cache)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"speedLimitMbps":40`) || !strings.Contains(string(data), `"interface":"eth0"`) {
		t.Fatalf("resolved desired state not persisted: %s", data)
	}
}

func TestApplyPreflightRefusesForeignQdisc(t *testing.T) {
	for _, root := range []string{
		"qdisc mq 0: root",
		"qdisc htb 2: root",
		"qdisc cake 0: root",
		"unexpected output",
	} {
		t.Run(root, func(t *testing.T) {
			runner := &fakeRunner{outputs: map[string]string{
				"tc qdisc show dev eth0 root": root,
			}}
			cache := filepath.Join(t.TempDir(), "network-qos.json")
			manager := NewManager(cache)
			manager.runner = runner
			err := manager.Apply(context.Background(), Spec{Interface: "eth0", Port: 443, CapacityMbps: 100, SpeedLimitMbps: 40, ReserveMbps: 20})
			if err == nil {
				t.Fatal("foreign qdisc must be rejected")
			}
			for _, cmd := range runner.commandsSnapshot() {
				if len(cmd.args) > 0 && (cmd.args[0] == "replace" || cmd.args[0] == "del") {
					t.Fatalf("mutating command after failed preflight: %v", cmd.args)
				}
			}
			if _, err := os.Stat(cache); !os.IsNotExist(err) {
				t.Fatal("failed preflight must not replace the desired-state snapshot")
			}
		})
	}
}

func TestApplyValidatesCapacityAndWhitelist(t *testing.T) {
	manager := NewManager(filepath.Join(t.TempDir(), "qos.json"))
	manager.runner = &fakeRunner{}
	for _, spec := range []Spec{
		{Interface: "eth0; reboot", Port: 443, CapacityMbps: 100, SpeedLimitMbps: 40},
		{Interface: "eth0", Port: 0, CapacityMbps: 100, SpeedLimitMbps: 40},
		{Interface: "eth0", Port: 443, CapacityMbps: 0, SpeedLimitMbps: 40},
		{Interface: "eth0", Port: 443, CapacityMbps: 100, SpeedLimitMbps: 60, ReserveMbps: 41},
	} {
		if err := manager.Apply(context.Background(), spec); err == nil {
			t.Fatalf("invalid spec accepted: %+v", spec)
		}
	}
	if len(manager.runner.(*fakeRunner).commandsSnapshot()) != 0 {
		t.Fatal("invalid input reached tc/ip commands")
	}
}

func TestCommandTimeoutMarksQoSFailed(t *testing.T) {
	runner := &fakeRunner{run: func(ctx context.Context, name string, args ...string) (string, error) {
		<-ctx.Done()
		return "", ctx.Err()
	}}
	manager := NewManager(filepath.Join(t.TempDir(), "qos.json"))
	manager.runner = runner
	manager.commandTimeout = 10 * time.Millisecond
	err := manager.Apply(context.Background(), Spec{Interface: "eth0", Port: 443, CapacityMbps: 100, SpeedLimitMbps: 40})
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("expected command timeout, got %v", err)
	}
	if manager.Status().State != "failed" {
		t.Fatalf("timeout must not report ready: %+v", manager.Status())
	}
}

func TestRestoreFromAtomicSnapshot(t *testing.T) {
	spec := Spec{Interface: "eth0", Port: 30443, CapacityMbps: 100, SpeedLimitMbps: 40, ReserveMbps: 40}
	cache := filepath.Join(t.TempDir(), "network-qos.json")
	if err := os.MkdirAll(filepath.Dir(cache), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cache, []byte(`{"interface":"eth0","port":30443,"capacityMbps":100,"speedLimitMbps":40,"reserveMbps":40}`), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{outputs: readyOutputs(spec)}
	manager := NewManager(cache)
	manager.runner = runner
	if err := manager.LoadAndApplyCache(context.Background()); err != nil {
		t.Fatal(err)
	}
	if status := manager.Status(); !status.Ready {
		t.Fatalf("restored QoS is not ready: %+v", status)
	}
}

func TestClearNeverDeletesForeignRoot(t *testing.T) {
	spec := Spec{Interface: "eth0", Port: 443, CapacityMbps: 100, SpeedLimitMbps: 40}
	runner := &fakeRunner{outputs: map[string]string{
		"tc qdisc show dev eth0 root": "qdisc mq 0: root",
	}}
	manager := NewManager(filepath.Join(t.TempDir(), "qos.json"))
	manager.runner = runner
	manager.desired = &spec
	if err := manager.Clear(context.Background()); err == nil {
		t.Fatal("foreign root must block cleanup")
	}
	for _, cmd := range runner.commandsSnapshot() {
		if len(cmd.args) > 0 && cmd.args[0] == "del" {
			t.Fatalf("foreign cleanup command: %v", cmd.args)
		}
	}
}

func TestDefaultInterfaceMustBeUnambiguous(t *testing.T) {
	manager := NewManager("")
	manager.runner = &fakeRunner{outputs: map[string]string{
		"ip route show default": "default via 192.0.2.1 dev eth0\ndefault via 192.0.2.2 dev eth1",
	}}
	if err := manager.Apply(context.Background(), Spec{Port: 443, CapacityMbps: 100, SpeedLimitMbps: 40}); err == nil {
		t.Fatal("ambiguous default interface must be rejected")
	}
}

func TestStatusDetectsRemovedFilters(t *testing.T) {
	spec := Spec{Interface: "eth0", Port: 443, CapacityMbps: 100, SpeedLimitMbps: 40}
	runner := &fakeRunner{outputs: readyOutputs(spec)}
	manager := NewManager("")
	manager.runner = runner
	if err := manager.Apply(context.Background(), spec); err != nil {
		t.Fatal(err)
	}
	runner.mu.Lock()
	runner.outputs["tc filter show dev eth0 parent ffff:"] = ""
	runner.mu.Unlock()
	status := manager.Status()
	if status.Ready || status.State != "failed" || !strings.Contains(status.Error, "ingress") {
		t.Fatalf("missing filters must fail health: %+v", status)
	}
}

func TestLoadRejectsCorruptSnapshot(t *testing.T) {
	cache := filepath.Join(t.TempDir(), "network-qos.json")
	if err := os.WriteFile(cache, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := NewManager(cache)
	manager.runner = &fakeRunner{}
	if err := manager.LoadAndApplyCache(context.Background()); err == nil || errors.Is(err, os.ErrNotExist) {
		t.Fatalf("corrupt snapshot must surface a recovery error: %v", err)
	}
}

func TestKernelRateFormattingAndClassIsolation(t *testing.T) {
	if !classMatches("class htb 1:20 rate 40Mbit ceil 1Gbit", "htb 1:20", "rate 40mbit", "ceil 1000mbit") {
		t.Fatal("equivalent kernel rate formatting rejected")
	}
	if classMatches("class htb 1:10 rate 100Mbit ceil 100Mbit\nclass htb 1:20 rate 40Mbit ceil 40Mbit", "htb 1:10", "rate 40mbit", "ceil 40mbit") {
		t.Fatal("another class hid an incorrect shared rate")
	}
}
