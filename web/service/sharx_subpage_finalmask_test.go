package service

import (
	"strings"
	"testing"
)

func v2WithFinalMaskSlot(slot string) string {
	return `{"schemaVersion":"sharx-v2","branding":{"title":"T"},` +
		`"jsonTemplates":{"fragment":"","mux":"","noises":"","rules":"","finalMask":` + slot + `}}`
}

// The default-masks slot of the JSON subscription is validated with the shared
// finalmask module: broken JSON, unknown types and a broken udp[] order are
// rejected at settings-save time. Transport-specific checks are not applied
// here (the inbound the mask lands on is unknown), so tcp[] masks are accepted.
func TestValidateSharxSubpageConfigFinalMaskSlot(t *testing.T) {
	valid := []string{
		`""`,
		`"{\"tcp\":[{\"type\":\"fragment\",\"settings\":{\"packets\":\"tlshello\",\"lengths\":[\"100-200\"],\"delays\":[\"1-2\"]}}]}"`,
		`"{\"udp\":[{\"type\":\"salamander\",\"settings\":{\"password\":\"strongpsk\"}}]}"`,
		`"{\"quicParams\":{\"maxIdleTimeout\":30}}"`,
	}
	for _, slot := range valid {
		if err := ValidateSharxSubpageConfigJSON(v2WithFinalMaskSlot(slot)); err != nil {
			t.Fatalf("slot %s must be accepted: %v", slot, err)
		}
	}

	invalid := []struct {
		slot string
		want string
	}{
		{`"{not json"`, "jsonTemplates.finalMask"},
		{`"[{\"type\":\"fragment\"}]"`, "JSON object"},
		{`"{\"tcp\":[{\"type\":\"not-a-mask\"}]}"`, "unknown tcp finalmask type"},
		{`"{\"udp\":[{\"type\":\"udphop\",\"settings\":{\"mode\":\"intervalremote\",\"interval\":30,\"remoteIPs\":[\"1.2.3.4\"],\"remotePorts\":[\"443\"]}},{\"type\":\"salamander\",\"settings\":{\"password\":\"strongpsk\"}}]}"`, "must be the last"},
	}
	for _, tc := range invalid {
		err := ValidateSharxSubpageConfigJSON(v2WithFinalMaskSlot(tc.slot))
		if err == nil {
			t.Fatalf("slot %s must be rejected", tc.slot)
		}
		if !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("slot %s: error %v does not mention %q", tc.slot, err, tc.want)
		}
	}
}
