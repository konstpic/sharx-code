package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/konstpic/sharx-code/v2/database/model"
	"github.com/konstpic/sharx-code/v2/logger"
)

// The Docker update is a server-side job instead of a browser-driven sequence, because the panel
// is routinely restarted in the middle of it: a node that shares the panel's Watchtower makes
// Watchtower recreate the panel as well. A job that lives on the server, is persisted after every
// change and is resumed on startup survives that; the UI only polls it. Whether a step worked is
// decided from facts (version changed / node restarted), never from a broken HTTP connection.

const (
	DockerUpdateJobRunning = "running"
	DockerUpdateJobDone    = "done"
	DockerUpdateJobFailed  = "failed"

	DockerUpdateStepPending    = "pending"
	DockerUpdateStepTriggering = "triggering"
	DockerUpdateStepRestarting = "restarting"
	DockerUpdateStepUpdated    = "updated"
	DockerUpdateStepUpToDate   = "uptodate"
	DockerUpdateStepError      = "error"
	DockerUpdateStepSkipped    = "skipped"

	dockerUpdateJobSettingKey = "dockerUpdateJob"
)

// DockerUpdateJobNode is one worker in the update job.
type DockerUpdateJobNode struct {
	ID            int    `json:"id"`
	Name          string `json:"name"`
	Enable        bool   `json:"enable"`
	Colocated     bool   `json:"colocated"`
	Status        string `json:"status"`
	VersionBefore string `json:"versionBefore"`
	VersionAfter  string `json:"versionAfter"`
	Message       string `json:"message,omitempty"`
	TriggeredAt   int64  `json:"triggeredAt"`
	SawOffline    bool   `json:"sawOffline"`
}

// DockerUpdateJobPanel is the panel's own step (always last).
type DockerUpdateJobPanel struct {
	Status        string `json:"status"`
	VersionBefore string `json:"versionBefore"`
	VersionAfter  string `json:"versionAfter"`
	Message       string `json:"message,omitempty"`
	TriggeredAt   int64  `json:"triggeredAt"`
}

// DockerUpdateJob is the persisted state of one update run.
type DockerUpdateJob struct {
	ID         string                `json:"id"`
	State      string                `json:"state"`
	Phase      string                `json:"phase"`
	MultiNode  bool                  `json:"multiNode"`
	StartedAt  int64                 `json:"startedAt"`
	UpdatedAt  int64                 `json:"updatedAt"`
	FinishedAt int64                 `json:"finishedAt"`
	Panel      DockerUpdateJobPanel  `json:"panel"`
	Nodes      []DockerUpdateJobNode `json:"nodes"`
}

func stepFinal(s string) bool {
	switch s {
	case DockerUpdateStepUpdated, DockerUpdateStepUpToDate, DockerUpdateStepError, DockerUpdateStepSkipped:
		return true
	}
	return false
}

type dockerNodeProbe struct {
	Online  bool
	Version string
}

// dockerUpdateEnv is everything the job needs from the outside world, so the state machine can be
// tested without Docker, HTTP or a database.
type dockerUpdateEnv interface {
	ListNodes() ([]*model.Node, error)
	MultiNode() bool
	IsColocated(n *model.Node) bool
	TriggerNode(ctx context.Context, n *model.Node) error
	ProbeNode(ctx context.Context, n *model.Node) (dockerNodeProbe, error)
	PanelVersion() string
	TriggerPanel(ctx context.Context) error
	PrepWorkers() error
	FinishWorkers() error
	Load() (*DockerUpdateJob, error)
	Save(j *DockerUpdateJob) error
	Now() time.Time
	Sleep(ctx context.Context, d time.Duration) error
}

type dockerUpdateTiming struct {
	Poll         time.Duration // how often a node is probed
	Settle       time.Duration // online + unchanged this long after the trigger returned => already up to date
	NodeTimeout  time.Duration // give up on a node
	PanelSettle  time.Duration // panel: how long to wait for a restart after a dropped trigger before deciding
	ResumeSettle time.Duration // resumed run: how long a node must look unchanged before it counts as up to date
	ResumeWindow time.Duration // a persisted running job older than this is abandoned, not resumed
}

