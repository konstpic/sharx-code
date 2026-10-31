// sharx-mesh-agent is bundled in the panel image for installation on enrolled hosts.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/konstpic/sharx-code/v2/mesh/agent"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	var e error
	mode := "run"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	switch mode {
	case "run":
		path := "/etc/sharx-mesh/config.json"
		if len(os.Args) > 2 {
			path = os.Args[2]
		}
		e = agent.Run(ctx, path)
	case "probe":
		var q agent.ProbeRequest
		e = json.NewDecoder(os.Stdin).Decode(&q)
		if e == nil {
			var v any
			v, e = agent.Probe(ctx, q)
			if e == nil {
				e = json.NewEncoder(os.Stdout).Encode(v)
			}
		}
	case "forward":
		e = agent.Forward(ctx, "/etc/sharx-meshfwd/rules.json")
	default:
		e = fmt.Errorf("unknown agent mode")
	}
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
