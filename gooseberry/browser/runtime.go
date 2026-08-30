package browser

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"
)

// Run serves the browser API until cancellation or an HTTP listener failure.
func Run(ctx context.Context) error {
	config, err := configFromEnvironment(os.LookupEnv)
	if err != nil {
		return err
	}
	app, err := newApp(config)
	if err != nil {
		return err
	}

	server := app.httpServer()
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return err
	}
	errorsCh := make(chan error, 1)
	go func() { errorsCh <- server.Serve(listener) }()
	log.Printf("[gooseberry-browser] listening on %s", listener.Addr())

	select {
	case <-ctx.Done():
	case err = <-errorsCh:
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
	}
	app.shutdown()
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	shutdownErr := server.Shutdown(shutdownContext)
	if shutdownErr != nil {
		_ = server.Close()
	}
	return errors.Join(err, shutdownErr)
}

// HealthURL uses the same bind configuration as Run, including custom ports.
func HealthURL() (string, error) {
	config, err := configFromEnvironment(os.LookupEnv)
	if err != nil {
		return "", err
	}
	host := config.Host
	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	if host == "::" {
		host = "::1"
	}
	return "http://" + net.JoinHostPort(host, strconv.Itoa(config.Port)) + "/health", nil
}
