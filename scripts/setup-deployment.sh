#!/bin/sh
set -eu
umask 077

usage() {
	printf 'usage: %s\n' "$0" >&2
	exit 2
}

read_env_value() {
	name=$1
	file=$2
	lines=$(grep -c "^${name}=" "$file" || true)
	[ "$lines" -eq 1 ] || return 1
	sed -n "s/^${name}=//p" "$file"
}

optional_env_value() {
	name=$1
	file=$2
	lines=$(grep -c "^${name}=" "$file" || true)
	case "$lines" in
		0) printf '\n' ;;
		1) sed -n "s/^${name}=//p" "$file" ;;
		*)
			echo ".gooseberry may contain at most one $name" >&2
			exit 1
			;;
	esac
}

validate_gooseberry_keys() {
	awk '
		/^[[:space:]]*($|#)/ { next }
		/^[A-Za-z_][A-Za-z0-9_]*=/ {
			key = $0
			sub(/=.*/, "", key)
			if (key == "GOOSEBERRY_DATA_PATH" ||
				key == "GOOSEBERRY_GOOSE_SECRET_KEY" ||
				key == "GOOSEBERRY_CONTROLLER_HOST" ||
				key == "GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE" ||
				key == "GOOSEBERRY_AUTH_ENABLED" ||
				key == "GOOSEBERRY_TOKEN" ||
				key == "GOOSEBERRY_PUBLIC_ORIGIN" ||
				key == "GOOSEBERRY_BROWSER_AUTH" ||
				key == "GOOSEBERRY_BROWSER_TOKEN") next
			print ".gooseberry contains unsupported key: " key > "/dev/stderr"
			exit 1
		}
		{ print ".gooseberry contains an invalid line" > "/dev/stderr"; exit 1 }
	' "$gooseberry_env"
}

validate_token() {
	name=$1
	value=$2
	length=${#value}
	if [ "$length" -lt 32 ] || [ "$length" -gt 256 ] || ! printf '%s\n' "$value" | LC_ALL=C grep -Eq '^[[:graph:]]+$'; then
		echo ".gooseberry must contain a strong $name" >&2
		exit 1
	fi
	case "$value" in
		replace-with-a-random-controller-token|replace-with-a-random-browser-token|replace-with-a-random-goose-secret)
			echo ".gooseberry contains a documented placeholder token for $name" >&2
			exit 1
			;;
	esac
}

validate_boolean() {
	name=$1
	value=$2
	case "$value" in
		true|false) ;;
		*)
			echo "$name must be exactly true or false" >&2
			exit 1
			;;
	esac
}

canonicalize_missing_path() {
	candidate=$1
	suffix=
	while [ ! -e "$candidate" ]; do
		name=${candidate##*/}
		[ -n "$name" ] || return 1
		suffix=/$name$suffix
		candidate=${candidate%/*}
		[ -n "$candidate" ] || candidate=/
	done
	canonical=$(realpath "$candidate") || return 1
	printf '%s%s\n' "${canonical%/}" "$suffix"
}

validate_data_path() {
	case "$data_path" in
		/*) ;;
		*)
			echo "GOOSEBERRY_DATA_PATH must be absolute" >&2
			exit 1
			;;
	esac
	case "$data_path" in
		*'\n'*|*':'*|*'"'*|*"'"*|*'\\'*|*'#'*|*/../*|*/..|*/./*|*/.)
			echo "GOOSEBERRY_DATA_PATH is not a safe Compose bind source" >&2
			exit 1
			;;
	esac
	if [ -L "$data_path" ]; then
		echo "GOOSEBERRY_DATA_PATH must not be a symlink" >&2
		exit 1
	fi
	data_root=$(canonicalize_missing_path "$data_path") || {
		echo "GOOSEBERRY_DATA_PATH could not be resolved safely" >&2
		exit 1
	}
	if [ "$data_root" = / ]; then
		echo "GOOSEBERRY_DATA_PATH must not be /" >&2
		exit 1
	fi
	if [ -e "$data_root" ] && [ ! -d "$data_root" ]; then
		echo "GOOSEBERRY_DATA_PATH is not a directory" >&2
		exit 1
	fi
}

validate_directory() {
	path=$1
	label=$2
	if [ -L "$path" ] || { [ -e "$path" ] && [ ! -d "$path" ]; }; then
		echo "$label must be a real directory: $path" >&2
		exit 1
	fi
}

validate_state_layout() {
	for legacy in "$data_root/pixie" "$data_root/gooseberry"; do
		if [ -e "$legacy" ] || [ -L "$legacy" ]; then
			echo "existing deployment state must be moved out of $legacy before using the flat layout" >&2
			exit 1
		fi
	done
	for path in "$data_root" "$data_root/app" "$data_root/browser" "$data_root/browser/artifacts" "$data_root/browser/state"; do
		validate_directory "$path" "Gooseberry state"
	done
	if [ -d "$data_root" ]; then
		for entry in "$data_root"/* "$data_root"/.[!.]* "$data_root"/..?*; do
			[ -e "$entry" ] || [ -L "$entry" ] || continue
			case "${entry##*/}" in
				app|browser) ;;
				*)
					echo "GOOSEBERRY_DATA_PATH contains an unrecognized entry: ${entry##*/}" >&2
					exit 1
					;;
			esac
		done
	fi
}

