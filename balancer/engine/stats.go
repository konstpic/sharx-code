package engine

import (
	"bufio"
	"encoding/csv"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/konstpic/sharx-code/v2/balancer/render"
)

// haproxyFrontend is the cumulative traffic of one listener: In from clients, Out to clients.
type haproxyFrontend struct {
	In, Out int64
}

type haproxyServer struct {
	Up       bool
	Sessions int
	Total    int64
}

// readHAProxyStats asks the runtime socket for `show stat` and returns servers keyed as "backend/server".
func readHAProxyStats() (map[string]haproxyServer, error) {
	srv, _, err := readHAProxyStatsAll()
	return srv, err
}

// readHAProxyStatsAll also returns the frontends keyed by their name ("fe_<pool id>").
func readHAProxyStatsAll() (map[string]haproxyServer, map[string]haproxyFrontend, error) {
	c, err := net.DialTimeout("unix", render.HAProxySocket, 2*time.Second)
	if err != nil {
		return nil, nil, err
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := fmt.Fprint(c, "show stat\n"); err != nil {
		return nil, nil, err
	}
	return parseHAProxyStatAll(bufio.NewReader(c))
}

func parseHAProxyStat(r *bufio.Reader) (map[string]haproxyServer, error) {
	srv, _, err := parseHAProxyStatAll(r)
	return srv, err
}

func parseHAProxyStatAll(r *bufio.Reader) (map[string]haproxyServer, map[string]haproxyFrontend, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	rows, err := cr.ReadAll()
	if err != nil {
		return nil, nil, err
	}
	out := map[string]haproxyServer{}
	fronts := map[string]haproxyFrontend{}
	for _, row := range rows {
		if len(row) < 18 || strings.HasPrefix(row[0], "#") {
			continue
		}
		if row[1] == "FRONTEND" {
			in, _ := strconv.ParseInt(row[8], 10, 64)
			outB, _ := strconv.ParseInt(row[9], 10, 64)
			fronts[row[0]] = haproxyFrontend{In: in, Out: outB}
			continue
		}
		if row[1] == "BACKEND" {
			continue
		}
		sessions, _ := strconv.Atoi(row[4])
		total, _ := strconv.ParseInt(row[7], 10, 64)
		// status: UP, DOWN, NOLB, MAINT, "UP 1/2" (transitioning up), "DOWN 1/2"
		up := strings.HasPrefix(row[17], "UP")
		out[row[0]+"/"+row[1]] = haproxyServer{Up: up, Sessions: sessions, Total: total}
	}
	return out, fronts, nil
}