func defaultDockerUpdateTiming() dockerUpdateTiming {
	return dockerUpdateTiming{
		Poll:         2 * time.Second,
		Settle:       25 * time.Second,
		NodeTimeout:  7 * time.Minute,
		PanelSettle:  90 * time.Second,
		ResumeSettle: 90 * time.Second,
		ResumeWindow: 20 * time.Minute,
	}
}

type dockerUpdateRunner struct {
	env    dockerUpdateEnv
	timing dockerUpdateTiming

	mu      sync.Mutex
	job     *DockerUpdateJob
	running bool
}

func newDockerUpdateRunner(env dockerUpdateEnv, timing dockerUpdateTiming) *dockerUpdateRunner {
	return &dockerUpdateRunner{env: env, timing: timing}
}

func newJobID() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(b)
}

func cloneJob(j *DockerUpdateJob) *DockerUpdateJob {
	if j == nil {
		return nil
	}
	c := *j
	c.Nodes = append([]DockerUpdateJobNode(nil), j.Nodes...)
	return &c
}

// update mutates the job under the lock and persists the result.
func (r *dockerUpdateRunner) update(fn func(j *DockerUpdateJob)) {
	r.mu.Lock()
	fn(r.job)
	r.job.UpdatedAt = r.env.Now().UnixMilli()
	snap := cloneJob(r.job)
	r.mu.Unlock()
	if err := r.env.Save(snap); err != nil {
		logger.Warningf("docker update job: persist: %v", err)
	}
}

func (r *dockerUpdateRunner) updateNode(i int, fn func(n *DockerUpdateJobNode)) {
	r.update(func(j *DockerUpdateJob) { fn(&j.Nodes[i]) })
}

// Snapshot returns the current job (in memory, else the persisted one), or nil.
func (r *dockerUpdateRunner) Snapshot() *DockerUpdateJob {
	r.mu.Lock()
	if r.job != nil {
		c := cloneJob(r.job)
		r.mu.Unlock()
		return c
	}
	r.mu.Unlock()
	j, err := r.env.Load()
	if err != nil {
		return nil
	}
	return j
}

// Start begins a new job unless one is already running (then that one is returned).
func (r *dockerUpdateRunner) Start() (*DockerUpdateJob, error) {
	r.mu.Lock()
	if r.running && r.job != nil {
		c := cloneJob(r.job)
		r.mu.Unlock()
		return c, nil
	}
	r.running = true // claimed: a concurrent Start now sees a running job
	r.mu.Unlock()

	nodes, err := r.env.ListNodes()
	if err != nil {
		r.mu.Lock()
		r.running = false
		r.mu.Unlock()
		return nil, err
	}
	now := r.env.Now().UnixMilli()
	job := &DockerUpdateJob{
		ID:        newJobID(),
		State:     DockerUpdateJobRunning,
		Phase:     "prep",
		MultiNode: r.env.MultiNode(),
		StartedAt: now,
		UpdatedAt: now,
		Panel:     DockerUpdateJobPanel{Status: DockerUpdateStepPending, VersionBefore: r.env.PanelVersion()},
	}
	if job.MultiNode {
		for _, n := range nodes {
			if n == nil {
				continue
			}
			jn := DockerUpdateJobNode{ID: n.Id, Name: n.Name, Enable: n.Enable, VersionBefore: strings.TrimSpace(n.WorkerVersion), Status: DockerUpdateStepPending}
			if !n.Enable {
				jn.Status = DockerUpdateStepSkipped
			} else {
				jn.Colocated = r.env.IsColocated(n)
			}
			job.Nodes = append(job.Nodes, jn)
		}
	}

	r.mu.Lock()
	r.job = job
	r.mu.Unlock()
	if err := r.env.Save(cloneJob(job)); err != nil {
		logger.Warningf("docker update job: persist: %v", err)
	}
	ret := cloneJob(job) // copied before the run goroutine starts mutating the job
	go r.run(context.Background(), false)
	return ret, nil
}