sync_goose_env() {
	[ -n "${HOME:-}" ] || {
		echo "HOME is required to create the Goose service environment" >&2
		exit 1
	}
	case "$HOME" in
		/*) ;;
		*)
			echo "HOME must be absolute to create the Goose service environment" >&2
			exit 1
			;;
	esac
	goose_config_dir=$HOME/.config/goose
	goose_env=$goose_config_dir/gooseberry.env
	mkdir -p "$goose_config_dir"
	validate_directory "$goose_config_dir" "Goose configuration directory"
	chmod 700 "$goose_config_dir"
	if [ -L "$goose_env" ] || { [ -e "$goose_env" ] && [ ! -f "$goose_env" ]; }; then
		echo "Goose service environment is not a regular file: $goose_env" >&2
		exit 1
	fi
	for key in GOOSE_SERVER__SECRET_KEY GOOSEBERRY_BROWSER_URL GOOSEBERRY_BROWSER_AUTH GOOSEBERRY_BROWSER_TOKEN; do
		if [ -f "$goose_env" ] && [ "$(grep -c "^${key}=" "$goose_env" || true)" -gt 1 ]; then
			echo "Goose service environment contains duplicate $key entries: $goose_env" >&2
			exit 1
		fi
	done
	tmp_goose_env=$(mktemp "$goose_env.tmp.XXXXXX")
	trap 'rm -f "$tmp_goose_env"' EXIT HUP INT TERM
	input=/dev/null
	if [ -f "$goose_env" ]; then input=$goose_env; fi
	GOOSE_SYNC_SECRET=$goose_secret \
	GOOSE_SYNC_BROWSER_AUTH=$browser_auth \
	GOOSE_SYNC_BROWSER_TOKEN=$goose_browser_token \
	awk '
		BEGIN {
			value["GOOSE_SERVER__SECRET_KEY"] = ENVIRON["GOOSE_SYNC_SECRET"]
			value["GOOSEBERRY_BROWSER_URL"] = "http://127.0.0.1:8787"
			value["GOOSEBERRY_BROWSER_AUTH"] = ENVIRON["GOOSE_SYNC_BROWSER_AUTH"]
			value["GOOSEBERRY_BROWSER_TOKEN"] = ENVIRON["GOOSE_SYNC_BROWSER_TOKEN"]
		}
		/^(GOOSE_SERVER__SECRET_KEY|GOOSEBERRY_BROWSER_URL|GOOSEBERRY_BROWSER_AUTH|GOOSEBERRY_BROWSER_TOKEN)=/ {
			key = $0; sub(/=.*/, "", key)
			print key "=" value[key]
			seen[key] = 1
			next
		}
		{ print }
		END {
			if (!seen["GOOSE_SERVER__SECRET_KEY"]) print "GOOSE_SERVER__SECRET_KEY=" value["GOOSE_SERVER__SECRET_KEY"]
			if (!seen["GOOSEBERRY_BROWSER_URL"]) print "GOOSEBERRY_BROWSER_URL=" value["GOOSEBERRY_BROWSER_URL"]
			if (!seen["GOOSEBERRY_BROWSER_AUTH"]) print "GOOSEBERRY_BROWSER_AUTH=" value["GOOSEBERRY_BROWSER_AUTH"]
			if (!seen["GOOSEBERRY_BROWSER_TOKEN"]) print "GOOSEBERRY_BROWSER_TOKEN=" value["GOOSEBERRY_BROWSER_TOKEN"]
		}
	' "$input" > "$tmp_goose_env"
	chmod 600 "$tmp_goose_env"
	mv "$tmp_goose_env" "$goose_env"
	trap - EXIT HUP INT TERM
}

[ "$#" -eq 0 ] || usage
for command in realpath grep sed awk mktemp id; do
	command -v "$command" >/dev/null 2>&1 || {
		echo "missing required command: $command" >&2
		exit 1
	}
done
if [ "$(id -u)" -eq 0 ]; then
	echo "setup must run as the non-root technical user" >&2
	exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
