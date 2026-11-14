package udphopnat

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/konstpic/sharx-code/v2/util/finalmask"
)

// fakeRunner records every invocation. failArgs marks argv (joined by space)
// that must return an error; chainMissing controls the -nL existence probe and
// jumpExists the -C PREROUTING probe (set to true by a successful -A).
type fakeRunner struct {
	calls        []string
	failArgs     map[string]error
	chainMissing bool
	jumpExists   map[string]bool // per binary: iptables and ip6tables are separate tables
}

func (f *fakeRunner) run(binary string, args ...string) error {
	if f.jumpExists == nil {
		f.jumpExists = map[string]bool{}
	}
	call := binary + " " + strings.Join(args, " ")
	f.calls = append(f.calls, call)
	if err, ok := f.failArgs[call]; ok {
		return err
	}
	// `-t nat -nL <chain>` is the existence probe of the reconcile logic.
	if len(args) == 4 && args[0] == "-t" && args[2] == "-nL" && args[3] == ChainName {
		if f.chainMissing {
			return errors.New("chain missing")
		}
		return nil
	}
	// `-t nat -C PREROUTING -j <chain>` checks the jump; -A installs it, -D removes it.
	if len(args) == 6 && args[2] == "-C" && args[3] == "PREROUTING" {
		if !f.jumpExists[binary] {
			return errors.New("rule missing")
		}
		return nil
	}
	if len(args) == 6 && args[2] == "-A" && args[3] == "PREROUTING" {
		f.jumpExists[binary] = true
		return nil
	}
	if len(args) == 6 && args[2] == "-D" && args[3] == "PREROUTING" {
		// iptables exits non-zero when there is no rule to delete; reconcile
		// ignores that, so the fake may always report it.
		f.jumpExists[binary] = false
		return errors.New("rule missing")
	}
	return nil
}

func iptablesCalls(calls []string) []string {
	var out []string
	for _, c := range calls {
		if strings.HasPrefix(c, "iptables ") {
			out = append(out, strings.TrimPrefix(c, "iptables "))
		}
	}
	return out
}

func TestReconcileCreatesChainJumpAndRules(t *testing.T) {
	run := &fakeRunner{chainMissing: true}
	warnings := Reconcile(run.run, []finalmask.UDPHopNatIntent{
		{FromPortMin: 20000, FromPortMax: 30000, ToPort: 39612},
		{FromPortMin: 443, FromPortMax: 443, ToPort: 39612},
	})
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	want := []string{
		"-t nat -nL " + ChainName,
		"-t nat -N " + ChainName,
		"-t nat -F " + ChainName,
		"-t nat -A " + ChainName + " -p udp --dport 20000:30000 -j REDIRECT --to-ports 39612",
		"-t nat -A " + ChainName + " -p udp --dport 443 -j REDIRECT --to-ports 39612",
		"-t nat -C PREROUTING -j " + ChainName,
		"-t nat -A PREROUTING -j " + ChainName,
	}
	if got := iptablesCalls(run.calls); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls =\n%v\nwant\n%v", got, want)
	}
	// Same commands must run for ip6tables (best-effort family).
	var ip6 int
	for _, c := range run.calls {
		if strings.HasPrefix(c, "ip6tables ") {
			ip6++
		}
	}
	if ip6 != len(want) {
		t.Fatalf("ip6tables got %d calls, want %d", ip6, len(want))
	}
}

func TestReconcileExistingChainFlushesAndKeepsJump(t *testing.T) {
	run := &fakeRunner{chainMissing: false, jumpExists: map[string]bool{"iptables": true, "ip6tables": true}}
	warnings := Reconcile(run.run, []finalmask.UDPHopNatIntent{
		{FromPortMin: 443, FromPortMax: 443, ToPort: 9000},
	})
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	want := []string{
		"-t nat -nL " + ChainName,
		"-t nat -F " + ChainName,
		"-t nat -A " + ChainName + " -p udp --dport 443 -j REDIRECT --to-ports 9000",
		"-t nat -C PREROUTING -j " + ChainName,
	}
	if got := iptablesCalls(run.calls); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls = %v, want %v", got, want)
	}
}

