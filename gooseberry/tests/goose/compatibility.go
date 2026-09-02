// Run from gooseberry/: go run ./tests/goose -url ws://127.0.0.1:3284/acp
// Optional -source checks required registrations in a matching upstream checkout.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	acp "github.com/coder/acp-go-sdk"
	"github.com/miloszkolber/gooseberry/internal/controller"
)

func main() {
	source := flag.String("source", "", "optional upstream Goose source directory")
	controllerDir := flag.String("controller", "controller", "Gooseberry controller source directory")
	url := flag.String("url", "", "isolated Goose ACP WebSocket URL")
	flag.Parse()
	if *source == "" && *url == "" {
		fmt.Fprintln(os.Stderr, "provide -url for runtime verification or -source for registration verification")
		os.Exit(2)
	}
	if *source != "" {
		if err := checkMethods(*source, *controllerDir); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	if *url != "" {
		if err := checkRuntime(*url); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}

func checkMethods(source, controllerDir string) error {
	raw, err := os.ReadFile(filepath.Join(source, "crates/goose/acp-meta.json"))
	if err != nil {
		return err
	}
	var catalog map[string][]struct {
		Method      string `json:"method"`
		RequestType string `json:"requestType"`
	}
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return err
	}
	dispatch, err := os.ReadFile(filepath.Join(source, "crates/goose/src/acp/server/custom_dispatch.rs"))
	if err != nil {
		return err
	}
	registered := map[string]bool{}
	for kind, entries := range catalog {
		for _, entry := range entries {
			request := strings.TrimSuffix(entry.RequestType, "_unstable")
			registered[entry.Method] = kind != "methods" ||
				strings.Contains(string(dispatch), "#[custom_method("+request+")]") ||
				strings.Contains(string(dispatch), "<"+request+" as agent_client_protocol::JsonRpcMessage>::matches_method(method)")
		}
	}
	// Only these three call sites compose their method names dynamically.
	families := map[string][]string{
		"_goose/unstable/sources/":           {"create", "update"},
		"_goose/unstable/config/extensions/": {"remove", "set-enabled"},
		"_goose/unstable/schedules/":         {"create", "update", "pause", "unpause", "delete", "run-now", "sessions/list", "running-job/inspect", "running-job/kill"},
	}
	packages, err := parser.ParseDir(token.NewFileSet(), controllerDir, func(entry os.FileInfo) bool {
		return !strings.HasSuffix(entry.Name(), "_test.go")
	}, 0)
	if err != nil {
		return err
	}
	required := map[string]bool{}
	for _, pkg := range packages {
		for _, file := range pkg.Files {
			ast.Inspect(file, func(node ast.Node) bool {
				literal, ok := node.(*ast.BasicLit)
				if !ok || literal.Kind != token.STRING {
					return true
				}
				method, _ := strconv.Unquote(literal.Value)
				if strings.HasPrefix(method, "_goose/unstable/") {
					if suffixes, exists := families[method]; exists {
						for _, suffix := range suffixes {
							required[method+suffix] = true
						}
					} else {
						required[method] = true
					}
				}
				return true
			})
		}
	}
	if len(required) == 0 {
		return fmt.Errorf("no Gooseberry ACP methods found")
	}
	for method := range required {
		if !registered[method] {
			return fmt.Errorf("candidate Goose no longer registers required method %s; review compatibility before updating pins", method)
		}
	}
	fmt.Printf("verified %d required Goose methods and notifications\n", len(required))
	return nil
}

func checkRuntime(url string) error {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	unauthorized := controller.NewGooseClient(url, "incorrect-smoke-secret", "0.0.0", nil)
	_, err := unauthorized.Ready(ctx)
	unauthorized.Close()
	if err == nil {
		return fmt.Errorf("Goose accepted an incorrect ACP secret")
	}
	client := controller.NewGooseClient(url, os.Getenv("GOOSE_SERVER__SECRET_KEY"), "0.0.0", nil)
	defer client.Close()
	if _, err := client.ListSessions(ctx, acp.ListSessionsRequest{}); err != nil {
		return fmt.Errorf("authenticated WebSocket initialize/session list: %w", err)
	}
	admin := controller.NewGooseAdmin(client, nil)
	if _, err := admin.ProviderStatus(ctx); err != nil {
		return fmt.Errorf("provider projection: %w", err)
	}
	if _, err := admin.ReadDefaults(ctx); err != nil {
		return fmt.Errorf("default projection: %w", err)
	}
	threshold := 0.7
	prefs, err := admin.SavePreferences(ctx, controller.GoosePreferences{AutoCompactThreshold: &threshold})
	if err != nil || prefs.AutoCompactThreshold == nil || *prefs.AutoCompactThreshold != threshold {
		return fmt.Errorf("preference write/read round trip failed: %v", err)
	}
	client.Reset()
	prefs, err = admin.ReadPreferences(ctx)
	if err != nil || prefs.AutoCompactThreshold == nil || *prefs.AutoCompactThreshold != threshold {
		return fmt.Errorf("reconnect did not preserve Goose preference: %v", err)
	}
	if _, err := admin.ResetPreferences(ctx, []string{"autoCompactThreshold"}); err != nil {
		return err
	}
	for method, field := range map[string]string{
		"_goose/unstable/recipes/list": "recipes", "_goose/unstable/schedules/list": "jobs",
		"_goose/unstable/config/extensions/list": "extensions",
	} {
		raw, err := client.CallGoose(ctx, method, map[string]any{})
		if err != nil {
			return fmt.Errorf("%s: %w", method, err)
		}
		var result map[string]json.RawMessage
		if json.Unmarshal(raw, &result) != nil || len(result[field]) == 0 || result[field][0] != '[' {
			return fmt.Errorf("%s omitted its %s array", method, field)
		}
	}
	fmt.Println("authenticated ACP WebSocket, projections, persistence and reconnect checks passed")
	return nil
}
