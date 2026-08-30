package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/miloszkolber/gooseberry/browser"
	controller "github.com/miloszkolber/gooseberry/controller"
)

var version = "0.0.0-dev"

func main() {
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		browserURL, err := browser.HealthURL()
		if err != nil {
			fatal(err)
		}
		client := http.Client{Timeout: 3 * time.Second}
		for _, endpoint := range []string{"http://127.0.0.1:7312/livez", browserURL} {
			response, err := client.Get(endpoint)
			if err != nil {
				fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != http.StatusOK {
				fatal(fmt.Errorf("healthcheck %s returned %d", endpoint, response.StatusCode))
			}
		}
		return
	}
	stop, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if err := run(stop); err != nil {
		fatal(err)
	}
}

func run(ctx context.Context) error {
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	runtime, err := controller.NewRuntime(controller.RuntimeConfig{AppVersion: version})
	if err != nil {
		return err
	}
	endpoint, err := runtime.Start()
	if err != nil {
		return err
	}
	fmt.Printf("Gooseberry → %s\n", endpoint)
	browserDone := make(chan error, 1)
	go func() { browserDone <- browser.Run(ctx) }()
	browserStopped := false
	select {
	case err = <-browserDone:
		browserStopped = true
	case err = <-runtime.Errors():
	case <-ctx.Done():
	}
	stop()
	shutdownContext, release := context.WithTimeout(context.Background(), 15*time.Second)
	defer release()
	err = errors.Join(err, runtime.Shutdown(shutdownContext))
	if !browserStopped {
		select {
		case browserErr := <-browserDone:
			err = errors.Join(err, browserErr)
		case <-shutdownContext.Done():
			err = errors.Join(err, shutdownContext.Err())
		}
	}
	return err
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
