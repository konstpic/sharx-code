// Package udphopnat reconciles the host-level REDIRECT rules the udphop mask
// needs in its remote modes (intervalremote / perconnremote): the client hops
// across remotePorts, so every datagram aimed at that range must be redirected
// to the inbound listen port before conntrack/filtering sees it:
//
//	iptables -t nat -A PREROUTING -p udp --dport <min>:<max> -j REDIRECT --to-ports <inbound port>
//
// The rules live in the package-owned chain SHARX_UDPHOP of the nat table with
// a single jump from PREROUTING. Reconcile owns that chain exclusively: it
// flushes and refills it (or removes it when the desired list is empty) and
// never touches any other chain or rule, so coexisting tooling is safe.
//
// Reconcile is best-effort by design: every failure is returned as a warning
// string for the node log / apply-config response, because a NAT problem must
// not prevent the Xray config itself from being applied. All argv values are
// built from parsed integers and package constants only — nothing that arrived
// as JSON text is ever passed to exec.
package udphopnat

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/finalmask"
)

// ChainName is the package-owned nat chain; the name is a constant so it can
// never be influenced by request payloads.
const ChainName = "SHARX_UDPHOP"

// natBinaries are reconciled in order: iptables for IPv4, ip6tables best-effort.
var natBinaries = []string{"iptables", "ip6tables"}

// execTimeout bounds one netfilter invocation. iptables blocks while the
// xtables lock is held by another writer; without a deadline a stuck call
// would wedge apply-config's HTTP handler for its whole request timeout.
const execTimeout = 10 * time.Second

// reconcileMu serializes Reconcile calls. The panel pushes apply-config from
// several paths at once (worker config recover, telemt session sync, multi
// node apply), and two interleaved reconciles — e.g. an empty list racing a
// non-empty one — could flush or remove the chain mid-install, silently
// leaving rules absent that both callers believed applied.
var reconcileMu sync.Mutex

// Runner executes one netfilter binary with args; it returns an error that
// already carries the combined output. Swapping it in tests makes the command
// sequence assertable without touching the host firewall.
type Runner func(binary string, args ...string) error

// lg tags this package's journal entries.
var lg = logger.WithComponent("udphopnat")

// ExecRunner is the production Runner: exec with a deadline + combined output
// in the error.
func ExecRunner(binary string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), execTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, binary, args...).CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return fmt.Errorf("%s %s: %v", binary, strings.Join(args, " "), err)
		}
		return fmt.Errorf("%s %s: %v: %s", binary, strings.Join(args, " "), err, msg)
	}
	return nil
}

// Reconcile brings the host nat table to exactly the desired intent list and
// returns the warnings collected on the way (nil when everything succeeded).
// It is idempotent: repeating the same list produces the same command sequence
// and the same resulting ruleset. Calls are serialized (see reconcileMu)
// because the panel can reach apply-config from several paths concurrently.
func Reconcile(run Runner, intents []finalmask.UDPHopNatIntent) []string {
	reconcileMu.Lock()
	defer reconcileMu.Unlock()
	if run == nil {
		run = ExecRunner
	}
	var warnings []string
	warnf := func(format string, args ...any) {
		warnings = append(warnings, fmt.Sprintf(format, args...))
		lg.Warningf("udphop NAT: "+format, args...)
	}

	valid := make([]finalmask.UDPHopNatIntent, 0, len(intents))
	for _, intent := range intents {
		if !intent.Valid() {
			warnf("skipping invalid intent %s", intent.String())
			continue
		}
		valid = append(valid, intent)
	}

	for _, bin := range natBinaries {
		reconcileFamily(run, bin, valid, warnf)
	}
	if len(warnings) == 0 && len(valid) > 0 {
		lg.Infof("udphop NAT: %d rule(s) reconciled in chain %s (iptables+ip6tables)", len(valid), ChainName)
	}
	return warnings
}

// reconcileFamily reconciles one netfilter family. ipv6 (ip6tables) is
// best-effort: its errors surface as warnings and never abort the loop.
func reconcileFamily(run Runner, bin string, intents []finalmask.UDPHopNatIntent, warnf func(string, ...any)) {
	chainExists := run(bin, "-t", "nat", "-nL", ChainName) == nil
	if len(intents) == 0 {
		if !chainExists {
			return // nothing ours left on the host
		}
		// Remove only our jump and our chain; ignore "no such rule/chain" races.
		_ = run(bin, "-t", "nat", "-D", "PREROUTING", "-j", ChainName)
		if err := run(bin, "-t", "nat", "-F", ChainName); err != nil {
			warnf("%s: flush %s: %v", bin, ChainName, err)
		}
		if err := run(bin, "-t", "nat", "-X", ChainName); err != nil {
			warnf("%s: delete chain %s: %v", bin, ChainName, err)
		}
		return
	}

	if !chainExists {
		if err := run(bin, "-t", "nat", "-N", ChainName); err != nil {
			warnf("%s: create chain %s: %v", bin, ChainName, err)
			return // without the chain the appends cannot work either
		}
	}
	if err := run(bin, "-t", "nat", "-F", ChainName); err != nil {
		warnf("%s: flush %s: %v", bin, ChainName, err)
		return
	}
	for _, intent := range intents {
		if err := run(bin, ruleArgs(intent)...); err != nil {
			warnf("%s: add %s: %v", bin, intent.String(), err)
		}
	}
	// Idempotent jump from PREROUTING: -C exits non-zero when it is missing.
	if run(bin, "-t", "nat", "-C", "PREROUTING", "-j", ChainName) != nil {
		if err := run(bin, "-t", "nat", "-A", "PREROUTING", "-j", ChainName); err != nil {
			warnf("%s: jump PREROUTING -> %s: %v", bin, ChainName, err)
		}
	}
}

// ruleArgs builds the argv of one REDIRECT rule. Every dynamic value comes
// from intent fields that Reconcile has already validated as ports, and is
// rendered through strconv — no request string reaches argv.
func ruleArgs(intent finalmask.UDPHopNatIntent) []string {
	dport := strconv.Itoa(intent.FromPortMin)
	if intent.FromPortMax != intent.FromPortMin {
		dport = strconv.Itoa(intent.FromPortMin) + ":" + strconv.Itoa(intent.FromPortMax)
	}
	return []string{
		"-t", "nat", "-A", ChainName,
		"-p", "udp",
		"--dport", dport,
		"-j", "REDIRECT",
		"--to-ports", strconv.Itoa(intent.ToPort),
	}
}
