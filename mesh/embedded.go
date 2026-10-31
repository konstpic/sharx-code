package mesh

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/konstpic/sharx-code/v2/mesh/embedded"
)

func (c *Controller) agentCall(name, operation string, data any, out any) error {
	d, ok := c.enrolled[name]
	if !ok || d.Transport != "embedded" {
		return errors.New("embedded mesh participant missing")
	}
	return c.rpc("mesh-agent", map[string]any{"uuid": d.Node, "operation": operation, "data": data}, out)
}
func (c *Controller) enrollEmbedded(q EnrollRequest, j *Job) error {
	if q.NodeID < 1 || q.NodeID > 9999999 || (q.Role != "entry" && q.Role != "exit") || (q.Kind != "" && q.Kind != "node" && q.Kind != "balancer") {
		return errors.New("invalid mesh participant or role")
	}
	if c.operation != nil {
		return errors.New("finish etcd membership operation first")
	}
	prefix, uuid := "n", "node-"
	if q.Kind == "balancer" {
		prefix, uuid = "b", "balancer-"
		if q.Role != "entry" {
			return errors.New("balancer participates as mesh entry/transit")
		}
	}
	uuid += strconv.Itoa(q.NodeID)
	name := prefix + strconv.Itoa(q.NodeID)
	var rows []struct {
		UUID    string `json:"uuid"`
		Address string `json:"address"`
		Enabled bool   `json:"enabled"`
	}
	if e := c.rpc("nodes", nil, &rows); e != nil {
		return e
	}
	host := ""
	for _, r := range rows {
		if r.UUID == uuid && r.Enabled {
			host = r.Address
		}
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.To4() == nil || ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() {
		return errors.New("select an enabled registered participant with an IPv4 API address")
	}
	d := Enrolled{Host: host, Role: q.Role, Node: uuid, Transport: "embedded"}
	if old, ok := c.enrolled[name]; ok {
		if old.Transport != "embedded" {
			return errors.New("legacy host agent must be removed before Docker enrollment")
		}
		if old.Host != host || old.Role != q.Role {
			return errors.New("remove previous enrollment before changing role or address")
		}
		d.Overlay, d.Slot = old.Overlay, old.Slot
	}
	var identity struct {
		Pubkey   string `json:"pubkey"`
		Embedded bool   `json:"embedded"`
	}
	if e := c.rpc("mesh-agent", map[string]any{"uuid": uuid, "operation": "identity", "data": nil}, &identity); e != nil {
		return e
	}
	key, e := base64.StdEncoding.DecodeString(identity.Pubkey)
	if e != nil || len(key) != 32 || !identity.Embedded {
		return errors.New("update the participant Docker image to a version with embedded mesh")
	}
	d.Pubkey = identity.Pubkey
	if d.Overlay == "" {
		used := map[string]bool{}
		for _, v := range c.enrolled {
			used[v.Overlay] = true
		}
		for i := 1; i <= 200; i++ {
			addr := fmt.Sprint("10.203.0.", i)
			if !used[addr] {
				d.Overlay = addr
				break
			}
		}
	}
	if d.Overlay == "" {
		return errors.New("no free mesh overlay addresses")
	}
	if d.Role == "exit" && d.Slot == nil {
		used := map[int]bool{}
		for _, v := range c.enrolled {
			if v.Slot != nil {
				used[*v.Slot] = true
			}
		}
		for i := 0; i < 100; i++ {
			if !used[i] {
				slot := i
				d.Slot = &slot
				break
			}
		}
		if d.Slot == nil {
			return errors.New("no free relay slots")
		}
	}
	c.enrolled[name] = d
	if e = c.save("enrolled.json", c.enrolled); e != nil {
		return e
	}
	c.step(j, "Встроенный mesh подтверждён через API; ключ остаётся в томе участника")
	if e = c.configurePorts(); e != nil {
		return e
	}
	if e = c.seedAgents(j); e != nil {
		return e
	}
	if len(c.members) > 0 {
		return c.publishRegistry()
	}
	return nil
}
func (c *Controller) configureEmbedded(name string) error {
	d := c.enrolled[name]
	cert, key, e := c.issue("sharx-mesh-agent-"+name, nil, false)
	if e != nil {
		return e
	}
	eps := []string{}
	for _, m := range c.members {
		eps = append(eps, m.ClientURL)
	}
	return c.agentCall(name, "configure", embedded.Setup{Name: name, Overlay: d.Overlay, Nodes: c.seed(), Etcd: eps, CA: string(c.caPEM), Cert: string(cert), Key: string(key)}, nil)
}

type agentTransport struct {
	controller *Controller
	fallback   http.RoundTripper
	names      map[string]string
}

func (t *agentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	name, ok := t.names[req.URL.Hostname()]
	if !ok {
		return nil, errors.New("unregistered etcd endpoint")
	}
	d := t.controller.enrolled[name]
	if d.Transport != "embedded" {
		return t.fallback.RoundTrip(req)
	}
	body, e := io.ReadAll(io.LimitReader(req.Body, 4<<20))
	if e != nil {
		return nil, e
	}
	return t.proxy(req.Context(), req, name, d.Node, body)
}
func (t *agentTransport) proxy(ctx context.Context, req *http.Request, name, uuid string, body []byte) (*http.Response, error) {
	data, _ := json.Marshal(map[string]any{"uuid": uuid, "operation": "etcd-proxy", "data": embedded.Proxy{Path: req.URL.Path, Body: json.RawMessage(body)}})
	out, e := t.controller.bridge(ctx, "mesh-agent", data)
	if e != nil {
		return nil, e
	}
	b, e := json.Marshal(out)
	if e != nil {
		return nil, e
	}
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(b)), Request: req}, nil
}
func (t *agentTransport) CloseIdleConnections() {
	if c, ok := t.fallback.(interface{ CloseIdleConnections() }); ok {
		c.CloseIdleConnections()
	}
}

func (c *Controller) stopMemberProcess(name string) error {
	if c.enrolled[name].Transport == "embedded" {
		return c.agentCall(name, "etcd-stop", nil, nil)
	}
	_, e := c.remote(name, "if docker inspect sharx-mesh-etcd >/dev/null 2>&1; then docker rm -f sharx-mesh-etcd >/dev/null; fi", nil, 45*time.Second)
	return e
}
