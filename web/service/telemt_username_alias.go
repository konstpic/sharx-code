package service

import (
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database"
	"github.com/konstpic/sharx-code/v2/database/model"
)

const telemtAliasTTL = 10 * time.Second

var (
	telemtAliasMu   sync.Mutex
	telemtAliasAt   time.Time
	telemtAliasByLC map[string]string
)

// buildTelemtAliasMap maps a substituted Telemt username ("u<id>") back to the client's real name.
// Only clients whose own name is not a valid Telemt username get an alias, and an alias that
// collides with another client's literal name is dropped so it can never misattribute traffic.
func buildTelemtAliasMap(clients []model.ClientEntity) map[string]string {
	literal := make(map[string]struct{}, len(clients))
	for _, c := range clients {
		literal[strings.ToLower(strings.TrimSpace(c.Name))] = struct{}{}
	}
	out := make(map[string]string)
	for _, c := range clients {
		name := strings.TrimSpace(c.Name)
		alias := TelemtUsernameForClient(c.Id, name)
		if alias == name {
			continue
		}
		key := strings.ToLower(alias)
		if _, clash := literal[key]; clash {
			continue
		}
		out[key] = name
	}
	return out
}

func telemtAliases() map[string]string {
	telemtAliasMu.Lock()
	defer telemtAliasMu.Unlock()
	if telemtAliasByLC != nil && time.Since(telemtAliasAt) < telemtAliasTTL {
		return telemtAliasByLC
	}
	db := database.GetDB()
	if db == nil {
		return telemtAliasByLC
	}
	var clients []model.ClientEntity
	if err := db.Select("id", "name").Find(&clients).Error; err != nil {
		return telemtAliasByLC
	}
	telemtAliasByLC = buildTelemtAliasMap(clients)
	telemtAliasAt = time.Now()
	return telemtAliasByLC
}

// RemapTelemtUsername turns the substituted Telemt username of a client whose name Telemt cannot
// use (spaces, non-ASCII) back into the client's name, so traffic and online status reported under
// "u<id>" are attributed to the right client. Other values are returned unchanged.
func RemapTelemtUsername(s string) string {
	if s == "" {
		return s
	}
	if name, ok := telemtAliases()[strings.ToLower(strings.TrimSpace(s))]; ok {
		return name
	}
	return s
}

// RemapTelemtClientTraffic rewrites substituted Telemt usernames in place.
func RemapTelemtClientTraffic(emails []string) {
	for i, e := range emails {
		emails[i] = RemapTelemtUsername(e)
	}
}
