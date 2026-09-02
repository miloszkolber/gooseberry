package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/miloszkolber/gooseberry/browser"
	"github.com/miloszkolber/gooseberry/internal/diagnostics"
)

var (
	version  = "0.0.0-dev"
	revision = "unknown"
)

func main() {
	build := diagnostics.NormalizeBuild(version, revision)
	logger := diagnostics.NewLogger("browser", build)
	slog.SetDefault(logger)
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		endpoint, err := browser.HealthURL()
		if err != nil {
			fatal(logger, err)
		}
		client := http.Client{Timeout: 3 * time.Second}
		response, err := client.Get(endpoint)
		if err != nil {
			fatal(logger, err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			logger.Error("browser healthcheck failed", "status", response.StatusCode)
			os.Exit(1)
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := browser.Run(ctx, build, logger); err != nil {
		fatal(logger, err)
	}
}

func fatal(logger *slog.Logger, err error) {
	logger.Error("browser service failed", "error", err)
	os.Exit(1)
}
