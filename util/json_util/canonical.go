package json_util

import (
	"encoding/json"
	"sort"
)

// CanonicalJSONBytes returns JSON with lexicographically sorted object keys at every level.
// Arrays preserve element order. Used for stable config hashing and equality checks.
func CanonicalJSONBytes(raw []byte) ([]byte, error) {
	if len(raw) == 0 {
		return []byte("null"), nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return json.Marshal(sortJSONValue(v))
}

func sortJSONValue(v any) any {
	switch x := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(keys))
		for _, k := range keys {
			out[k] = sortJSONValue(x[k])
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i := range x {
			out[i] = sortJSONValue(x[i])
		}
		return out
	default:
		return v
	}
}
