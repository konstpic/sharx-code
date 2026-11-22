package service

import (
	"testing"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/database/testdb"
)

func TestInboundExplicitListenPortConflict(t *testing.T) {
	db := testdb.New(t)
	s := InboundService{}
	const listen = "127.0.0.1"
	const port = 19443

	inbound := &model.Inbound{
		UserId: 1, Port: port, Listen: listen, Protocol: model.VLESS,
		Settings: `{"clients":[],"decryption":"none"}`, StreamSettings: `{"network":"tcp"}`, Sniffing: "{}",
	}
	created, _, err := s.AddInbound(inbound)
	if err != nil {
		t.Fatalf("create inbound with explicit listen: %v", err)
	}
	for _, addr := range []string{"", "0.0.0.0", "::", "::0", listen, "127.0.0.2"} {
		t.Run("existing="+addr, func(t *testing.T) {
			if err := db.Model(created).Update("listen", addr).Error; err != nil {
				t.Fatal(err)
			}
			got, err := s.checkPortExist(listen, port, model.VLESS, 0)
			want := addr != "127.0.0.2"
			if err != nil || got != want {
				t.Fatalf("checkPortExist = %v, %v; want %v, nil", got, err, want)
			}
		})
	}
}
