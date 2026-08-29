package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
)

func main() {
	config, err := configFromEnvironment(os.LookupEnv)
	if err != nil {
		log.Fatal(err)
	}
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		client := &http.Client{Timeout: 5 * time.Second}
		response, err := client.Get("http://" + net.JoinHostPort(config.Host, strconv.Itoa(config.Port)) + "/health")
		if err != nil || response == nil || response.StatusCode != http.StatusOK {
			if response != nil {
				response.Body.Close()
			}
			os.Exit(1)
		}
		response.Body.Close()
		return
	}
	app, err := newApp(config)
	if err != nil {
		log.Fatal(err)
	}

	server := app.httpServer()
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		log.Fatal(err)
	}
	errorsCh := make(chan error, 1)
	go func() { errorsCh <- server.Serve(listener) }()
	log.Printf("[gooseberry-browser] listening on %s", listener.Addr())

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case signal := <-signals:
		log.Printf("[gooseberry-browser] received %s, shutting down", signal)
		app.shutdown()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			log.Printf("[gooseberry-browser] shutdown: %v", err)
			_ = server.Close()
		}
	case err := <-errorsCh:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}
}
