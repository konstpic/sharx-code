package xray

import (
	"bytes"
	"encoding/json"

	"github.com/konstpic/sharx-code/v2/util/json_util"
)

// EqualCanonical reports whether two configs are equivalent after canonical JSON normalization.
// Falls back to Equals when canonicalization fails.
func (c *Config) EqualCanonical(other *Config) bool {
	if c == nil || other == nil {
		return c == other
	}
	a, errA := configCanonicalBytes(c)
	b, errB := configCanonicalBytes(other)
	if errA != nil || errB != nil {
		return c.Equals(other)
	}
	return bytes.Equal(a, b)
}

func configCanonicalBytes(c *Config) ([]byte, error) {
	raw, err := json.Marshal(c)
	if err != nil {
		return nil, err
	}
	return json_util.CanonicalJSONBytes(raw)
}
