package api

import (
	"github.com/konstpic/sharx-code/v2/node/xray"
	"testing"
)

func TestStatsDeliverySurvivesRestart(t *testing.T) {
	t.Setenv("SHARX_NODE_DATA_DIR", t.TempDir())
	reads := 0
	collect := func() (*xray.NodeStats, error) {
		reads++
		return &xray.NodeStats{OnlineClients: []string{"fixture"}}, nil
	}
	first, err := new(statsDelivery).next("", collect)
	if err != nil {
		t.Fatal(err)
	}
	restarted := new(statsDelivery)
	replay, err := restarted.next("", collect)
	if err != nil {
		t.Fatal(err)
	}
	if first.BatchID == "" || replay.BatchID != first.BatchID || reads != 1 || len(replay.OnlineClients) != 1 {
		t.Fatal("lost pending batch on restart")
	}
	next, err := restarted.next(first.BatchID, collect)
	if err != nil {
		t.Fatal(err)
	}
	if next.BatchID == first.BatchID || reads != 2 {
		t.Fatal("acknowledgment did not advance the batch")
	}
}
