package service

import (
	"strings"

	"github.com/konstpic/sharx-code/v2/util/common"
)

const (
	IPLimitEnforcementDrop          = "drop"
	IPLimitEnforcementBlock         = "block"
	IPLimitEnforcementDropAndBlock  = "drop_and_block"
	IPLimitExcessPolicyNewest       = "newest"
	IPLimitExcessPolicyOldest       = "oldest"
)

func clampIPLimitCheckSec(n int) int {
	if n < 5 {
		return 5
	}
	if n > 600 {
		return 600
	}
	return n
}

func clampIPLimitBanSec(n int) int {
	if n < 0 {
		return 0
	}
	if n > 86400*30 {
		return 86400 * 30
	}
	return n
}

func clampIPLimitRecencyWindowSec(n int) int {
	if n < 10 {
		return 10
	}
	if n > 86400 {
		return 86400
	}
	return n
}

// GetIPLimitRecencyWindowSec returns how many seconds back a session IP must have been last seen
// to still count as "online" for limit purposes. Xray's user-online IP map (GetStatsOnlineIpList
// with reset=false) has no TTL: it accumulates every IP ever seen since the last stats reset, so
// without this filter a client whose carrier rotates IPs (mobile CGNAT) eventually exceeds
// max_ips even with a single real device connected, since old IPs never leave the map on their
// own. 0 = use default (600s / 10min).
func (s *SettingService) GetIPLimitRecencyWindowSec() (int, error) {
	n, err := s.getInt("ipLimitRecencyWindowSec")
	if err != nil {
		return 600, err
	}
	if n == 0 {
		return 600, nil
	}
	return clampIPLimitRecencyWindowSec(n), nil
}

func (s *SettingService) GetIPLimitGlobalEnable() (bool, error) {
	v, err := s.getBool("ipLimitGlobalEnable")
	if err != nil {
		return true, err
	}
	return v, nil
}

func (s *SettingService) GetIPLimitCheckIntervalSec() (int, error) {
	n, err := s.getInt("ipLimitCheckIntervalSec")
	if err != nil {
		return 30, err
	}
	return clampIPLimitCheckSec(n), nil
}

func (s *SettingService) GetIPLimitBanDurationSec() (int, error) {
	n, err := s.getInt("ipLimitBanDurationSec")
	if err != nil {
		return 3600, err
	}
	return clampIPLimitBanSec(n), nil
}

func (s *SettingService) GetIPLimitEnforcement() (string, error) {
	mode, err := s.getString("ipLimitEnforcement")
	if err != nil {
		return IPLimitEnforcementDropAndBlock, err
	}
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case IPLimitEnforcementDrop, IPLimitEnforcementBlock, IPLimitEnforcementDropAndBlock:
		return strings.ToLower(strings.TrimSpace(mode)), nil
	default:
		return IPLimitEnforcementDropAndBlock, nil
	}
}

func (s *SettingService) GetIPLimitExcessPolicy() (string, error) {
	p, err := s.getString("ipLimitExcessPolicy")
	if err != nil {
		return IPLimitExcessPolicyNewest, err
	}
	switch strings.ToLower(strings.TrimSpace(p)) {
	case IPLimitExcessPolicyNewest, IPLimitExcessPolicyOldest:
		return strings.ToLower(strings.TrimSpace(p)), nil
	default:
		return IPLimitExcessPolicyNewest, nil
	}
}

// ValidateIPLimitSettings checks panel IP limit settings from AllSetting-like values.
func ValidateIPLimitSettings(checkSec, banSec int, enforcement, excessPolicy string) error {
	if checkSec != 0 && (checkSec < 5 || checkSec > 600) {
		return common.NewErrorf("ipLimitCheckIntervalSec must be between 5 and 600 seconds")
	}
	if banSec < 0 || banSec > 86400*30 {
		return common.NewErrorf("ipLimitBanDurationSec must be between 0 and 2592000 (30 days); 0 = permanent block")
	}
	switch strings.ToLower(strings.TrimSpace(enforcement)) {
	case "", IPLimitEnforcementDrop, IPLimitEnforcementBlock, IPLimitEnforcementDropAndBlock:
	default:
		return common.NewErrorf("invalid ipLimitEnforcement: %s", enforcement)
	}
	switch strings.ToLower(strings.TrimSpace(excessPolicy)) {
	case "", IPLimitExcessPolicyNewest, IPLimitExcessPolicyOldest:
	default:
		return common.NewErrorf("invalid ipLimitExcessPolicy: %s", excessPolicy)
	}
	return nil
}
