// Command balancer is the SharX edge balancer agent: it receives a spec from the panel and runs HAProxy or nginx.
package main

import (
	"context"
	"flag"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/konstpic/sharx-code/v2/balancer/api"
	"github.com/konstpic/sharx-code/v2/balancer/engine"
	"github.com/konstpic/sharx-code/v2/logger"
	"github.com/konstpic/sharx-code/v2/node/auth"
	"github.com/op/go-logging"
)

func main() {
	port := flag.Int("port", 8080, "agent API port")
	dir := flag.String("data", "/app/data", "state directory")
	flag.Parse()
	if v := os.Getenv("SHARX_BALANCER_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			*port = n
		}
	}
	if v := os.Getenv("SHARX_BALANCER_DATA"); v != "" {
		*dir = v
	}
	logger.InitLogger(logging.INFO)

	bundle, err := auth.LoadBundleFromEnv()
	if err != nil || bundle == nil {
		logger.Error("SECRET_KEY is required (the plain secret from the panel, same as for nodes)")
		os.Exit(1)
	}

	mgr := engine.New(*dir)
	if err := mgr.Restore(); err != nil {
		logger.Warningf("restore last config: %v", err)
	}

	srv := &http.Server{
		Addr:              ":" + strconv.Itoa(*port),
		Handler:           api.New(bundle.AuthSecret, mgr).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
	}
	go func() {
		logger.Infof("SharX balancer agent listening on :%d", *port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Errorf("http: %v", err)
			os.Exit(1)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	mgr.Stop()
}
