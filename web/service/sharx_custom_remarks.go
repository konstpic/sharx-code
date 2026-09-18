package service

// DefaultSharxCustomRemarks returns built-in default texts for placeholder subscription lines.
func DefaultSharxCustomRemarks() SharxSubpageCustomRemarks {
	return SharxSubpageCustomRemarks{
		ExpiredUsers:           []string{"⌛ Subscription expired", "Contact support"},
		LimitedUsers:           []string{"🚧 Subscription limited", "Contact support"},
		DisabledUsers:          []string{"🚫 Subscription disabled", "Contact support"},
		EmptyHosts:             []string{"→ SharX", "→ No hosts found", "→ Check inbounds & clients"},
		HWIDMaxDevicesExceeded: []string{"Limit of devices reached"},
		HWIDNotSupported:       []string{"Device ID (HWID) required", "Enable HWID in your app"},
		BlockedApp:             []string{"This app is not allowed", "Use another supported app"},
		UnknownApp:             []string{"Unrecognized app", "Use a supported client app"},
	}
}

// MergeCustomRemarksWithDefaults overlays non-empty slices from cfg onto defaults.
func MergeCustomRemarksWithDefaults(cfg *SharxSubpageCustomRemarks) SharxSubpageCustomRemarks {
	out := DefaultSharxCustomRemarks()
	if cfg == nil {
		return out
	}
	if len(cfg.ExpiredUsers) > 0 {
		out.ExpiredUsers = cfg.ExpiredUsers
	}
	if len(cfg.LimitedUsers) > 0 {
		out.LimitedUsers = cfg.LimitedUsers
	}
	if len(cfg.DisabledUsers) > 0 {
		out.DisabledUsers = cfg.DisabledUsers
	}
	if len(cfg.EmptyHosts) > 0 {
		out.EmptyHosts = cfg.EmptyHosts
	}
	if len(cfg.HWIDMaxDevicesExceeded) > 0 {
		out.HWIDMaxDevicesExceeded = cfg.HWIDMaxDevicesExceeded
	}
	if len(cfg.HWIDNotSupported) > 0 {
		out.HWIDNotSupported = cfg.HWIDNotSupported
	}
	if len(cfg.BlockedApp) > 0 {
		out.BlockedApp = cfg.BlockedApp
	}
	if len(cfg.UnknownApp) > 0 {
		out.UnknownApp = cfg.UnknownApp
	}
	return out
}

// ShowCustomRemarksEnabled reports whether status/HWID placeholder output is allowed.
// Nil pointer means enabled (backward compatible default).
func ShowCustomRemarksEnabled(cfg *SharxSubpageConfigV2) bool {
	if cfg == nil || cfg.ShowCustomRemarks == nil {
		return true
	}
	return *cfg.ShowCustomRemarks
}

// EffectiveCustomRemarks returns merged remark lines for subscription generation.
func EffectiveCustomRemarks(cfg *SharxSubpageConfigV2) SharxSubpageCustomRemarks {
	return MergeCustomRemarksWithDefaults(nilIfEmpty(cfg))
}

func nilIfEmpty(cfg *SharxSubpageConfigV2) *SharxSubpageCustomRemarks {
	if cfg == nil {
		return nil
	}
	return cfg.CustomRemarks
}
