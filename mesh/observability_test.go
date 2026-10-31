package mesh

import (
	"encoding/json"
	"testing"
)

func TestQuorumViewUsesRealCountersAndDoesNotInventMissingHealth(t *testing.T) {
	records := []Member{{Name: "n1", ClientURL: "https://10.203.0.1:2399"}, {Name: "n2"}, {Name: "n3"}}
	live := []EtcdMember{{Name: "n1", ID: "18446744073709551614"}, {Name: "n2", ID: "18446744073709551613"}}
	details := map[string]map[string]any{"n1": {"leader": "18446744073709551614", "raftTerm": "7", "raftIndex": json.Number("9007199254740993"), "version": "3.6.15", "dbSize": "123456"}, "n2": {"leader": "18446744073709551614"}}
	q := quorumView(records, live, map[string]bool{"n1": true, "n2": true}, details)
	if q["leader"] != "n1" || q["quorum"] != true || q["healthy"] != 2 {
		t.Fatal(q)
	}
	rows := q["members"].([]map[string]any)
	if rows[0]["raft_index"] != "9007199254740993" || rows[0]["db_size"] != uint64(123456) || rows[2]["healthy"] != false {
		t.Fatal(rows)
	}
	if _, exists := rows[2]["raft_term"]; exists {
		t.Fatal("unknown metrics fabricated")
	}
	details["n2"]["leader"] = "18446744073709551613"
	q = quorumView(records, live, map[string]bool{}, details)
	if q["leader"] != "" || q["quorum"] != false {
		t.Fatal("conflicting leader reports treated as certain", q)
	}
}
