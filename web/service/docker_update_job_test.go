package service

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
)

type fakeNode struct {
	id        int
	name      string
	colocated bool
	oldV      string
	newV      string
	// mode: "normal" restarts into newV; "uptodate" never restarts; "hardfail" is rejected by the updater.
	mode string
	// killsPanel: triggering this node also recreates the panel (shared Watchtower).
	killsPanel  bool
	triggeredAt time.Time
}

type fakeEnv struct {
	mu           sync.Mutex
	now          time.Time
	nodes        []*fakeNode
	panelV       string
	panelNewV    string
	saved        string
	triggerOrder []string
	dead         bool
	panelKilled  bool
	panelMode    string // "restart" (default): panel restarts into panelNewV; "uptodate": trigger returns cleanly
}

func newFakeEnv(nodes ...*fakeNode) *fakeEnv {
	return &fakeEnv{now: time.Unix(1_800_000_000, 0), nodes: nodes, panelV: "1.7.22", panelNewV: "1.7.25"}
}

func (e *fakeEnv) node(id int) *fakeNode {
	for _, n := range e.nodes {
		if n.id == id {
			return n
		}
	}
	return nil
}

func (e *fakeEnv) ListNodes() ([]*model.Node, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []*model.Node
	for _, n := range e.nodes {
		out = append(out, &model.Node{Id: n.id, Name: n.name, Enable: true, WorkerVersion: n.oldV})
	}
	return out, nil
}
func (e *fakeEnv) MultiNode() bool { return true }
func (e *fakeEnv) IsColocated(n *model.Node) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.node(n.Id).colocated
}

func (e *fakeEnv) TriggerNode(ctx context.Context, n *model.Node) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.dead {
		return errors.New("process killed")
	}
	fn := e.node(n.Id)
	fn.triggeredAt = e.now
	e.triggerOrder = append(e.triggerOrder, fn.name)
	if fn.killsPanel {
		e.panelV = e.panelNewV
		e.panelKilled = true
		e.dead = true
	}
	switch fn.mode {
	case "hardfail":
		return errors.New("updater: lookup watchtower: no such host")
	case "uptodate":
		return nil
	default:
		// The node restarts under the request, so the panel sees the connection drop.
		return &transientTriggerError{err: errors.New("EOF")}
	}
}

func (e *fakeEnv) ProbeNode(ctx context.Context, n *model.Node) (dockerNodeProbe, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.dead {
		return dockerNodeProbe{}, errors.New("process killed")
	}
	fn := e.node(n.Id)
	if fn.triggeredAt.IsZero() || fn.mode != "normal" {
		return dockerNodeProbe{Online: true, Version: fn.oldV}, nil
	}
	dt := e.now.Sub(fn.triggeredAt)
	switch {
	case dt < 3*time.Second:
		return dockerNodeProbe{Online: true, Version: fn.oldV}, nil
	case dt < 15*time.Second:
		return dockerNodeProbe{}, errors.New("connection refused")
	default:
		return dockerNodeProbe{Online: true, Version: fn.newV}, nil
	}
}

func (e *fakeEnv) PanelVersion() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.panelV
}

func (e *fakeEnv) TriggerPanel(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.dead {
		return errors.New("process killed")
	}
	e.triggerOrder = append(e.triggerOrder, "PANEL")
	if e.panelMode == "uptodate" {
		return nil
	}
	e.panelV = e.panelNewV
	e.dead = true // Watchtower recreates the container we are running in
	e.panelKilled = true
	return errors.New("EOF")
}

func (e *fakeEnv) PrepWorkers() error   { return nil }
func (e *fakeEnv) FinishWorkers() error { return nil }

func (e *fakeEnv) Load() (*DockerUpdateJob, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.saved == "" {
		return nil, nil
	}
	var j DockerUpdateJob
	if err := json.Unmarshal([]byte(e.saved), &j); err != nil {
		return nil, err
	}
	return &j, nil
}

func (e *fakeEnv) Save(j *DockerUpdateJob) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.dead {
		return nil // a killed process cannot persist anything
	}
	v, err := marshalJob(j)
	e.saved = v
	return err
}

func (e *fakeEnv) Now() time.Time {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.now
}