// Resume continues a job that was interrupted by a panel restart.
func (r *dockerUpdateRunner) Resume() {
	j, err := r.env.Load()
	if err != nil || j == nil || j.State != DockerUpdateJobRunning {
		return
	}
	age := r.env.Now().Sub(time.UnixMilli(j.UpdatedAt))
	if age > r.timing.ResumeWindow {
		j.State = DockerUpdateJobFailed
		j.Phase = "abandoned"
		j.FinishedAt = r.env.Now().UnixMilli()
		if j.Panel.Status != "" && !stepFinal(j.Panel.Status) {
			j.Panel.Status = DockerUpdateStepError
			j.Panel.Message = "update was interrupted and not resumed in time"
		}
		_ = r.env.Save(j)
		return
	}
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return
	}
	r.job = j
	r.running = true
	r.mu.Unlock()
	logger.Infof("docker update job %s: resuming after panel restart (phase=%s)", j.ID, j.Phase)
	go r.run(context.Background(), true)
}

func (r *dockerUpdateRunner) run(ctx context.Context, resumed bool) {
	defer func() {
		r.mu.Lock()
		r.running = false
		r.mu.Unlock()
	}()

	base := r.Snapshot()
	multi := base.MultiNode
	if multi && !resumed {
		r.update(func(j *DockerUpdateJob) { j.Phase = "prep" })
		if err := r.env.PrepWorkers(); err != nil {
			logger.Warningf("docker update job: pre-update config push: %v", err)
		}
	}

	if multi {
		pending := func(colocated bool) []int {
			cur := r.Snapshot()
			var idx []int
			for i, n := range cur.Nodes {
				if n.Enable && n.Colocated == colocated && !stepFinal(n.Status) {
					idx = append(idx, i)
				}
			}
			return idx
		}

		// 1) Remote workers in parallel.
		r.update(func(j *DockerUpdateJob) { j.Phase = "workers" })
		var wg sync.WaitGroup
		for _, i := range pending(false) {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				r.updateOneNode(ctx, i, resumed)
			}(i)
		}
		wg.Wait()

		// 2) Workers that share this host go last, one at a time: their Watchtower may recreate the
		// panel in the same breath, and everything before that has already been verified.
		r.update(func(j *DockerUpdateJob) { j.Phase = "local" })
		for _, i := range pending(true) {
			r.updateOneNode(ctx, i, resumed)
		}

		r.update(func(j *DockerUpdateJob) { j.Phase = "finish" })
		if err := r.env.FinishWorkers(); err != nil {
			logger.Warningf("docker update job: post-update config push: %v", err)
		}
		r.flagStuckNodes()
	}

	r.update(func(j *DockerUpdateJob) { j.Phase = "panel" })
	r.updatePanel(ctx)

	r.update(func(j *DockerUpdateJob) {
		j.Phase = "done"
		j.FinishedAt = r.env.Now().UnixMilli()
		j.State = DockerUpdateJobDone
		if j.Panel.Status == DockerUpdateStepError {
			j.State = DockerUpdateJobFailed
		}
		for _, n := range j.Nodes {
			if n.Status == DockerUpdateStepError {
				j.State = DockerUpdateJobFailed
			}
		}
	})
}

