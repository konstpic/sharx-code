package service

// GetSubAppGateEnable reports whether the subscription client-app gate is active.
func (s *SettingService) GetSubAppGateEnable() (bool, error) {
	v, err := s.getBool("subAppGateEnable")
	if err != nil {
		return false, err
	}
	return v, nil
}

// GetSubAppGateRequireKnownApp reports whether an unrecognized (UAUnknown) client is blocked.
func (s *SettingService) GetSubAppGateRequireKnownApp() (bool, error) {
	v, err := s.getBool("subAppGateRequireKnownApp")
	if err != nil {
		return false, err
	}
	return v, nil
}

// GetSubAppGateBlockedApps returns the raw comma-separated blocked app keys (see sub.UAClient.Key()).
func (s *SettingService) GetSubAppGateBlockedApps() (string, error) {
	v, err := s.getString("subAppGateBlockedApps")
	if err != nil {
		return "", err
	}
	return v, nil
}

// GetSubAppGateAllowedApps returns the raw comma-separated allowlist of app keys; empty = no allowlist.
func (s *SettingService) GetSubAppGateAllowedApps() (string, error) {
	v, err := s.getString("subAppGateAllowedApps")
	if err != nil {
		return "", err
	}
	return v, nil
}
