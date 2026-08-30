package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/miloszkolber/gooseberry/browser"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		endpoint, err := browser.HealthURL()
		if err != nil {
			fatal(err)
		}
		client := http.Client{Timeout: 3 * time.Second}
		response, err := client.Get(endpoint)
		if err != nil {
			fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			fatal(fmt.Errorf("browser healthcheck returned %d", response.StatusCode))
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if err := browser.Run(ctx); err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
