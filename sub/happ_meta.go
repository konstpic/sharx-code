package sub

import (
	"strings"

	service "github.com/konstpic/sharx-code/v2/web/service"
)

// happBodyMetaComment formats a Happ subscription body meta line.
// Most keys use "#key: value"; providerid uses "#providerid {id}" per Happ docs.
func happBodyMetaComment(headerKey, value string) string {
	return service.SubscriptionBodyMetaLine(headerKey, value)
}

// prependSubscriptionBodyMetaComments prepends Happ body meta comments for configured
// response rules (canonical fields, routing, and extra parameters).
func prependSubscriptionBodyMetaComments(
	result string,
	client UAClient,
	cfg *service.SharxSubpageConfigV2,
	clientAnnounce string,
) string {
	if client != UAHapp {
		return result
	}
	var prefix strings.Builder

	if cfg != nil && cfg.ResponseRules != nil {
		rr := cfg.ResponseRules

		if service.ResponseHeaderDeliversBody(rr.ProfileTitleDelivery) {
			if v := service.ProfileTitleBodyValue(rr.ProfileTitle); v != "" {
				prefix.WriteString(service.SubscriptionBodyMetaLine("profile-title", v))
			}
		}
		prefix.WriteString(service.ProfileUpdateIntervalBodyLine(rr))

		if service.ResponseHeaderDeliversBody(rr.AnnounceDelivery) {
			if v := service.AnnounceBodyValue(service.EffectiveAnnounce(clientAnnounce, rr.Announce)); v != "" {
				prefix.WriteString(service.SubscriptionBodyMetaLine("announce", v))
			}
		}
		if service.ResponseHeaderDeliversBody(rr.SupportURLDelivery) {
			if v := strings.TrimSpace(rr.SupportURL); v != "" {
				prefix.WriteString(service.SubscriptionBodyMetaLine("support-url", v))
			}
		}
		if service.ResponseHeaderDeliversBody(rr.ProfileWebPageURLDelivery) {
			if v := strings.TrimSpace(rr.ProfileWebPageURL); v != "" {
				prefix.WriteString(service.SubscriptionBodyMetaLine("profile-web-page-url", v))
			}
		}

		for _, h := range rr.ExtraHeaders {
			if !service.ResponseHeaderDeliversBody(h.Delivery) {
				continue
			}
			prefix.WriteString(happBodyMetaComment(h.Key, h.Value))
		}
	}

	if cfg != nil && cfg.Routing != nil && service.ResponseHeaderDeliversBody(cfg.Routing.Delivery) {
		if _, ok := service.RoutingHeaderValueForSubscription(cfg); ok {
			prefix.WriteString(service.SubscriptionBodyMetaLine("routing-enable", "1"))
		}
	}

	if prefix.Len() == 0 {
		return result
	}
	return prefix.String() + result
}
