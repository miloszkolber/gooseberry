package browser

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/miloszkolber/gooseberry/internal/diagnostics"
)

// Run serves the browser API until cancellation or an HTTP listener failure.
func Run(ctx context.Context, build diagnostics.BuildInfo, logger *slog.Logger) error {
	config, err := ConfigFromEnvironment(os.LookupEnv)
	if err != nil {
		return err
	}
	service, err := NewService(config, build, logger)
	if err != nil {
		return err
	}

	server := service.httpServer()
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return err
	}
	errorsCh := make(chan error, 1)
	go func() { errorsCh <- server.Serve(listener) }()
	service.app.logger.Info("browser service listening", "address", listener.Addr().String())

	select {
	case <-ctx.Done():
	case err = <-errorsCh:
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
	}
	service.Shutdown()
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
	config, err := ConfigFromEnvironment(os.LookupEnv)
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