func TestReconcileIsIdempotent(t *testing.T) {
	intents := []finalmask.UDPHopNatIntent{
		{FromPortMin: 20000, FromPortMax: 30000, ToPort: 39612},
	}
	run := &fakeRunner{chainMissing: false, jumpExists: map[string]bool{"iptables": true, "ip6tables": true}}
	Reconcile(run.run, intents)
	firstPass := append([]string(nil), run.calls...)
	Reconcile(run.run, intents)
	secondPass := append([]string(nil), run.calls[len(firstPass):]...)
	Reconcile(run.run, intents)
	thirdPass := run.calls[len(firstPass)+len(secondPass):]
	// Warm reconciles must be identical: one flush + one append per intent,
	// no duplicate rules, no chain/jump churn.
	if !reflect.DeepEqual(secondPass, thirdPass) {
		t.Fatalf("warm reconcile is not idempotent:\n%v\nvs\n%v", secondPass, thirdPass)
	}
	for _, c := range thirdPass {
		if strings.Contains(c, "-N ") || strings.Contains(c, "-A PREROUTING") {
			t.Fatalf("warm reconcile recreated infrastructure: %s", c)
		}
	}
}

func TestReconcileEmptyListRemovesChain(t *testing.T) {
	run := &fakeRunner{chainMissing: false}
	warnings := Reconcile(run.run, nil)
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	want := []string{
		"-t nat -nL " + ChainName,
		"-t nat -D PREROUTING -j " + ChainName,
		"-t nat -F " + ChainName,
		"-t nat -X " + ChainName,
	}
	if got := iptablesCalls(run.calls); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls = %v, want %v", got, want)
	}
}

func TestReconcileEmptyListWithoutChainIsNoop(t *testing.T) {
	run := &fakeRunner{chainMissing: true}
	warnings := Reconcile(run.run, []finalmask.UDPHopNatIntent{})
	if len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	if len(run.calls) != 2 { // only the two -nL probes (iptables + ip6tables)
		t.Fatalf("calls = %v, want only the existence probes", run.calls)
	}
}

func TestReconcileSkipsInvalidIntentsWithWarning(t *testing.T) {
	run := &fakeRunner{chainMissing: true}
	warnings := Reconcile(run.run, []finalmask.UDPHopNatIntent{
		{FromPortMin: 70000, FromPortMax: 70000, ToPort: 9000}, // out of range
		{FromPortMin: 443, FromPortMax: 443, ToPort: 9000},     // valid
	})
	if len(warnings) != 1 || !strings.Contains(warnings[0], "invalid intent") {
		t.Fatalf("warnings = %v, want one invalid-intent warning", warnings)
	}
	for _, c := range run.calls {
		if strings.Contains(c, "70000") {
			t.Fatalf("invalid port reached argv: %s", c)
		}
	}
}

func TestReconcileIpv6FailureIsWarningNotFatal(t *testing.T) {
	run := &fakeRunner{
		chainMissing: false,
		failArgs: map[string]error{
			"ip6tables -t nat -F " + ChainName: fmt.Errorf("no config file"),
		},
	}
	warnings := Reconcile(run.run, []finalmask.UDPHopNatIntent{
		{FromPortMin: 443, FromPortMax: 443, ToPort: 9000},
	})
	if len(warnings) != 1 || !strings.Contains(warnings[0], "ip6tables") {
		t.Fatalf("warnings = %v, want one ip6tables warning", warnings)
	}
	// IPv4 rules must still have been applied.
	for _, want := range []string{
		"iptables -t nat -F " + ChainName,
		"iptables -t nat -A " + ChainName + " -p udp --dport 443 -j REDIRECT --to-ports 9000",
	} {
		found := false
		for _, c := range run.calls {
			if c == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("missing IPv4 call %q in %v", want, run.calls)
		}
	}
}

func TestRuleArgsSingleAndRangePort(t *testing.T) {
	single := ruleArgs(finalmask.UDPHopNatIntent{FromPortMin: 443, FromPortMax: 443, ToPort: 9000})
	if !reflect.DeepEqual(single, []string{"-t", "nat", "-A", ChainName, "-p", "udp", "--dport", "443", "-j", "REDIRECT", "--to-ports", "9000"}) {
		t.Fatalf("single-port argv = %v", single)
	}
	rng := ruleArgs(finalmask.UDPHopNatIntent{FromPortMin: 20000, FromPortMax: 30000, ToPort: 9000})
	if !reflect.DeepEqual(rng, []string{"-t", "nat", "-A", ChainName, "-p", "udp", "--dport", "20000:30000", "-j", "REDIRECT", "--to-ports", "9000"}) {
		t.Fatalf("range argv = %v", rng)
	}
}
