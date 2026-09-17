package service

import (
	"github.com/konstpic/sharx-code/v2/util/common"
)

func clampGeofileAutoUpdateHours(n int) int {
	if n < 1 {
		return 1
	}
	if n > 168 {
		return 168
	}
	return n
}

func (s *SettingService) GetGeofileAutoUpdateEnable() (bool, error) {
	v, err := s.getBool("geofileAutoUpdateEnable")
	if err != nil {
		return false, err
	}
	return v, nil
}

func (s *SettingService) GetGeofileAutoUpdateIntervalHours() (int, error) {
	n, err := s.getInt("geofileAutoUpdateIntervalHours")
	if err != nil {
		return 24, err
	}
	return clampGeofileAutoUpdateHours(n), nil
}

func ValidateGeofileAutoUpdateIntervalHours(hours int) error {
	if hours < 1 || hours > 168 {
		return common.NewErrorf("geofileAutoUpdateIntervalHours must be between 1 and 168")
	}
	return nil
}

func clampGeofileRetentionCount(n int) int {
	if n < 1 {
		return 1
	}
	if n > 50 {
		return 50
	}
	return n
}

// GetGeofileRetentionCount returns how many revisions of each geofile type (geoip/geosite) to
// keep in the library; older, inactive revisions beyond this count are pruned automatically
// whenever a new one is added. The currently active revision is never pruned regardless of age.
func (s *SettingService) GetGeofileRetentionCount() (int, error) {
	n, err := s.getInt("geofileRetentionCount")
	if err != nil {
		return 5, err
	}
	if n == 0 {
		return 5, nil
	}
	return clampGeofileRetentionCount(n), nil
}

func ValidateGeofileRetentionCount(n int) error {
	if n != 0 && (n < 1 || n > 50) {
		return common.NewErrorf("geofileRetentionCount must be between 1 and 50")
	}
	return nil
}
