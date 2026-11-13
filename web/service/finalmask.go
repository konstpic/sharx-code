package service

import (
	"encoding/json"
	"reflect"
	"strings"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/util/common"
	"github.com/konstpic/sharx-code/v2/util/finalmask"
)

// Issue is one finalmask validation finding (see util/finalmask).
type Issue = finalmask.Issue

const (
	// FinalmaskSeverityError marks issues that prevent saving an inbound.
	FinalmaskSeverityError = finalmask.SeverityError
	// FinalmaskSeverityWarning marks tolerated issues.
	FinalmaskSeverityWarning = finalmask.SeverityWarning
)

// ValidateFinalmask validates streamSettings.finalmask for the given protocol.
// An absent finalmask produces no issues.
func ValidateFinalmask(stream map[string]any, protocol string) []Issue {
	return finalmask.Validate(stream, protocol)
}

// NormalizeFinalmask returns a new streamSettings map with finalmask normalized
// (legacy fragment ranges, udphop ordering, quicParams sanitizing and, when
// serverSide is false, removal of server-only masks). The input is not mutated.
func NormalizeFinalmask(stream map[string]any, serverSide bool) map[string]any {
	return finalmask.Normalize(stream, serverSide)
}

// ApplyFinalmaskOnSave validates and normalizes inbound.StreamSettings in place.
// Hard errors are returned to the caller (and surfaced through the panel API as
// success:false with the full issue list); warnings are logged at info level.
// A StreamSettings blob that is not valid JSON is left untouched for the
// pre-existing validation paths to report.
func ApplyFinalmaskOnSave(inbound *model.Inbound) error {
	if inbound == nil || strings.TrimSpace(inbound.StreamSettings) == "" {
		return nil
	}
	var stream map[string]any
	if err := json.Unmarshal([]byte(inbound.StreamSettings), &stream); err != nil || stream == nil {
		return nil
	}
	if _, has := stream["finalmask"]; !has {
		return nil
	}
	protocol := string(model.NormalizeProtocol(inbound.Protocol))

	var problems []string
	for _, is := range ValidateFinalmask(stream, protocol) {
		if is.Severity == finalmask.SeverityError {
			problems = append(problems, is.String())
			continue
		}
		logger.Infof("finalmask warning (inbound %q, protocol %s): %s", inbound.Tag, protocol, is.String())
	}
	if len(problems) > 0 {
		return common.NewError("invalid finalmask:", strings.Join(problems, "; "))
	}

	normalized := NormalizeFinalmask(stream, true)
	oldFM, hadOld := stream["finalmask"]
	newFM, hasNew := normalized["finalmask"]
	if hadOld == hasNew && reflect.DeepEqual(oldFM, newFM) {
		return nil
	}
	if hasNew {
		stream["finalmask"] = newFM
	} else {
		delete(stream, "finalmask")
	}
	body, err := json.MarshalIndent(stream, "", "  ")
	if err != nil {
		return nil
	}
	inbound.StreamSettings = string(body)
	logger.Debugf("finalmask normalized for inbound %q", inbound.Tag)
	return nil
}

// dropInvalidFinalmaskElements is the runtime safety net used when building the
// Xray config: entries stored before validation existed (or made invalid by a
// kernel update) are removed instead of failing the whole inbound.
func dropInvalidFinalmaskElements(stream map[string]any, protocol string) (map[string]any, int) {
	return finalmask.DropInvalidElements(stream, protocol)
}
