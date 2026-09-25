// Package api is the balancer agent's HTTP API: health, status and apply. Authentication is the same panel JWT as for nodes.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/konstpic/sharx-code/v2/balancer/engine"
	"github.com/konstpic/sharx-code/v2/balancer/spec"
	"github.com/konstpic/sharx-code/v2/config"
	"github.com/konstpic/sharx-code/v2/node/auth"
)

const maxApplyBody = 2 << 20 // 2 MiB is far above any real spec

// Server serves the agent API.
type Server struct {
	secret []byte
	eng    *engine.Manager
}

// New creates the API around an engine manager.
func New(authSecret string, eng *engine.Manager) *Server {
	return &Server{secret: []byte(authSecret), eng: eng}
}

// Handler returns the routes.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "role": "balancer"})
	})
	mux.HandleFunc("GET /api/v1/status", s.auth(s.status))
	mux.HandleFunc("GET /api/v1/metrics", s.auth(s.metrics))
	mux.HandleFunc("POST /api/v1/apply", s.auth(s.apply))
	return mux
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		tok, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || tok == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "missing bearer token"})
			return
		}
		parser := jwt.NewParser(
			jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
			jwt.WithIssuer(auth.JWTIssuer),
			jwt.WithAudience(auth.JWTAudience),
			jwt.WithExpirationRequired(),
		)
		if _, err := parser.Parse(tok, func(*jwt.Token) (any, error) { return s.secret, nil }); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid token"})
			return
		}
		next(w, r)
	}
}

func (s *Server) status(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"agentVersion":   config.GetVersion(),
		"engineVersions": engineVersions(),
		"status":         s.eng.Status(),
	})
}

// metrics returns the sampled history newer than ?since= (unix ms). Counters are cumulative.
func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	samples := s.eng.Metrics(since)
	if len(samples) > 900 {
		samples = samples[len(samples)-900:]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"intervalMs": engine.SampleInterval.Milliseconds(),
		"now":        time.Now().UnixMilli(),
		"samples":    samples,
	})
}

func (s *Server) apply(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxApplyBody))
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "body too large"})
		return
	}
	var sp spec.Spec
	if err := json.Unmarshal(body, &sp); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	if err := s.eng.Apply(r.Context(), sp); err != nil {
		code := http.StatusUnprocessableEntity
		if errors.Is(err, errInternal) {
			code = http.StatusInternalServerError
		}
		writeJSON(w, code, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hash": sp.Hash(), "applied": true})
}

var errInternal = errors.New("internal")

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func engineVersions() map[string]string {
	out := map[string]string{}
	if b, err := exec.Command(envBin("HAPROXY_BIN", "haproxy"), "-v").Output(); err == nil {
		out["haproxy"] = firstLine(string(b))
	}
	if b, err := exec.Command(envBin("NGINX_BIN", "nginx"), "-v").CombinedOutput(); err == nil {
		out["nginx"] = firstLine(string(b))
	}
	return out
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

func envBin(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