// updateOneNode triggers one worker's updater and decides the outcome from observable facts.
func (r *dockerUpdateRunner) updateOneNode(ctx context.Context, i int, resumed bool) {
	nodeID := r.snapshotNode(i).ID
	nodes, err := r.env.ListNodes()
	var node *model.Node
	if err == nil {
		for _, n := range nodes {
			if n != nil && n.Id == nodeID {
				node = n
				break
			}
		}
	}
	if node == nil {
		r.updateNode(i, func(n *DockerUpdateJobNode) {
			n.Status = DockerUpdateStepError
			n.Message = "node not found"
		})
		return
	}

	cur := r.snapshotNode(i)
	triggerDone := make(chan error, 1)
	triggeredAt := r.env.Now()
	// settleAt: from then on "online, same version, never seen offline" means already up to date.
	var settleAt time.Time
	if cur.TriggeredAt == 0 {
		r.updateNode(i, func(n *DockerUpdateJobNode) {
			n.Status = DockerUpdateStepTriggering
			n.TriggeredAt = triggeredAt.UnixMilli()
		})
		go func() {
			tctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
			defer cancel()
			triggerDone <- r.env.TriggerNode(tctx, node)
		}()
	} else {
		// Resumed: the previous process already sent the trigger. Only verify, and be patient — an
		// image pull may still be in progress on the node.
		triggeredAt = time.UnixMilli(cur.TriggeredAt)
		settleAt = r.env.Now().Add(r.timing.ResumeSettle)
		triggerDone = nil
	}

	var triggerErr error
	deadline := triggeredAt.Add(r.timing.NodeTimeout)
	if resumed && deadline.Before(r.env.Now().Add(r.timing.ResumeSettle+r.timing.Settle)) {
		deadline = r.env.Now().Add(r.timing.ResumeSettle + r.timing.Settle)
	}

	for {
		if triggerDone != nil {
			select {
			case err := <-triggerDone:
				triggerDone = nil
				triggerErr = err
				settleAt = r.env.Now().Add(r.timing.Settle)
				var te *transientTriggerError
				if err != nil && !errors.As(err, &te) {
					// The updater answered with a real error (misconfigured Watchtower, bad token, …).
					r.updateNode(i, func(n *DockerUpdateJobNode) {
						n.Status = DockerUpdateStepError
						n.Message = err.Error()
					})
					return
				}
			default:
			}
		}

		probe, perr := r.env.ProbeNode(ctx, node)
		if perr != nil || !probe.Online {
			r.updateNode(i, func(n *DockerUpdateJobNode) {
				n.SawOffline = true
				n.Status = DockerUpdateStepRestarting
			})
		} else {
			snap := r.snapshotNode(i)
			changed := probe.Version != "" && snap.VersionBefore != "" && probe.Version != snap.VersionBefore
			if changed || (snap.SawOffline && probe.Version != "") {
				msg := ""
				if !changed {
					msg = "restarted, version unchanged"
				}
				r.updateNode(i, func(n *DockerUpdateJobNode) {
					n.Status = DockerUpdateStepUpdated
					n.VersionAfter = probe.Version
					n.Message = msg
				})
				return
			}
			if !settleAt.IsZero() && !r.env.Now().Before(settleAt) {
				r.updateNode(i, func(n *DockerUpdateJobNode) {
					n.Status = DockerUpdateStepUpToDate
					n.VersionAfter = probe.Version
				})
				return
			}
		}

		if !r.env.Now().Before(deadline) {
			msg := "the node did not come back with a new version in time"
			if triggerErr != nil {
				msg = fmt.Sprintf("%s (updater: %v)", msg, triggerErr)
			}
			r.updateNode(i, func(n *DockerUpdateJobNode) {
				n.Status = DockerUpdateStepError
				n.Message = msg
			})
			return
		}
		if err := r.env.Sleep(ctx, r.timing.Poll); err != nil {
			r.updateNode(i, func(n *DockerUpdateJobNode) {
				n.Status = DockerUpdateStepError
				n.Message = err.Error()
			})
			return
		}
	}
}

func (r *dockerUpdateRunner) snapshotNode(i int) DockerUpdateJobNode {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.job.Nodes[i]
}

