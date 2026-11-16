package service

import (
	"html"
	"sync"

	"github.com/konstpic/sharx-code/v2/database/model"
)

type nodeCoreAlertKey struct {
	nodeID int
	core   string
}

type nodeCoreAlertState struct {
	failures  int
	successes int
	alerted   bool
}

type nodeCoreAlertTracker struct {
	mu     sync.Mutex
	states map[nodeCoreAlertKey]*nodeCoreAlertState
}

var nodeCoreAlerts = nodeCoreAlertTracker{states: make(map[nodeCoreAlertKey]*nodeCoreAlertState)}

func (t *nodeCoreAlertTracker) resetNode(id int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for key := range t.states {
		if key.nodeID == id {
			delete(t.states, key)
		}
	}
}

// An unreachable worker is not evidence of a core crash. Keep the incident
// open but require fresh consecutive observations after the worker returns.
func (t *nodeCoreAlertTracker) suspendNode(id int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for key, state := range t.states {
		if key.nodeID == id {
			state.failures, state.successes = 0, 0
		}
	}
}

func (t *nodeCoreAlertTracker) observe(key nodeCoreAlertKey, expected bool, status string) (down, recovered bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !expected {
		delete(t.states, key)
		return
	}
	if t.states == nil {
		t.states = make(map[nodeCoreAlertKey]*nodeCoreAlertState)
	}
	h := t.states[key]
	if h == nil {
		h = &nodeCoreAlertState{}
		t.states[key] = h
	}
	switch status {
	case "stopped", "error":
		h.successes = 0
		if h.failures < 2 {
			h.failures++
		}
		if h.failures >= 2 && !h.alerted {
			h.alerted = true
			down = true
		}
	case "running":
		h.failures = 0
		if h.alerted {
			h.successes++
			if h.successes >= 2 {
				h.alerted = false
				h.successes = 0
				recovered = true
			}
		}
	default:
		h.failures, h.successes = 0, 0
	}
	return
}

func expectedNodeCores(inbounds []*model.Inbound) map[string]bool {
	expected := map[string]bool{}
	for _, ib := range inbounds {
		if ib == nil || !ib.Enable {
			continue
		}
		switch model.NormalizeProtocol(ib.Protocol) {
		case model.Telemt:
			expected["Telemt"] = true
		case model.AmneziaWG:
			expected["AmneziaWG"] = true
		default:
			expected["Xray"] = true
		}
	}
	return expected
}

// This is opt-in and shares the existing Telegram administrator recipients.
// No inbound or core setting is changed by monitoring.
func (s *NodeService) maybeNotifyNodeCoreHealth(node *model.Node) {
	if node == nil {
		return
	}
	settings := SettingService{}
	enabled, err := settings.GetTgBotNodeCoreNotify()
	bot := Tgbot{}
	if err != nil || !enabled || !bot.IsRunning() || !node.Enable {
		nodeCoreAlerts.resetNode(node.Id)
		return
	}
	if node.Status != "online" {
		nodeCoreAlerts.suspendNode(node.Id)
		return
	}
	inbounds, err := s.GetInboundsForNode(node.Id)
	if err != nil {
		nodeCoreAlerts.suspendNode(node.Id)
		return
	}
	expected := expectedNodeCores(inbounds)
	for _, core := range []struct{ name, status string }{
		{"Xray", node.XrayState}, {"Telemt", node.TelemtState}, {"AmneziaWG", node.AmneziaWgState},
	} {
		down, recovered := nodeCoreAlerts.observe(nodeCoreAlertKey{node.Id, core.name}, expected[core.name], core.status)
		key := ""
		if down {
			key = "tgbot.messages.nodeCoreDown"
		}
		if recovered {
			key = "tgbot.messages.nodeCoreRecovered"
		}
		if key != "" {
			bot.SendMsgToTgbotAdmins(bot.I18nBot(key, "Name=="+html.EscapeString(node.Name), "Core=="+core.name))
		}
	}
}
