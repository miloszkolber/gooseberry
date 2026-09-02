#!/bin/sh
set -eu

session=gooseberry-ui-acceptance
fixture_pid=

browser() {
	agent-browser --session "$session" "$@"
}

assert_eval() {
	browser eval "(() => { if (!($1)) throw new Error('UI acceptance assertion failed'); return true; })()" >/dev/null
}

cleanup() {
	status=$?
	trap - EXIT INT TERM
	if [ "$status" -ne 0 ]; then
		browser screenshot /artifacts/failure.png >/dev/null 2>&1 || true
		browser snapshot -i > /artifacts/failure.txt 2>&1 || true
		browser get text body > /artifacts/failure-body.txt 2>&1 || true
		cat /artifacts/failure.txt >&2 || true
		cat /artifacts/failure-body.txt >&2 || true
	fi
	browser close >/dev/null 2>&1 || true
	if [ -n "$fixture_pid" ]; then
		kill -TERM "$fixture_pid" >/dev/null 2>&1 || true
		wait "$fixture_pid" >/dev/null 2>&1 || true
	fi
	exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p /artifacts
rm -f /tmp/gooseberry-ui-ready
/app/gooseberry-ui-fixture > /artifacts/fixture.log 2>&1 &
fixture_pid=$!

attempt=0
while [ ! -s /tmp/gooseberry-ui-ready ]; do
	attempt=$((attempt + 1))
	if ! kill -0 "$fixture_pid" 2>/dev/null || [ "$attempt" -ge 100 ]; then
		echo "UI fixture did not start" >&2
		exit 1
	fi
	sleep 0.1
done

url="http://127.0.0.1:7312/#/v1/projects/fixture-project/projectAreas/fixture-project/chats/fixture-1"
browser set viewport 1440 900 >/dev/null
browser set media light reduced-motion >/dev/null
browser open "$url" >/dev/null
browser wait --text "Loaded answer" >/dev/null
assert_eval "document.querySelector('[data-testid=connection-status]')?.getAttribute('data-status') === 'connected'"

# Commit selection, keyboard activity switching, source and image previews.
echo "UI acceptance: workspace"
browser find testid tab-changes click >/dev/null
browser wait --text "Uncommitted" >/dev/null
browser find role button click --name "Review scope: Uncommitted" >/dev/null
browser wait --text "Recent commit" >/dev/null
browser eval "(() => { const select = document.querySelector('[aria-label=\"Recent commit\"]'); if (!(select instanceof HTMLSelectElement) || select.options.length < 2) throw new Error('commit picker unavailable'); select.selectedIndex = 1; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()" >/dev/null
browser find role button click --name "View commit" >/dev/null
browser wait --text "history.txt" >/dev/null
browser click '[data-testid="change-item"][title="history.txt"]' >/dev/null
browser wait --text "after" >/dev/null
assert_eval "document.querySelector('[data-testid=source-diff]')?.textContent?.includes('after') === true"
browser find testid tab-changes click >/dev/null
browser press ArrowLeft >/dev/null
assert_eval "document.querySelector('[data-testid=tab-files]')?.getAttribute('aria-selected') === 'true' && document.activeElement?.getAttribute('data-testid') === 'tab-files'"
browser wait --fn "Array.from(document.querySelectorAll('[data-testid=file-node]')).some((node) => node.textContent?.trim() === 'README.md')" >/dev/null
browser find role button click --name "README.md" >/dev/null
browser wait --text "Welcome to acceptance." >/dev/null
assert_eval "document.querySelector('[data-testid=markdown-preview]') !== null"
browser screenshot /artifacts/desktop-workspace.png >/dev/null
browser find testid tab-files click >/dev/null
browser find role button click --name "fixture.png" >/dev/null
browser wait --fn "Array.from(document.images).some((image) => image.alt === 'fixture.png' && image.complete && image.naturalWidth > 0)" >/dev/null
browser screenshot /artifacts/desktop-image.png >/dev/null
browser find role button click --name "Close fixture.png" >/dev/null
assert_eval "document.querySelector('[aria-label=\"Close fixture.png\"]') === null"

# Streaming survives tab closure and reconnect without duplicating the transcript.
echo "UI acceptance: continuity"
browser click '[data-testid="content-tab"][data-kind="chat"] > button[aria-pressed]' >/dev/null
browser wait --text "Loaded answer" >/dev/null
browser wait --fn "document.querySelector('[data-testid=chat-input]')?.closest('[aria-hidden=true]') === null" >/dev/null
browser fill '[data-testid="chat-input"]' "Continue" >/dev/null
assert_eval "document.querySelector('[data-testid=chat-input]')?.value === 'Continue'"
assert_eval "document.querySelector('[data-testid=chat-send]')?.disabled === false"
browser find testid chat-send click >/dev/null
browser wait --fn "document.querySelector('[data-testid=chat-input]')?.value === ''" >/dev/null
browser wait --text "Continue" >/dev/null
browser wait --text "Partial reply" >/dev/null
assert_eval "document.querySelector('[data-testid=stream-indicator]') !== null"
echo "UI acceptance: close and reopen streaming chat"
browser click '[data-testid="content-tab"][data-kind="chat"] [data-testid="content-tab-close"]' >/dev/null
browser wait --fn "document.querySelector('[data-testid=content-tab][data-kind=chat]') === null" >/dev/null
browser click '[data-testid="chat-history"]' >/dev/null
browser wait --fn "document.querySelector('[data-testid=closed-chat-item]')?.offsetParent !== null" >/dev/null
browser focus '[data-testid="closed-chat-item"]' >/dev/null
assert_eval "document.activeElement?.getAttribute('data-testid') === 'closed-chat-item'"
browser press Enter >/dev/null
browser wait --fn "document.querySelector('[data-testid=content-tab][data-kind=chat]') !== null" >/dev/null
browser wait --text "Partial reply" >/dev/null
echo "UI acceptance: finish stream"
kill -USR1 "$fixture_pid"
browser wait --text "Partial reply complete." >/dev/null
assert_eval "Array.from(document.querySelectorAll('[data-testid=chat-message][data-role=assistant]')).filter((node) => node.textContent?.includes('Partial reply complete.')).length === 1"
browser set offline on >/dev/null
browser open about:blank >/dev/null
browser back >/dev/null
echo "UI acceptance: reconnect"
browser wait --fn "document.querySelector('[data-testid=connection-status]')?.getAttribute('data-status') === 'disconnected'" >/dev/null
browser set offline off >/dev/null
browser wait --fn "document.querySelector('[data-testid=connection-status]')?.getAttribute('data-status') === 'connected'" >/dev/null
browser wait --text "Partial reply complete." >/dev/null
assert_eval "Array.from(document.querySelectorAll('[data-testid=chat-message][data-role=assistant]')).filter((node) => node.textContent?.includes('Partial reply complete.')).length === 1"
browser click '[data-testid="chat-attachment-chip"]' >/dev/null
browser wait --fn "document.querySelector('[data-testid=chat-attachment-dialog]') !== null" >/dev/null
browser press Escape >/dev/null
browser wait --fn "document.querySelector('[data-testid=chat-attachment-dialog]') === null" >/dev/null
assert_eval "document.activeElement?.getAttribute('data-testid') === 'chat-attachment-chip'"
browser screenshot /artifacts/desktop-chat.png >/dev/null

# Narrow layout, pane navigation, dialog keyboard behavior and overflow.
echo "UI acceptance: narrow layout"
browser set viewport 390 844 >/dev/null
browser find role button click --name "activity" >/dev/null
browser wait --fn "document.querySelector('[data-testid=activity-tabs]')?.offsetParent !== null" >/dev/null
assert_eval "document.documentElement.scrollWidth === document.documentElement.clientWidth"
browser find role button click --name "content" >/dev/null
browser find testid open-settings click >/dev/null
browser wait --fn "document.querySelector('[data-testid=settings-dialog]') !== null" >/dev/null
assert_eval "document.querySelector('[data-testid=settings-dialog]')?.getBoundingClientRect().right <= window.innerWidth"
browser find role tab click --name "Agent" >/dev/null
browser press ArrowRight >/dev/null
assert_eval "document.activeElement?.textContent?.trim() === 'Signet' && document.activeElement?.getAttribute('aria-selected') === 'true'"
browser screenshot /artifacts/narrow-settings.png >/dev/null
browser press Escape >/dev/null
browser wait --fn "document.querySelector('[data-testid=settings-dialog]') === null" >/dev/null
assert_eval "document.activeElement?.getAttribute('data-testid') === 'open-settings' && document.documentElement.scrollWidth === document.documentElement.clientWidth"
browser screenshot /artifacts/narrow-workspace.png >/dev/null

echo "UI acceptance passed"