// flagStuckNodes turns "no change" into an error when the node is clearly behind its peers: the
// Watchtower session ran but the node still reports an older build than the others just reached.
func (r *dockerUpdateRunner) flagStuckNodes() {
	r.mu.Lock()
	newest := ""
	for _, n := range r.job.Nodes {
		if (n.Status == DockerUpdateStepUpdated || n.Status == DockerUpdateStepUpToDate) && versionLess(newest, n.VersionAfter) {
			newest = n.VersionAfter
		}
	}
	r.mu.Unlock()
	if newest == "" {
		return
	}
	r.update(func(j *DockerUpdateJob) {
		for i := range j.Nodes {
			n := &j.Nodes[i]
			if n.Status == DockerUpdateStepUpToDate && versionLess(n.VersionAfter, newest) {
				n.Status = DockerUpdateStepError
				n.Message = fmt.Sprintf("still on %s while other nodes reached %s — the image update did not apply", n.VersionAfter, newest)
			}
		}
	})
}

// updatePanel is always the last step. It may kill this very process (Watchtower recreates the
// panel container), in which case the resumed run in the new process finishes it.
func (r *dockerUpdateRunner) updatePanel(ctx context.Context) {
	current := r.env.PanelVersion()
	r.mu.Lock()
	p := r.job.Panel
	r.mu.Unlock()

	if p.VersionBefore != "" && current != p.VersionBefore {
		r.update(func(j *DockerUpdateJob) {
			j.Panel.Status = DockerUpdateStepUpdated
			j.Panel.VersionAfter = current
		})
		return
	}
	if p.TriggeredAt != 0 {
		// A previous process already asked for the update and this one is the result: it restarted
		// but the version is the same, so the image was already current.
		r.update(func(j *DockerUpdateJob) {
			j.Panel.Status = DockerUpdateStepUpToDate
			j.Panel.VersionAfter = current
			j.Panel.Message = "restarted, version unchanged"
		})
		return
	}

	now := r.env.Now()
	r.update(func(j *DockerUpdateJob) {
		j.Panel.Status = DockerUpdateStepTriggering
		j.Panel.TriggeredAt = now.UnixMilli()
	})
	tctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	err := r.env.TriggerPanel(tctx)
	var te *transientTriggerError
	if err != nil && !errors.As(err, &te) && !isConnectionDrop(err) {
		r.update(func(j *DockerUpdateJob) {
			j.Panel.Status = DockerUpdateStepError
			j.Panel.Message = err.Error()
		})
		return
	}
	// Still alive after the trigger. A clean return means Watchtower finished without touching us
	// (nothing newer). A dropped connection may mean the restart is imminent, so give it time.
	if err != nil {
		_ = r.env.Sleep(ctx, r.timing.PanelSettle)
	}
	after := r.env.PanelVersion()
	r.update(func(j *DockerUpdateJob) {
		if after != j.Panel.VersionBefore {
			j.Panel.Status = DockerUpdateStepUpdated
		} else {
			j.Panel.Status = DockerUpdateStepUpToDate
		}
		j.Panel.VersionAfter = after
	})
}

func isConnectionDrop(err error) bool {
	if err == nil {
		return false
	}
	m := strings.ToLower(err.Error())
	for _, s := range []string{"eof", "connection reset", "broken pipe", "connection refused", "deadline exceeded", "timeout"} {
		if strings.Contains(m, s) {
			return true
		}
	}
	return false
}

// versionLess reports whether a < b for dotted numeric versions ("1.7.25"). Empty is the smallest.
func versionLess(a, b string) bool {
	pa, pb := versionParts(a), versionParts(b)
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		if x != y {
			return x < y
		}
	}
	return false
}

func versionParts(v string) []int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if v == "" {
		return nil
	}
	var out []int
	for _, seg := range strings.Split(v, ".") {
		digits := seg
		for i, c := range seg {
			if c < '0' || c > '9' {
				digits = seg[:i]
				break
			}
		}
		n, _ := strconv.Atoi(digits)
		out = append(out, n)
	}
	return out
}

func marshalJob(j *DockerUpdateJob) (string, error) {
	b, err := json.Marshal(j)
	return string(b), err
}
