package mesh

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/konstpic/sharx-code/v2/mesh/embedded"
	"github.com/konstpic/sharx-code/v2/mesh/protocol"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const EtcdImage = "quay.io/coreos/etcd:v3.6.15"

type EtcdMember struct {
	ID         string   `json:"ID"`
	Name       string   `json:"name"`
	PeerURLs   []string `json:"peerURLs"`
	ClientURLs []string `json:"clientURLs"`
	Learner    bool     `json:"isLearner"`
}
type MembershipOperation struct {
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Stage string `json:"stage"`
	ID    string `json:"member_id,omitempty"`
}

func (c *Controller) member(name string) Member {
	d := c.enrolled[name]
	return Member{Name: name, Host: d.Host, Overlay: d.Overlay, ClientURL: "https://" + d.Overlay + ":2399", PeerURL: "https://" + d.Overlay + ":2391"}
}
func (c *Controller) listMembers() ([]EtcdMember, error) {
	s, e := c.store()
	if e != nil {
		return nil, e
	}
	defer s.Client.CloseIdleConnections()
	var r struct {
		Members []EtcdMember `json:"members"`
	}
	e = s.RPC(c.ctx, "/cluster/member/list", map[string]any{}, &r)
	return r.Members, e
}
func (c *Controller) records(members []EtcdMember) ([]Member, error) {
	out := []Member{}
	for _, m := range members {
		if m.Learner {
			continue
		}
		d, known := c.enrolled[m.Name]
		if !known || len(m.PeerURLs) != 1 || m.PeerURLs[0] != "https://"+d.Overlay+":2391" || len(m.ClientURLs) != 1 || m.ClientURLs[0] != "https://"+d.Overlay+":2399" {
			return nil, errors.New("etcd member not in enrolled registry")
		}
		out = append(out, c.member(m.Name))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}
func (c *Controller) cacheMembers(records []Member) error {
	if e := c.save("etcd-seeds.json", map[string]any{"members": records}); e != nil {
		return e
	}
	c.members = records
	return nil
}
func (c *Controller) saveMembers(records []Member) error {
	if e := c.cacheMembers(records); e != nil {
		return e
	}
	s, e := c.store()
	if e != nil {
		return e
	}
	defer s.Client.CloseIdleConnections()
	return s.Put(c.ctx, protocol.Prefix+"control/etcd", map[string]any{"members": records}, 0)
}
func (c *Controller) etcdHealth(records []Member, all bool) ([]string, error) {
	alive := []string{}
	s, e := c.store()
	if e != nil {
		return nil, e
	}
	defer s.Client.CloseIdleConnections()
	for _, m := range records {
		one := *s
		one.Endpoints = []string{m.ClientURL}
		var result map[string]any
		if e = one.RPC(c.ctx, "/kv/range", map[string]string{"key": protocol.B64(protocol.Prefix + "health")}, &result); e == nil {
			alive = append(alive, m.Name)
		}
	}
	required := len(records)/2 + 1
	if all {
		required = len(records)
	}
	if len(alive) < required {
		return alive, errors.New("недостаточно здоровых участников etcd")
	}
	return alive, nil
}
func (c *Controller) prepareEtcd(name string, allowExisting bool) error {
	if d := c.enrolled[name]; d.Transport == "embedded" {
		cert, key, e := c.issue("sharx-mesh-member-"+name, []string{d.Overlay, d.Host, "127.0.0.1", "localhost", name}, true)
		if e != nil {
			return e
		}
		return c.agentCall(name, "etcd-prepare", embedded.EtcdTLS{CA: string(c.caPEM), Cert: string(cert), Key: string(key), AllowExisting: allowExisting}, nil)
	}
	if _, e := c.remote(name, "command -v docker >/dev/null || (DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io >/dev/null)", nil, 10*time.Minute); e != nil {
		return e
	}

	b, e := c.remote(name, "if docker inspect sharx-mesh-etcd >/dev/null 2>&1; then echo occupied; elif test -d /var/lib/sharx-mesh-etcd/member; then echo data; else echo empty; fi", nil, 20*time.Second)
	if e != nil {
		return e
	}
	switch strings.TrimSpace(string(b)) {
	case "occupied":
		return errors.New("существующий контейнер etcd не будет перезаписан")
	case "data":
		if !allowExisting {
			return errors.New("существующие данные etcd не будут перезаписаны")
		}
		marker, e := c.remote(name, "cat /etc/sharx-mesh-etcd/managed.json", nil, 20*time.Second)
		if e != nil {
			return errors.New("данные etcd не помечены как выведенные")
		}
		var managed struct {
			Retired bool `json:"retired"`
		}
		if json.Unmarshal(marker, &managed) != nil || !managed.Retired {
			return errors.New("данные etcd не помечены как выведенные")
		}
		if _, e = c.remote(name, "mv /var/lib/sharx-mesh-etcd "+quote("/var/lib/sharx-mesh-etcd.retired-"+randomID()), nil, 30*time.Second); e != nil {
			return e
		}
	case "empty":
	default:
		return errors.New("не удалось проверить данные etcd")
	}

	d := c.enrolled[name]
	cert, key, e := c.issue("sharx-mesh-member-"+name, []string{d.Overlay, d.Host, "127.0.0.1", "localhost", name}, true)
	if e != nil {
		return e
	}
	for _, f := range []struct {
		name string
		b    []byte
	}{{"ca.crt", c.caPEM}, {"server.crt", cert}, {"server.key", key}} {
		if e = c.put(name, "/etc/sharx-mesh-etcd/tls/"+f.name, f.b, "600"); e != nil {
			return e
		}
	}
	_, e = c.remote(name, "docker image inspect "+quote(EtcdImage)+" >/dev/null 2>&1 || docker pull "+quote(EtcdImage), nil, 5*time.Minute)
	return e
}
func (c *Controller) launchEtcd(name, cluster, state, token string) error {
	if c.enrolled[name].Transport == "embedded" {
		return c.agentCall(name, "etcd-start", embedded.EtcdStart{Cluster: cluster, State: state, Token: token}, nil)
	}
	m := c.member(name)
	args := []string{"docker", "run", "-d", "--name", "sharx-mesh-etcd", "--restart", "always", "--net", "host", "--label", "app=sharx-mesh-etcd", "-v", "/var/lib/sharx-mesh-etcd:/etcd-data", "-v", "/etc/sharx-mesh-etcd/tls:/etcd-tls:ro", EtcdImage, "etcd", "--name=" + name, "--data-dir=/etcd-data", "--initial-cluster-state=" + state, "--initial-cluster=" + cluster, "--listen-client-urls=" + m.ClientURL + ",https://127.0.0.1:2399", "--advertise-client-urls=" + m.ClientURL, "--listen-peer-urls=" + m.PeerURL, "--initial-advertise-peer-urls=" + m.PeerURL, "--cert-file=/etcd-tls/server.crt", "--key-file=/etcd-tls/server.key", "--trusted-ca-file=/etcd-tls/ca.crt", "--client-cert-auth=true", "--peer-cert-file=/etcd-tls/server.crt", "--peer-key-file=/etcd-tls/server.key", "--peer-trusted-ca-file=/etcd-tls/ca.crt", "--peer-client-cert-auth=true", "--auto-compaction-retention=1", "--quota-backend-bytes=268435456"}
	if token != "" {
		args = append(args, "--initial-cluster-token="+token)
	}
	for i := range args {
		args[i] = quote(args[i])
	}
	_, e := c.remote(name, "install -d -m 700 /var/lib/sharx-mesh-etcd; if docker inspect sharx-mesh-etcd >/dev/null 2>&1; then docker start sharx-mesh-etcd; else "+strings.Join(args, " ")+"; fi", nil, 90*time.Second)
	return e
}

type Bootstrap struct {
	Names    []string `json:"names"`
	Token    string   `json:"token"`
	Prepared []string `json:"prepared"`
}

func contains(names []string, n string) bool {
	for _, v := range names {
		if v == n {
			return true
		}
	}
	return false
}
func (c *Controller) pause(d time.Duration) error {
	select {
	case <-c.ctx.Done():
		return c.ctx.Err()
	case <-time.After(d):
		return nil
	}
}
func (c *Controller) bootstrap(names []string, j *Job) error {
	sort.Strings(names)
	if len(names) != 3 && len(names) != 5 && len(names) != 7 {
		return errors.New("выберите 3, 5 или 7 нод")
	}
	for i, n := range names {
		if _, ok := c.enrolled[n]; !ok || (i > 0 && names[i-1] == n) {
			return errors.New("нужны разные установленные ноды")
		}
	}
	var pending Bootstrap
	path := filepath.Join(c.dir, "bootstrap.json")
	e := readJSON(path, &pending)
	if e != nil && !os.IsNotExist(e) {
		return e
	}
	if os.IsNotExist(e) {
		if len(c.members) > 0 {
			return errors.New("etcd уже установлен; используйте learner")
		}
		pending = Bootstrap{Names: names, Token: randomID(), Prepared: []string{}}
		if e = c.save("bootstrap.json", pending); e != nil {
			return e
		}
	} else {
		sort.Strings(pending.Names)
		if strings.Join(pending.Names, ",") != strings.Join(names, ",") {
			return errors.New("повторите незавершённую установку с тем же составом")
		}
	}
	records := []Member{}
	cluster := []string{}
	for _, n := range names {
		m := c.member(n)
		records = append(records, m)
		cluster = append(cluster, n+"="+m.PeerURL)
	}
	if e = c.cacheMembers(records); e != nil {
		return e
	}
	if e = c.seedAgents(j); e != nil {
		return e
	}
	for _, n := range names {
		if !contains(pending.Prepared, n) {
			if e = c.prepareEtcd(n, false); e != nil {
				return e
			}
			pending.Prepared = append(pending.Prepared, n)
			if e = c.save("bootstrap.json", pending); e != nil {
				return e
			}
		}
		if e = c.launchEtcd(n, strings.Join(cluster, ","), "new", pending.Token); e != nil {
			return e
		}
		c.step(j, "etcd "+n+" запущен с mTLS")
	}
	deadline := time.Now().Add(2 * time.Minute)
	for {
		if _, e = c.etcdHealth(records, true); e == nil {
			break
		}
		if time.Now().After(deadline) {
			return errors.New("кворум пока не собран; повторите установку, план и данные сохранены")
		}
		if e = c.pause(3 * time.Second); e != nil {
			return e
		}
	}
	if e = c.publishRegistry(); e != nil {
		return e
	}
	return os.Remove(path)
}
func (c *Controller) journalMember(op *MembershipOperation) error {
	if e := c.save("membership.json", op); e != nil {
		return e
	}
	c.operation = op
	return nil
}
func (c *Controller) changeMember(name string, add bool, j *Job) error {
	if _, ok := c.enrolled[name]; !ok {
		return errors.New("неизвестная нода")
	}
	kind := "remove"
	if add {
		kind = "add"
	}
	if c.operation != nil && (c.operation.Name != name || c.operation.Kind != kind) {
		return errors.New("сначала завершите сохранённое изменение состава")
	}
	members, e := c.listMembers()
	if e != nil {
		return e
	}
	peer := c.member(name).PeerURL
	var target *EtcdMember
	for i, m := range members {
		if m.Name == name || contains(m.PeerURLs, peer) {
			target = &members[i]
		}
	}
	s, e := c.store()
	if e != nil {
		return e
	}
	defer s.Client.CloseIdleConnections()
	if add {
		if target != nil && !target.Learner {
			records, e := c.records(members)
			if e != nil {
				return e
			}
			if e = c.saveMembers(records); e != nil {
				return e
			}
			return c.journalMember(nil)
		}
		for _, m := range members {
			if m.Learner && (target == nil || m.ID != target.ID) {
				return errors.New("сначала завершите подключение другого learner")
			}
		}
		if len(members) >= 7 && target == nil {
			return errors.New("максимум семь участников etcd")
		}
		if _, e = c.etcdHealth(c.members, false); e != nil {
			return e
		}
		if c.operation == nil {
			if e = c.prepareEtcd(name, true); e != nil {
				return e
			}
			if e = c.journalMember(&MembershipOperation{Name: name, Kind: kind, Stage: "prepared"}); e != nil {
				return e
			}
		}
		if target == nil {
			var r struct {
				Member  EtcdMember   `json:"member"`
				Members []EtcdMember `json:"members"`
			}
			if e = s.RPC(c.ctx, "/cluster/member/add", map[string]any{"peerURLs": []string{peer}, "isLearner": true}, &r); e != nil {
				return e
			}
			if r.Member.ID == "" {
				return errors.New("etcd returned no learner ID")
			}
			target = &r.Member
			members = r.Members
		}
		if e = c.journalMember(&MembershipOperation{Name: name, Kind: kind, Stage: "joining", ID: target.ID}); e != nil {
			return e
		}
		marker, _ := json.Marshal(map[string]any{"member_id": target.ID, "retired": false})
		if e = c.put(name, "/etc/sharx-mesh-etcd/managed.json", marker, "600"); e != nil {
			return e
		}
		cluster := []string{}
		for _, m := range members {
			mn := m.Name
			if m.ID == target.ID {
				mn = name
			}
			if !protocol.Name.MatchString(mn) || len(m.PeerURLs) != 1 {
				return errors.New("invalid etcd membership response")
			}
			cluster = append(cluster, mn+"="+m.PeerURLs[0])
		}
		if e = c.launchEtcd(name, strings.Join(cluster, ","), "existing", ""); e != nil {
			return e
		}
		c.step(j, "Learner запущен без увеличения кворума")
		deadline := time.Now().Add(3 * time.Minute)
		for {
			e = s.RPC(c.ctx, "/cluster/member/promote", map[string]any{"ID": target.ID}, nil)
			if e == nil {
				break
			}
			if time.Now().After(deadline) {
				return fmt.Errorf("learner не догнал данные; план сохранён: %w", e)
			}
			if e = c.pause(3 * time.Second); e != nil {
				return e
			}
		}
		c.step(j, "etcd подтвердил синхронизацию и повысил learner до voter")
	} else {
		if target == nil && c.operation == nil {
			return nil
		}
		if target != nil {
			remaining := []EtcdMember{}
			voters := 0
			for _, m := range members {
				if m.ID != target.ID {
					remaining = append(remaining, m)
					if !m.Learner {
						voters++
					}
				}
			}
			if !target.Learner && voters < 3 {
				return errors.New("сначала добавьте замену: должно остаться минимум три голосующих участника")
			}
			records, e := c.records(remaining)
			if e != nil {
				return e
			}
			if _, e = c.etcdHealth(records, true); e != nil {
				return e
			}
			if e = c.journalMember(&MembershipOperation{Name: name, Kind: kind, Stage: "removing", ID: target.ID}); e != nil {
				return e
			}
			if e = c.cacheMembers(records); e != nil {
				return e
			}
			if e = s.RPC(c.ctx, "/cluster/member/remove", map[string]any{"ID": target.ID}, nil); e != nil {
				return e
			}
			if e = c.journalMember(&MembershipOperation{Name: name, Kind: kind, Stage: "cleanup", ID: target.ID}); e != nil {
				return e
			}
		}
		marker, _ := json.Marshal(map[string]any{"retired": true})
		if e = c.put(name, "/etc/sharx-mesh-etcd/managed.json", marker, "600"); e != nil {
			return e
		}
		if e = c.stopMemberProcess(name); e != nil {
			return e
		}
		c.step(j, "etcd остановлен; данные сохранены на ноде")
	}
	members, e = c.listMembers()
	if e != nil {
		return e
	}
	records, e := c.records(members)
	if e != nil {
		return e
	}
	if e = c.saveMembers(records); e != nil {
		return e
	}
	if e = c.journalMember(nil); e != nil {
		return e
	}
	return c.seedAgents(j)
}