func (e *fakeEnv) Sleep(ctx context.Context, d time.Duration) error {
	e.mu.Lock()
	if e.dead {
		e.mu.Unlock()
		return errors.New("process killed")
	}
	e.now = e.now.Add(d)
	e.mu.Unlock()
	runtime.Gosched()
	return nil
}

// revive simulates the new panel process after the container was recreated.
func (e *fakeEnv) revive() {
	e.mu.Lock()
	e.dead = false
	e.mu.Unlock()
}

func testTiming() dockerUpdateTiming {
	return dockerUpdateTiming{
		Poll:         2 * time.Second,
		Settle:       20 * time.Second,
		NodeTimeout:  5 * time.Minute,
		PanelSettle:  30 * time.Second,
		ResumeSettle: 30 * time.Second,
		ResumeWindow: 20 * time.Minute,
	}
}

func waitJob(t *testing.T, r *dockerUpdateRunner) *DockerUpdateJob {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		j := r.Snapshot()
		if j != nil && j.State != DockerUpdateJobRunning {
			return j
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("job did not finish: %+v", r.Snapshot())
	return nil
}

func nodeByName(j *DockerUpdateJob, name string) DockerUpdateJobNode {
	for _, n := range j.Nodes {
		if n.Name == name {
			return n
		}
	}
	return DockerUpdateJobNode{}
}

func TestDockerUpdateJob_remoteFirstThenLocalThenPanel(t *testing.T) {
	env := newFakeEnv(
		&fakeNode{id: 1, name: "local", colocated: true, oldV: "1.7.22", newV: "1.7.25", mode: "normal"},
		&fakeNode{id: 2, name: "remoteA", oldV: "1.7.22", newV: "1.7.25", mode: "normal"},
		&fakeNode{id: 3, name: "remoteB", oldV: "1.7.22", newV: "1.7.25", mode: "normal"},
	)
	r := newDockerUpdateRunner(env, testTiming())
	if _, err := r.Start(); err != nil {
		t.Fatal(err)
	}
	j := waitJob(t, r)

	order := strings.Join(env.triggerOrder, ",")
	if !strings.HasSuffix(order, "local,PANEL") {
		t.Fatalf("co-located node and panel must go last, got %s", order)
	}
	for _, n := range j.Nodes {
		if n.Status != DockerUpdateStepUpdated || n.VersionAfter != "1.7.25" {
			t.Fatalf("%s: %+v", n.Name, n)
		}
	}
	if j.State != DockerUpdateJobDone || j.Panel.Status != DockerUpdateStepUpdated {
		t.Fatalf("job = %+v", j)
	}
}

func TestDockerUpdateJob_droppedConnectionIsNotAnError(t *testing.T) {
	// The updater's HTTP call dies with the node it is updating — that must count as success.
	env := newFakeEnv(&fakeNode{id: 1, name: "n1", oldV: "1.7.22", newV: "1.7.25", mode: "normal"})
	r := newDockerUpdateRunner(env, testTiming())
	_, _ = r.Start()
	j := waitJob(t, r)
	if n := nodeByName(j, "n1"); n.Status != DockerUpdateStepUpdated || n.Message != "" {
		t.Fatalf("n1 = %+v", n)
	}
}

func TestDockerUpdateJob_alreadyLatestNodeIsUpToDateNotFailed(t *testing.T) {
	env := newFakeEnv(
		&fakeNode{id: 1, name: "moved", oldV: "1.7.22", newV: "1.7.25", mode: "normal"},
		&fakeNode{id: 2, name: "current", oldV: "1.7.25", newV: "1.7.25", mode: "uptodate"},
	)
	r := newDockerUpdateRunner(env, testTiming())
	_, _ = r.Start()
	j := waitJob(t, r)
	if n := nodeByName(j, "current"); n.Status != DockerUpdateStepUpToDate {
		t.Fatalf("current = %+v", n)
	}
	if j.State != DockerUpdateJobDone {
		t.Fatalf("state = %s", j.State)
	}
}

func TestDockerUpdateJob_nodeLeftBehindIsFlagged(t *testing.T) {
	env := newFakeEnv(
		&fakeNode{id: 1, name: "ok", oldV: "1.7.22", newV: "1.7.25", mode: "normal"},
		&fakeNode{id: 2, name: "stuck", oldV: "1.7.22", newV: "1.7.25", mode: "uptodate"},
	)
	r := newDockerUpdateRunner(env, testTiming())
	_, _ = r.Start()
	j := waitJob(t, r)
	n := nodeByName(j, "stuck")
	if n.Status != DockerUpdateStepError || !strings.Contains(n.Message, "1.7.25") {
		t.Fatalf("stuck = %+v", n)
	}
	if j.State != DockerUpdateJobFailed {
		t.Fatalf("state = %s", j.State)
	}
	if nodeByName(j, "ok").Status != DockerUpdateStepUpdated {
		t.Fatalf("healthy node must not be affected: %+v", nodeByName(j, "ok"))
	}
}

func TestDockerUpdateJob_updaterRejectionFailsOnlyThatNode(t *testing.T) {
	env := newFakeEnv(
		&fakeNode{id: 1, name: "bad", oldV: "1.7.22", newV: "1.7.25", mode: "hardfail"},
		&fakeNode{id: 2, name: "good", oldV: "1.7.22", newV: "1.7.25", mode: "normal"},
	)
	r := newDockerUpdateRunner(env, testTiming())
	_, _ = r.Start()
	j := waitJob(t, r)
	if n := nodeByName(j, "bad"); n.Status != DockerUpdateStepError || !strings.Contains(n.Message, "watchtower") {
		t.Fatalf("bad = %+v", n)
	}
	if nodeByName(j, "good").Status != DockerUpdateStepUpdated {
		t.Fatalf("good = %+v", nodeByName(j, "good"))
	}
}

// The reported bug: a node on the panel's own host shares its Watchtower, so triggering it
// recreates the panel too. The new panel process must finish the job with correct results.
func TestDockerUpdateJob_resumesAfterPanelIsRecreatedBySharedWatchtower(t *testing.T) {
	env := newFakeEnv(
		&fakeNode{id: 1, name: "local", colocated: true, killsPanel: true, oldV: "1.7.22", newV: "1.7.25", mode: "normal"},
		&fakeNode{id: 2, name: "remote", oldV: "1.7.22", newV: "1.7.25", mode: "normal"},
	)
	first := newDockerUpdateRunner(env, testTiming())
	if _, err := first.Start(); err != nil {
		t.Fatal(err)
	}
	// Wait until the "process" is killed by the shared Watchtower.
	deadline := time.Now().Add(5 * time.Second)
	for {
		env.mu.Lock()
		killed := env.panelKilled
		env.mu.Unlock()
		if killed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("panel was never killed")
		}
		time.Sleep(2 * time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond) // let the dead runner's goroutines unwind

	// New process: same database, new version.
	env.revive()
	env.mu.Lock()
	env.now = env.now.Add(40 * time.Second)
	env.node(1).newV = "1.7.25"
	env.node(1).mode = "normal"
	env.mu.Unlock()

	second := newDockerUpdateRunner(env, testTiming())
	second.Resume()
	j := waitJob(t, second)

	if j.State != DockerUpdateJobDone {
		t.Fatalf("state = %s: %+v", j.State, j)
	}
	if n := nodeByName(j, "remote"); n.Status != DockerUpdateStepUpdated {
		t.Fatalf("remote = %+v", n)
	}
	if n := nodeByName(j, "local"); n.Status != DockerUpdateStepUpdated || n.VersionAfter != "1.7.25" {
		t.Fatalf("local = %+v", n)
	}
	if j.Panel.Status != DockerUpdateStepUpdated || j.Panel.VersionAfter != "1.7.25" {
		t.Fatalf("panel = %+v", j.Panel)
	}
}

func TestDockerUpdateJob_panelRestartAfterItsOwnTriggerIsSuccess(t *testing.T) {
	env := newFakeEnv(&fakeNode{id: 1, name: "n", oldV: "1.7.22", newV: "1.7.25", mode: "normal"})
	first := newDockerUpdateRunner(env, testTiming())
	_, _ = first.Start()
	deadline := time.Now().Add(5 * time.Second)
	for {
		env.mu.Lock()
		killed := env.panelKilled
		env.mu.Unlock()
		if killed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("panel never triggered")
		}
		time.Sleep(2 * time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	env.revive()

	second := newDockerUpdateRunner(env, testTiming())
	second.Resume()
	j := waitJob(t, second)
	if j.State != DockerUpdateJobDone || j.Panel.Status != DockerUpdateStepUpdated || j.Panel.VersionAfter != "1.7.25" {
		t.Fatalf("job = %+v", j)
	}
}

func TestDockerUpdateJob_panelAlreadyCurrentIsUpToDate(t *testing.T) {
	env := newFakeEnv(&fakeNode{id: 1, name: "n", oldV: "1.7.25", newV: "1.7.25", mode: "uptodate"})
	env.panelMode = "uptodate"
	env.panelV = "1.7.25"
	r := newDockerUpdateRunner(env, testTiming())
	_, _ = r.Start()
	j := waitJob(t, r)
	if j.Panel.Status != DockerUpdateStepUpToDate || j.State != DockerUpdateJobDone {
		t.Fatalf("job = %+v", j)
	}
}

func TestDockerUpdateJob_staleRunningJobIsAbandonedNotResumed(t *testing.T) {
	env := newFakeEnv(&fakeNode{id: 1, name: "n", oldV: "1.7.22", newV: "1.7.25", mode: "normal"})
	stale := &DockerUpdateJob{ID: "x", State: DockerUpdateJobRunning, Phase: "workers", UpdatedAt: env.now.Add(-time.Hour).UnixMilli(),
		Panel: DockerUpdateJobPanel{Status: DockerUpdateStepPending}, Nodes: []DockerUpdateJobNode{{ID: 1, Name: "n", Enable: true, Status: DockerUpdateStepRestarting, TriggeredAt: 1}}}
	_ = env.Save(stale)
	r := newDockerUpdateRunner(env, testTiming())
	r.Resume()
	got := r.Snapshot()
	if got.State != DockerUpdateJobFailed || got.Phase != "abandoned" {
		t.Fatalf("job = %+v", got)
	}
	if len(env.triggerOrder) != 0 {
		t.Fatalf("an abandoned job must not trigger anything: %v", env.triggerOrder)
	}
}

func TestDockerUpdateJob_startWhileRunningReturnsSameJob(t *testing.T) {
	env := newFakeEnv(&fakeNode{id: 1, name: "n", oldV: "1.7.22", newV: "1.7.25", mode: "normal"})
	r := newDockerUpdateRunner(env, testTiming())
	a, _ := r.Start()
	b, _ := r.Start()
	if a.ID != b.ID {
		t.Fatalf("a second Start during a run must not create a new job: %s vs %s", a.ID, b.ID)
	}
	waitJob(t, r)
}

func TestIsLocalHost(t *testing.T) {
	local := []net.IP{net.ParseIP("62.60.151.147"), net.ParseIP("10.0.0.5")}
	lookup := func(h string) ([]string, error) {
		if h == "vipfree.win" {
			return []string{"62.60.151.147"}, nil
		}
		return []string{"88.209.248.7"}, nil
	}
	cases := []struct {
		host string
		want bool
	}{
		{"62.60.151.147", true},
		{"127.0.0.1", true},
		{"localhost", true},
		{"[::1]", true},
		{"vipfree.win", true},
		{"88.209.248.7", false},
		{"other.example", false},
		{"", false},
	}
	for _, c := range cases {
		if got := isLocalHost(c.host, local, lookup); got != c.want {
			t.Errorf("isLocalHost(%q) = %v, want %v", c.host, got, c.want)
		}
	}
}

func TestVersionLess(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"1.7.22", "1.7.25", true},
		{"1.7.25", "1.7.22", false},
		{"1.7.25", "1.7.25", false},
		{"", "1.0.0", true},
		{"1.7.9", "1.7.10", true},
		{"v1.8.0", "1.7.99", false},
		{"1.7.25-rc1", "1.7.25", false},
	}
	for _, c := range cases {
		if got := versionLess(c.a, c.b); got != c.want {
			t.Errorf("versionLess(%q,%q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}
