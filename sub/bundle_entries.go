package sub

import (
	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
)

// addressPortFromHost turns a bundle host into the address row the link generators consume. The mapping is exactly the
// inverse of how the old assembly produced its rows (node entries, the Host entry, balancer entries, the panel address),
// which is what makes a converted subscription identical to the old one.
func (s *SubService) addressPortFromHost(h *model.Host, inbound *model.Inbound) (AddressPort, bool) {
	switch h.Kind {
	case model.HostKindPlacement:
		ap := AddressPort{
			Address:           h.Address,
			RemarkSuffix:      h.RemarkSuffix,
			ServerDescription: h.ServerDescription,
			RemarkNodeName:    h.Name,
			RemarkDisplayHost: h.Address,
			Src:               AddrSource{Kind: model.HostKindPlacement},
			// Host-level TLS/stream overrides (fp, sni, alpn...) must apply to node/pool hosts too.
			ApplyHostSubscriptionOverrides: true,
			OverrideHost:                   h,
		}
		if h.Port > 0 {
			ap.Port = h.Port
		}
		if h.NodeId != nil {
			ap.Src.NodeId = *h.NodeId
		}
		return ap, true
	case model.HostKindPool:
		ap := AddressPort{
			Address:           h.Address,
			RemarkSuffix:      h.RemarkSuffix,
			ServerDescription: h.ServerDescription,
			RemarkNodeName:    h.Name,
			RemarkDisplayHost: h.Address,
			Src:               AddrSource{Kind: model.HostKindPool},
			// Host-level TLS/stream overrides (fp, sni, alpn...) must apply to node/pool hosts too.
			ApplyHostSubscriptionOverrides: true,
			OverrideHost:                   h,
		}
		if h.Port > 0 {
			ap.Port = h.Port
		}
		if h.PoolId != nil {
			ap.Src.PoolId = *h.PoolId
		}
		return ap, true
	case model.HostKindLocal:
		if d := s.defaultAddressPorts(inbound); len(d) > 0 {
			return d[0], true
		}
		return AddressPort{}, false
	default: // address hosts (custom domain, CDN, converted pre-bundle Hosts)
		ap := hostAddressPort(h)
		ap.OverrideHost = h
		// The host form offers both fields; they are empty on converted hosts, so converted subscriptions do not change.
		ap.RemarkSuffix = h.RemarkSuffix
		ap.ServerDescription = h.ServerDescription
		return ap, true
	}
}

// addressesFromBundleHosts builds the rows for an inbound from the hosts the client's bundles deliver it with. The returned
// host is the first address host: the inbound-wide override host the generators expect (external proxies, Hysteria).
func (s *SubService) addressesFromBundleHosts(inbound *model.Inbound) ([]AddressPort, *model.Host) {
	out := make([]AddressPort, 0, len(inbound.SubHosts))
	var subHost *model.Host
	for i := range inbound.SubHosts {
		h := &inbound.SubHosts[i]
		ap, ok := s.addressPortFromHost(h, inbound)
		if !ok {
			continue
		}
		out = append(out, ap)
		if ap.OverrideHost != nil && subHost == nil {
			subHost = h
		}
	}
	return out, subHost
}

// attachBundleHosts sets the hosts that deliver each inbound to this client. Consumer network inbounds always use
// their explicit bundle plan; other inbounds keep the legacy assembly until the global bundle scheme is enabled.
func (s *SubService) attachBundleHosts(client *model.ClientEntity, inbounds []*model.Inbound) {
	if client == nil {
		return
	}
	bundlesActive := s.forceBundles || s.bundleService.BundlesActive()
	needsNetworkPlan := false
	for _, in := range inbounds {
		if in != nil && in.SnNetwork && in.SnNetworkRole == "consumer" {
			needsNetworkPlan = true
			break
		}
	}
	if !bundlesActive && !needsNetworkPlan {
		return
	}
	plan, err := s.bundleService.SubscriptionHosts(client.Id)
	if err != nil {
		logger.Warningf("bundles: cannot build the subscription plan for client %d: %v", client.Id, err)
		return
	}
	for _, in := range inbounds {
		if in == nil || (!bundlesActive && !(in.SnNetwork && in.SnNetworkRole == "consumer")) {
			continue
		}
		in.SubHosts = plan[in.Id]
		in.SubHostsSet = true
	}
}

// dropInboundsWithoutHosts removes inbounds that the bundle scheme grants but does not deliver (all hosts hidden or disabled).
func dropInboundsWithoutHosts(inbounds []*model.Inbound) []*model.Inbound {
	out := inbounds[:0:0]
	for _, in := range inbounds {
		if in.SubHostsSet && len(in.SubHosts) == 0 {
			continue
		}
		out = append(out, in)
	}
	return out
}
