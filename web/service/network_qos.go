package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/node/qos"
	"net/http"
	"time"
)

func (s *NodeService) networkQoSRequest(ctx context.Context, node *model.Node, spec *qos.Spec) (qos.Status, error) {
	var status qos.Status
	cl, err := s.createHTTPClient(node, 30*time.Second)
	if err != nil {
		return status, err
	}
	method := http.MethodGet
	var body []byte
	if spec != nil {
		method = http.MethodPost
		body, err = json.Marshal(spec)
		if err != nil {
			return status, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, nodeRequestBaseURL(node)+"/api/v1/network-qos", bytes.NewReader(body))
	if err != nil {
		return status, err
	}
	req.Header.Set("Content-Type", "application/json")
	if err := s.setNodeAuthHeader(node, req); err != nil {
		return status, err
	}
	resp, err := cl.Do(req)
	if err != nil {
		return status, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return status, fmt.Errorf("worker QoS unavailable (HTTP %d)", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return status, err
	}
	if !status.Ready || status.AppliedHash == "" || status.AppliedHash != status.DesiredHash {
		return status, errors.New("worker QoS not enforced")
	}
	return status, nil
}
func (s NetworkService) enforceNetworkQoS(node *model.Node, port int, p PublishParams) error {
	spec := qos.Spec{Port: port, CapacityMbps: node.BandwidthMbps, SpeedLimitMbps: p.SpeedLimitMbps, ReserveMbps: p.ReserveMbps}
	if err := qos.Validate(spec); err != nil {
		return err
	}
	ns := NodeService{}
	_, err := ns.networkQoSRequest(context.Background(), node, &spec)
	return err
}

func (s *NodeService) networkEvidenceRequest(ctx context.Context, node *model.Node, body any, out any) error {
	cl, err := s.createHTTPClient(node, 30*time.Second)
	if err != nil {
		return err
	}
	method := http.MethodGet
	path := "/api/v1/network-evidence/key"
	var raw []byte
	if body != nil {
		method = http.MethodPost
		path = "/api/v1/network-evidence"
		raw, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, nodeRequestBaseURL(node)+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if err := s.setNodeAuthHeader(node, req); err != nil {
		return err
	}
	resp, err := cl.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("worker evidence unavailable (HTTP %d)", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (s *NodeService) RevokeNetworkUser(node *model.Node, tag, email string) error {
	cl, err := s.createHTTPClient(node, 15*time.Second)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]string{"inbound_tag": tag, "email": email})
	req, err := http.NewRequest("POST", nodeRequestBaseURL(node)+"/api/v1/network-revoke", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if err := s.setNodeAuthHeader(node, req); err != nil {
		return err
	}
	resp, err := cl.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("network user revocation failed (HTTP %d)", resp.StatusCode)
	}
	return nil
}
