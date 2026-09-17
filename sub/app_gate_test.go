package sub

import "testing"

func TestEvaluateAppGate_disabledAlwaysAllows(t *testing.T) {
	d := EvaluateAppGate(UAUnknown, false, true, "incy")
	if d.Blocked {
		t.Fatalf("gate disabled should never block, got %+v", d)
	}
}

func TestEvaluateAppGate_blocksUnknownWhenRequired(t *testing.T) {
	d := EvaluateAppGate(UAUnknown, true, true, "")
	if !d.Blocked || d.Reason != AppGateReasonUnknownApp {
		t.Fatalf("expected unknown_app block, got %+v", d)
	}
}

func TestEvaluateAppGate_allowsUnknownWhenNotRequired(t *testing.T) {
	d := EvaluateAppGate(UAUnknown, true, false, "incy")
	if d.Blocked {
		t.Fatalf("requireKnownApp=false should allow unknown clients, got %+v", d)
	}
}

func TestEvaluateAppGate_blocksListedApp(t *testing.T) {
	d := EvaluateAppGate(UAINCY, true, false, "incy")
	if !d.Blocked || d.Reason != AppGateReasonBlockedApp {
		t.Fatalf("expected incy to be blocked, got %+v", d)
	}
}

func TestEvaluateAppGate_allowsUnlistedApp(t *testing.T) {
	d := EvaluateAppGate(UAHapp, true, true, "incy")
	if d.Blocked {
		t.Fatalf("happ is not in the blocked list and is a known app, expected allow, got %+v", d)
	}
}

func TestEvaluateAppGate_blockedListIsCaseAndSpaceInsensitive(t *testing.T) {
	d := EvaluateAppGate(UAINCY, true, false, "  INCY , v2rayng ")
	if !d.Blocked {
		t.Fatalf("expected case/space-insensitive match to block incy, got %+v", d)
	}
}

func TestEvaluateAppGate_emptyBlockedListBlocksNothing(t *testing.T) {
	d := EvaluateAppGate(UAINCY, true, false, "")
	if d.Blocked {
		t.Fatalf("empty blocked list should not block anything, got %+v", d)
	}
}

func TestUAClientKey_knownAndUnknownValues(t *testing.T) {
	if UAHapp.Key() != "happ" {
		t.Fatalf("expected happ key, got %q", UAHapp.Key())
	}
	if UAINCY.Key() != "incy" {
		t.Fatalf("expected incy key, got %q", UAINCY.Key())
	}
	var bogus UAClient = 999
	if bogus.Key() != "unknown" {
		t.Fatalf("expected unrecognized UAClient value to fall back to 'unknown', got %q", bogus.Key())
	}
}
