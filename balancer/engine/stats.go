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

type haproxyServer struct {
	Up       bool
	Sessions int
}

// readHAProxyStats asks the runtime socket for `show stat` and returns servers keyed as "backend/server".
func readHAProxyStats() (map[string]haproxyServer, error) {
	c, err := net.DialTimeout("unix", render.HAProxySocket, 2*time.Second)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := fmt.Fprint(c, "show stat\n"); err != nil {
		return nil, err
	}
	return parseHAProxyStat(bufio.NewReader(c))
}

func parseHAProxyStat(r *bufio.Reader) (map[string]haproxyServer, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	rows, err := cr.ReadAll()
	if err != nil {
		return nil, err
	}
	out := map[string]haproxyServer{}
	for _, row := range rows {
		if len(row) < 18 || strings.HasPrefix(row[0], "#") {
			continue
		}
		if row[1] == "FRONTEND" || row[1] == "BACKEND" {
			continue
		}
		sessions, _ := strconv.Atoi(row[4])
		// status: UP, DOWN, NOLB, MAINT, "UP 1/2" (transitioning up), "DOWN 1/2"
		up := strings.HasPrefix(row[17], "UP")
		out[row[0]+"/"+row[1]] = haproxyServer{Up: up, Sessions: sessions}
	}
	return out, nil
}
