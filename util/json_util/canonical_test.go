package json_util

import (
	"testing"
)

func TestCanonicalJSONBytes_stableKeyOrder(t *testing.T) {
	raw := []byte(`{"b":1,"a":{"z":2,"y":3},"c":[1,2]}`)
	first, err := CanonicalJSONBytes(raw)
	if err != nil {
		t.Fatal(err)
	}
	second, err := CanonicalJSONBytes(raw)
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatalf("non-deterministic canonical output:\n%s\n%s", first, second)
	}
	if string(first) != `{"a":{"y":3,"z":2},"b":1,"c":[1,2]}` {
		t.Fatalf("unexpected canonical: %s", first)
	}
}
