package service

import "testing"

func TestSummarizeTemplate(t *testing.T) {
	s := SummarizeTemplate("inbound", []byte(`{"protocol":"VLESS","port":443,"streamSettings":{"network":"tcp","security":"reality"}}`))
	if s["protocol"] != "vless" || s["network"] != "tcp" || s["security"] != "reality" || s["port"] != 443 {
		t.Fatalf("bad inbound summary: %v", s)
	}
	c := SummarizeTemplate("xray_config", []byte(`{"outbounds":[{}],"routing":{"rules":[{},{}]},"dns":{"servers":["a"]}}`))
	if c["outbounds"] != 1 || c["rules"] != 2 || c["dnsServers"] != 1 {
		t.Fatalf("bad config summary: %v", c)
	}
	if len(SummarizeTemplate("inbound", []byte("nope"))) != 0 {
		t.Fatal("garbage must give an empty summary")
	}
}
