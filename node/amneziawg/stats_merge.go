package amneziawg

import (
	"encoding/json"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/xray"
)

const awgTransferSnapshotFile = "sharx_awg_transfer.json"

type awgPeerTransfer struct {
	Rx uint64 `json:"rx"`
	Tx uint64 `json:"tx"`
}

type awgTransferSnapshot struct {
	Peers map[string]awgPeerTransfer `json:"peers"`
}

type awgDumpPeer struct {
	Rx              uint64
	Tx              uint64
	LatestHandshake int64
	Endpoint        string
}

// MergeAmneziaWgIntoNodeStats polls `awg show dump` for each running sidecar and merges
// per-peer transfer deltas into traffic / clientTraffic (same shape as Xray stats).
func (m *Manager) MergeAmneziaWgIntoNodeStats(traffic *[]*xray.Traffic, clientTraffic *[]*xray.ClientTraffic, onlineClients *[]string) {
	if m == nil || clientTraffic == nil {
		return
	}
	m.mu.Lock()
	type sidecarRow struct {
		tag        string
		iface      string
		peerEmails map[string]string
		stateDir   string
	}
	rows := make([]sidecarRow, 0, len(m.running))
	for tag, st := range m.running {
		if st == nil || !st.configured {
			continue
		}
		iface := strings.TrimSpace(st.iface)
		if iface == "" {
			continue
		}
		stateDir := filepath.Dir(st.confPath)
		emails := make(map[string]string, len(st.peerEmails))
		for k, v := range st.peerEmails {
			emails[k] = v
		}
		rows = append(rows, sidecarRow{tag: tag, iface: iface, peerEmails: emails, stateDir: stateDir})
	}
	m.mu.Unlock()
	if len(rows) == 0 {
		return
	}

	clientIdx := map[string]int{}
	for i, ct := range *clientTraffic {
		if ct == nil {
			continue
		}
		em := strings.ToLower(strings.TrimSpace(ct.Email))
		if em != "" {
			clientIdx[em] = i
		}
	}

	var onlineMu sync.Mutex
	onlineAdded := map[string]struct{}{}
	if onlineClients != nil {
		for _, e := range *onlineClients {
			k := strings.ToLower(strings.TrimSpace(e))
			if k != "" {
				onlineAdded[k] = struct{}{}
			}
		}
	}
	addOnline := func(email string) {
		if onlineClients == nil {
			return
		}
		email = strings.TrimSpace(email)
		if email == "" {
			return
		}
		k := strings.ToLower(email)
		onlineMu.Lock()
		defer onlineMu.Unlock()
		if _, ok := onlineAdded[k]; ok {
			return
		}
		onlineAdded[k] = struct{}{}
		*onlineClients = append(*onlineClients, email)
	}

	awg := findAwgBinary()
	if awg == "" {
		return
	}

	for _, row := range rows {
		peers, err := fetchAwgDumpPeers(awg, row.iface)
		if err != nil {
			logger.Debugf("amneziawg stats: %s: %v", row.tag, err)
			continue
		}
		snapPath := filepath.Join(row.stateDir, awgTransferSnapshotFile)
		prev := loadAwgTransferSnapshot(snapPath)
		if prev.Peers == nil {
			prev.Peers = make(map[string]awgPeerTransfer)
		}
		next := awgTransferSnapshot{Peers: make(map[string]awgPeerTransfer, len(peers))}

		var tagUp, tagDown int64
		now := time.Now().Unix()

		for pubKey, cur := range peers {
			next.Peers[pubKey] = awgPeerTransfer{Rx: cur.Rx, Tx: cur.Tx}
			old, had := prev.Peers[pubKey]
			dRx := deltaCounter(cur.Rx, old.Rx, had)
			dTx := deltaCounter(cur.Tx, old.Tx, had)
			if dRx == 0 && dTx == 0 && !(cur.LatestHandshake > 0 && now-cur.LatestHandshake <= 180) {
				continue
			}
			// transfer-rx = from peer (client upload); transfer-tx = to peer (client download).
			dDown := int64(dRx)
			dUp := int64(dTx)
			tagDown += dDown
			tagUp += dUp

			email := strings.TrimSpace(row.peerEmails[pubKey])
			if email == "" {
				email = pubKey
			}
			if dUp > 0 || dDown > 0 {
				addOnline(email)
			}
			if cur.LatestHandshake > 0 && now-cur.LatestHandshake <= 180 {
				addOnline(email)
			}
			if dRx == 0 && dTx == 0 {
				continue
			}

			k := strings.ToLower(email)
			if i, ok := clientIdx[k]; ok {
				(*clientTraffic)[i].Up += dUp
				(*clientTraffic)[i].Down += dDown
			} else {
				clientIdx[k] = len(*clientTraffic)
				*clientTraffic = append(*clientTraffic, &xray.ClientTraffic{
					Email: email,
					Up:    dUp,
					Down:  dDown,
				})
			}
		}

		if err := saveAwgTransferSnapshot(snapPath, next); err != nil {
			logger.Debugf("amneziawg stats: %s: save snapshot: %v", row.tag, err)
		}

		if (tagUp > 0 || tagDown > 0) && traffic != nil {
			*traffic = append(*traffic, &xray.Traffic{
				IsInbound:  true,
				IsOutbound: false,
				Tag:        row.tag,
				Up:         tagUp,
				Down:       tagDown,
			})
		}
	}
}