gooseberry_env=$script_dir/.gooseberry
if [ -L "$gooseberry_env" ] || [ ! -f "$gooseberry_env" ]; then
	echo "create a regular .gooseberry from .gooseberry.example before running setup" >&2
	exit 1
fi
validate_gooseberry_keys

if ! data_path=$(read_env_value GOOSEBERRY_DATA_PATH "$gooseberry_env"); then
	echo ".gooseberry must contain exactly one GOOSEBERRY_DATA_PATH" >&2
	exit 1
fi
[ -n "$data_path" ] || {
	echo ".gooseberry must contain a non-empty GOOSEBERRY_DATA_PATH" >&2
	exit 1
}
if ! goose_secret=$(read_env_value GOOSEBERRY_GOOSE_SECRET_KEY "$gooseberry_env"); then
	echo ".gooseberry must contain exactly one GOOSEBERRY_GOOSE_SECRET_KEY" >&2
	exit 1
fi
validate_token GOOSEBERRY_GOOSE_SECRET_KEY "$goose_secret"

auth_enabled=$(optional_env_value GOOSEBERRY_AUTH_ENABLED "$gooseberry_env")
[ -n "$auth_enabled" ] || auth_enabled=false
validate_boolean GOOSEBERRY_AUTH_ENABLED "$auth_enabled"
controller_token=$(optional_env_value GOOSEBERRY_TOKEN "$gooseberry_env")
if [ "$auth_enabled" = true ] && [ -z "$controller_token" ]; then
	echo "GOOSEBERRY_TOKEN is required when GOOSEBERRY_AUTH_ENABLED=true" >&2
	exit 1
fi
if [ -n "$controller_token" ]; then validate_token GOOSEBERRY_TOKEN "$controller_token"; fi
controller_host=$(optional_env_value GOOSEBERRY_CONTROLLER_HOST "$gooseberry_env")
[ -n "$controller_host" ] || controller_host=127.0.0.1
case "$controller_host" in
	127.0.0.1|::1|0.0.0.0|::) ;;
	*) echo "GOOSEBERRY_CONTROLLER_HOST must be 127.0.0.1, ::1, 0.0.0.0, or ::" >&2; exit 1 ;;
esac
allow_unauthenticated_remote=$(optional_env_value GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE "$gooseberry_env")
[ -n "$allow_unauthenticated_remote" ] || allow_unauthenticated_remote=false
validate_boolean GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE "$allow_unauthenticated_remote"
case "$controller_host" in
	127.0.0.1|::1) ;;
	*)
		if [ "$auth_enabled" = false ] && [ "$allow_unauthenticated_remote" = false ]; then
			echo "remote controller binding requires authentication or GOOSEBERRY_ALLOW_UNAUTHENTICATED_REMOTE=true" >&2
			exit 1
		fi
		;;
esac
# Read this optional value here to reject ambiguous entries before Compose consumes it.
optional_env_value GOOSEBERRY_PUBLIC_ORIGIN "$gooseberry_env" >/dev/null

browser_auth=$(optional_env_value GOOSEBERRY_BROWSER_AUTH "$gooseberry_env")
[ -n "$browser_auth" ] || browser_auth=false
validate_boolean GOOSEBERRY_BROWSER_AUTH "$browser_auth"
browser_token=$(optional_env_value GOOSEBERRY_BROWSER_TOKEN "$gooseberry_env")
if [ "$browser_auth" = true ] && [ -z "$browser_token" ]; then
	echo "GOOSEBERRY_BROWSER_TOKEN is required when GOOSEBERRY_BROWSER_AUTH=true" >&2
	exit 1
fi
if [ -n "$browser_token" ]; then validate_token GOOSEBERRY_BROWSER_TOKEN "$browser_token"; fi
if [ -n "$controller_token" ] && [ -n "$browser_token" ] && [ "$controller_token" = "$browser_token" ]; then
	echo "GOOSEBERRY_TOKEN and GOOSEBERRY_BROWSER_TOKEN must be distinct" >&2
	exit 1
fi

# The skill does not need a bearer value while browser authentication is disabled.
goose_browser_token=$browser_token
if [ "$browser_auth" = false ]; then goose_browser_token=; fi

validate_data_path
validate_state_layout
mkdir -p "$data_root/app" "$data_root/browser/artifacts" "$data_root/browser/state"
chmod 700 "$data_root" "$data_root/app" "$data_root/browser" "$data_root/browser/artifacts" "$data_root/browser/state"

sync_goose_env
chmod 600 "$gooseberry_env"

echo "Deployment files are ready. Start the Goose user service, then run: docker compose --env-file .gooseberry up -d --remove-orphans"