func fetchAwgDumpPeers(awg, iface string) (map[string]awgDumpPeer, error) {
	out, err := exec.Command(awg, "show", iface, "dump").CombinedOutput()
	if err != nil {
		return nil, err
	}
	peers := make(map[string]awgDumpPeer)
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		// Interface line has 4 fields; peer lines have 8.
		if len(fields) < 8 {
			continue
		}
		pubKey := strings.TrimSpace(fields[0])
		if pubKey == "" || pubKey == "(none)" {
			continue
		}
		hs, _ := strconv.ParseInt(strings.TrimSpace(fields[4]), 10, 64)
		rx, _ := strconv.ParseUint(strings.TrimSpace(fields[5]), 10, 64)
		tx, _ := strconv.ParseUint(strings.TrimSpace(fields[6]), 10, 64)
		peers[pubKey] = awgDumpPeer{Rx: rx, Tx: tx, LatestHandshake: hs, Endpoint: strings.TrimSpace(fields[2])}
	}
	return peers, nil
}

func deltaCounter(cur, old uint64, had bool) uint64 {
	if !had {
		return 0
	}
	if cur >= old {
		return cur - old
	}
	return cur
}

func loadAwgTransferSnapshot(path string) awgTransferSnapshot {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return awgTransferSnapshot{}
	}
	var s awgTransferSnapshot
	if json.Unmarshal(b, &s) != nil {
		return awgTransferSnapshot{}
	}
	return s
}

func saveAwgTransferSnapshot(path string, s awgTransferSnapshot) error {
	tmp := path + ".tmp"
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

const awgSessionHandshakeWindow = 180

// CollectOnlineSessionsForUser returns endpoint IPs of AmneziaWG peers belonging to email
// whose latest handshake is recent (same window as the online flag in node stats).
func (m *Manager) CollectOnlineSessionsForUser(email string) []xray.OnlineIPSession {
	email = strings.ToLower(strings.TrimSpace(email))
	if m == nil || email == "" {
		return nil
	}
	type row struct {
		tag, iface string
		pubKeys    []string
	}
	m.mu.Lock()
	var rows []row
	for tag, st := range m.running {
		if st == nil || !st.configured || strings.TrimSpace(st.iface) == "" {
			continue
		}
		var keys []string
		for pub, em := range st.peerEmails {
			if strings.ToLower(strings.TrimSpace(em)) == email {
				keys = append(keys, pub)
			}
		}
		if len(keys) > 0 {
			rows = append(rows, row{tag: tag, iface: strings.TrimSpace(st.iface), pubKeys: keys})
		}
	}
	m.mu.Unlock()
	if len(rows) == 0 {
		return nil
	}
	awg := findAwgBinary()
	if awg == "" {
		return nil
	}
	now := time.Now().Unix()
	var out []xray.OnlineIPSession
	for _, r := range rows {
		peers, err := fetchAwgDumpPeers(awg, r.iface)
		if err != nil {
			logger.Debugf("amneziawg sessions: %s: %v", r.tag, err)
			continue
		}
		for _, pub := range r.pubKeys {
			p, ok := peers[pub]
			if !ok || p.LatestHandshake <= 0 || now-p.LatestHandshake > awgSessionHandshakeWindow {
				continue
			}
			host, _, err := net.SplitHostPort(p.Endpoint)
			if err != nil || host == "" {
				continue
			}
			out = append(out, xray.OnlineIPSession{
				IP:       host,
				LastSeen: p.LatestHandshake,
				Protocol: "amneziawg",
				Remark:   r.tag,
			})
		}
	}
	return out
}
