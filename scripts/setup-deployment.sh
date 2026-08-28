#!/bin/sh
set -eu
umask 077

project_argument=${1:-}
data_argument=${2:-}
path_list_delimiter=:

usage() {
	echo "usage: $0 /absolute/project-root /absolute/data-root" >&2
	exit 2
}

validate_env_path() {
	name=$1
	value=$2
	case "$value" in
		''|*','*|*"$path_list_delimiter"*|*'
'*|*'#'*|*'$'*|*'"'*|*"'"*|*'\'*)
			echo "$name contains characters that cannot be written safely to .gooseberry" >&2
			exit 2
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

read_env_value() {
	name=$1
	file=$2
	lines=$(grep -c "^${name}=" "$file" || true)
	[ "$lines" -eq 1 ] || return 1
	sed -n "s/^${name}=//p" "$file"
}

append_env_value() {
	name=$1
	value=$2
	tmp_env=$(mktemp "${gooseberry_env}.tmp.XXXXXX")
	trap 'rm -f "$tmp_env"' EXIT HUP INT TERM
	cp "$gooseberry_env" "$tmp_env"
	printf '%s=%s\n' "$name" "$value" >> "$tmp_env"
	mv "$tmp_env" "$gooseberry_env"
	trap - EXIT HUP INT TERM
}

sync_generated_env_value() {
	name=$1
	value=$2
	lines=$(grep -c "^${name}=" "$gooseberry_env" || true)
	case "$lines" in
		0)
			append_env_value "$name" "$value"
			return
			;;
		1) ;;
		*)
			echo ".gooseberry may contain at most one $name" >&2
			exit 1
			;;
	esac
	if [ "$(read_env_value "$name" "$gooseberry_env")" = "$value" ]; then return; fi
	tmp_env=$(mktemp "${gooseberry_env}.tmp.XXXXXX")
	trap 'rm -f "$tmp_env"' EXIT HUP INT TERM
	awk -v name="$name" -v value="$value" '
		$0 ~ "^" name "=" { print name "=" value; next }
		{ print }
	' "$gooseberry_env" > "$tmp_env"
	mv "$tmp_env" "$gooseberry_env"
	trap - EXIT HUP INT TERM
}

generate_token() {
	LC_ALL=C od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

validate_token() {
	name=$1
	value=$2
	length=${#value}
	if [ "$length" -lt 32 ] || [ "$length" -gt 256 ] || ! printf '%s\n' "$value" | LC_ALL=C grep -Eq '^[[:graph:]]+$'; then
		echo ".gooseberry must contain exactly one strong $name" >&2
		exit 1
	fi
	case "$value" in
		INVALID_REPLACE_WITH_RANDOM_CONTROLLER_TOKEN|INVALID_REPLACE_WITH_RANDOM_BROWSER_TOKEN|INVALID_REPLACE_WITH_RANDOM_GOOSE_SECRET|replace-with-a-random-controller-token|replace-with-a-random-browser-token|replace-with-a-random-goose-secret|replace-with-a-random-token)
			echo ".gooseberry contains a documented placeholder token for $name" >&2
			exit 1
			;;
	esac
}

validate_auth_enabled() {
	case "$1" in
		true|false) ;;
		*)
			echo "GOOSEBERRY_AUTH_ENABLED must be exactly true or false" >&2
			exit 1
			;;
	esac
}

validate_auth_max_age_days() {
	value=$1
	case "$value" in
		''|*[!0-9]*)
			echo "GOOSEBERRY_AUTH_MAX_AGE_DAYS must be an integer from 1 to 365" >&2
			exit 1
			;;
	esac
	if [ "$value" -lt 1 ] || [ "$value" -gt 365 ]; then
		echo "GOOSEBERRY_AUTH_MAX_AGE_DAYS must be an integer from 1 to 365" >&2
		exit 1
	fi
}

paths_overlap() {
	first=$1
	second=$2
	case "$first" in "$second"|"$second"/*) return 0 ;; esac
	case "$second" in "$first"|"$first"/*) return 0 ;; esac
	return 1
}

sync_goose_env() {
	[ -n "${HOME:-}" ] || {
		echo "HOME is required to create the Goose service environment" >&2
		exit 1
	}
	case "$HOME" in
		/*) ;;
		*)
			echo "HOME must be absolute to create the Goose service environment: $HOME" >&2
			exit 1
			;;
	esac
	# systemd resolves %h itself and cannot safely follow a shell's XDG_CONFIG_HOME.
	# Always synchronize the corresponding static EnvironmentFile location.
	goose_config_dir=$HOME/.config/goose
	goose_env=$goose_config_dir/gooseberry.env
	mkdir -p "$goose_config_dir"
	chmod 700 "$goose_config_dir"
	if [ -L "$goose_env" ] || { [ -e "$goose_env" ] && [ ! -f "$goose_env" ]; }; then
		echo "Goose service environment is not a regular file: $goose_env" >&2
		exit 1
	fi
	for key in GOOSE_SERVER__SECRET_KEY GOOSEBERRY_BROWSER_URL GOOSEBERRY_BROWSER_TOKEN; do
		if [ -f "$goose_env" ] && [ "$(grep -c "^${key}=" "$goose_env" || true)" -gt 1 ]; then
			echo "Goose service environment contains duplicate $key entries: $goose_env" >&2
			exit 1
		fi
	done
	tmp_goose_env=$(mktemp "$goose_env.tmp.XXXXXX")
	trap 'rm -f "$tmp_goose_env"' EXIT HUP INT TERM
	goose_env_input=/dev/null
	if [ -f "$goose_env" ]; then goose_env_input=$goose_env; fi
	GOOSE_SYNC_SECRET=$goose_secret \
	GOOSE_SYNC_BROWSER_URL=http://127.0.0.1:8787 \
	GOOSE_SYNC_BROWSER_TOKEN=$browser_token \
	awk '
		BEGIN {
			value["GOOSE_SERVER__SECRET_KEY"] = ENVIRON["GOOSE_SYNC_SECRET"]
			value["GOOSEBERRY_BROWSER_URL"] = ENVIRON["GOOSE_SYNC_BROWSER_URL"]
			value["GOOSEBERRY_BROWSER_TOKEN"] = ENVIRON["GOOSE_SYNC_BROWSER_TOKEN"]
		}
		/^(GOOSE_SERVER__SECRET_KEY|GOOSEBERRY_BROWSER_URL|GOOSEBERRY_BROWSER_TOKEN)=/ {
			key = $0; sub(/=.*/, "", key)
			print key "=" value[key]
			seen[key] = 1
			next
		}
		{ print }
		END {
			if (!seen["GOOSE_SERVER__SECRET_KEY"]) print "GOOSE_SERVER__SECRET_KEY=" value["GOOSE_SERVER__SECRET_KEY"]
			if (!seen["GOOSEBERRY_BROWSER_URL"]) print "GOOSEBERRY_BROWSER_URL=" value["GOOSEBERRY_BROWSER_URL"]
			if (!seen["GOOSEBERRY_BROWSER_TOKEN"]) print "GOOSEBERRY_BROWSER_TOKEN=" value["GOOSEBERRY_BROWSER_TOKEN"]
		}
	' "$goose_env_input" > "$tmp_goose_env"
	chmod 600 "$tmp_goose_env"
	mv "$tmp_goose_env" "$goose_env"
	trap - EXIT HUP INT TERM
}

if [ -z "$project_argument" ] || [ -z "$data_argument" ] || [ "${project_argument#/}" = "$project_argument" ] || [ "${data_argument#/}" = "$data_argument" ]; then
	usage
fi
if ! command -v realpath >/dev/null 2>&1; then
	echo "realpath is required to validate deployment paths" >&2
	exit 1
fi
if ! command -v id >/dev/null 2>&1; then
	echo "id is required to configure the Compose runtime identity" >&2
	exit 1
fi
if ! command -v stat >/dev/null 2>&1; then
	echo "stat is required to verify Gooseberry state ownership" >&2
	exit 1
fi
gooseberry_uid=$(id -u)
gooseberry_gid=$(id -g)
case "$gooseberry_uid:$gooseberry_gid" in
	*[!0-9:]*|:*|*::*)
		echo "could not determine a numeric technical-user UID and GID" >&2
		exit 1
		;;
esac
if [ "$gooseberry_uid" -eq 0 ]; then
	echo "setup must run as the non-root technical user so Compose does not run Gooseberry as root" >&2
	exit 1
fi
validate_env_path "project directory" "$project_argument"
validate_env_path "GOOSEBERRY_DATA_PATH" "$data_argument"
if [ ! -d "$project_argument" ]; then
	echo "project directory does not exist: $project_argument" >&2
	exit 2
fi
project_root=$(realpath "$project_argument") || {
	echo "project directory could not be resolved safely: $project_argument" >&2
	exit 1
}
case "$data_argument" in */../*|*/..|*/./*|*/.)
	echo "GOOSEBERRY_DATA_PATH must not contain . or .. path segments: $data_argument" >&2
	exit 2
	;; esac
if [ -L "$data_argument" ]; then
	echo "GOOSEBERRY_DATA_PATH must not be a symlink: $data_argument" >&2
	exit 1
fi
data_root=$(canonicalize_missing_path "$data_argument") || {
	echo "GOOSEBERRY_DATA_PATH could not be resolved safely: $data_argument" >&2
	exit 1
}
if [ "$data_root" = / ]; then
	echo "GOOSEBERRY_DATA_PATH must not be /" >&2
	exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
gooseberry_env="$script_dir/.gooseberry"
legacy_pixie_env="$script_dir/.pixie"

if [ ! -e "$gooseberry_env" ] && { [ -e "$legacy_pixie_env" ] || [ -L "$legacy_pixie_env" ]; }; then
	echo "Legacy Pixie deployment configuration exists at $legacy_pixie_env. Gooseberry will not read, migrate, or remove it. Preserve it separately, then create a clean .gooseberry configuration." >&2
	exit 1
fi

if [ ! -f "$gooseberry_env" ]; then
	browser_token=$(generate_token)
	tmp_env=$(mktemp "${gooseberry_env}.tmp.XXXXXX")
	trap 'rm -f "$tmp_env"' EXIT HUP INT TERM
	{
		printf 'GOOSEBERRY_PROJECT_PATH=%s\n' "$project_argument"
		printf 'GOOSEBERRY_MOUNT_ROOTS=%s\n' "$project_argument"
		printf 'GOOSEBERRY_DATA_PATH=%s\n' "$data_argument"
		printf 'GOOSEBERRY_AUTH_ENABLED=true\n'
		printf '# Set GOOSEBERRY_TOKEN to a unique strong random token before starting Gooseberry.\n'
		printf 'GOOSEBERRY_TOKEN=\n'
		printf 'GOOSEBERRY_BROWSER_TOKEN=%s\n' "$browser_token"
		printf 'GOOSEBERRY_GOOSE_URL=ws://127.0.0.1:3284/acp\n'
		printf '# Set GOOSEBERRY_GOOSE_SECRET_KEY to the same strong value as host Goose GOOSE_SERVER__SECRET_KEY.\n'
		printf 'GOOSEBERRY_GOOSE_SECRET_KEY=\n'
	} > "$tmp_env"
	mv "$tmp_env" "$gooseberry_env"
	trap - EXIT HUP INT TERM
fi

# Compose must run with the identity that owns the host state directories. These values are
# setup-managed rather than operator configuration so stale copied values cannot silently break it.
sync_generated_env_value GOOSEBERRY_UID "$gooseberry_uid"
sync_generated_env_value GOOSEBERRY_GID "$gooseberry_gid"

for required in GOOSEBERRY_PROJECT_PATH GOOSEBERRY_MOUNT_ROOTS GOOSEBERRY_DATA_PATH; do
	if ! value=$(read_env_value "$required" "$gooseberry_env"); then
		echo ".gooseberry must contain exactly one $required" >&2
		exit 1
	fi
	[ -n "$value" ] || {
		echo ".gooseberry must contain exactly one non-empty $required" >&2
		exit 1
	}
done

configured_project=$(read_env_value GOOSEBERRY_PROJECT_PATH "$gooseberry_env")
configured_data=$(read_env_value GOOSEBERRY_DATA_PATH "$gooseberry_env")
validate_env_path "GOOSEBERRY_PROJECT_PATH" "$configured_project"
validate_env_path "GOOSEBERRY_DATA_PATH" "$configured_data"
case "$configured_project" in
	/*) ;;
	*)
		echo "GOOSEBERRY_PROJECT_PATH must be absolute: $configured_project" >&2
		exit 1
		;;
esac
case "$configured_data" in
	/*) ;;
	*)
		echo "GOOSEBERRY_DATA_PATH must be absolute: $configured_data" >&2
		exit 1
		;;
esac
case "$configured_data" in */../*|*/..|*/./*|*/.)
	echo "GOOSEBERRY_DATA_PATH must not contain . or .. path segments: $configured_data" >&2
	exit 1
;; esac
if [ -L "$configured_data" ]; then
	echo "GOOSEBERRY_DATA_PATH must not be a symlink: $configured_data" >&2
	exit 1
fi
configured_project_root=$(realpath "$configured_project") || {
	echo "GOOSEBERRY_PROJECT_PATH is missing or unresolved: $configured_project" >&2
	exit 1
}
configured_data_root=$(canonicalize_missing_path "$configured_data") || {
	echo "GOOSEBERRY_DATA_PATH could not be resolved safely: $configured_data" >&2
	exit 1
}
if [ "$configured_project_root" != "$project_root" ] || [ "$configured_data_root" != "$data_root" ]; then
	echo ".gooseberry project or data path does not match the requested deployment paths. Review it manually rather than overwriting existing values." >&2
	exit 1
fi

auth_enabled_lines=$(grep -c '^GOOSEBERRY_AUTH_ENABLED=' "$gooseberry_env" || true)
case "$auth_enabled_lines" in
	0)
		append_env_value GOOSEBERRY_AUTH_ENABLED true
		auth_enabled=true
		;;
	1)
		auth_enabled=$(read_env_value GOOSEBERRY_AUTH_ENABLED "$gooseberry_env")
		validate_auth_enabled "$auth_enabled"
		;;
	*)
		echo ".gooseberry may contain at most one GOOSEBERRY_AUTH_ENABLED" >&2
		exit 1
		;;
esac

goose_url_lines=$(grep -c '^GOOSEBERRY_GOOSE_URL=' "$gooseberry_env" || true)
case "$goose_url_lines" in
	0) append_env_value GOOSEBERRY_GOOSE_URL ws://127.0.0.1:3284/acp ;;
	1) ;;
	*)
		echo ".gooseberry may contain at most one GOOSEBERRY_GOOSE_URL" >&2
		exit 1
		;;
esac
goose_url=$(read_env_value GOOSEBERRY_GOOSE_URL "$gooseberry_env")
if [ "$goose_url" != 'ws://127.0.0.1:3284/acp' ]; then
	echo "GOOSEBERRY_GOOSE_URL must be ws://127.0.0.1:3284/acp for the host-native Goose deployment" >&2
	exit 1
fi

browser_token_lines=$(grep -c '^GOOSEBERRY_BROWSER_TOKEN=' "$gooseberry_env" || true)
case "$browser_token_lines" in
	0) append_env_value GOOSEBERRY_BROWSER_TOKEN "$(generate_token)" ;;
	1) ;;
	*)
		echo ".gooseberry may contain at most one GOOSEBERRY_BROWSER_TOKEN" >&2
		exit 1
		;;
esac

for required in GOOSEBERRY_GOOSE_SECRET_KEY GOOSEBERRY_BROWSER_TOKEN; do
	if ! value=$(read_env_value "$required" "$gooseberry_env"); then
		echo ".gooseberry must contain exactly one $required" >&2
		exit 1
	fi
	validate_token "$required" "$value"
done
browser_token=$(read_env_value GOOSEBERRY_BROWSER_TOKEN "$gooseberry_env")
goose_secret=$(read_env_value GOOSEBERRY_GOOSE_SECRET_KEY "$gooseberry_env")

controller_token_lines=$(grep -c '^GOOSEBERRY_TOKEN=' "$gooseberry_env" || true)
case "$controller_token_lines" in
	0) controller_token= ;;
	1)
		controller_token=$(read_env_value GOOSEBERRY_TOKEN "$gooseberry_env")
		if [ -n "$controller_token" ]; then validate_token GOOSEBERRY_TOKEN "$controller_token"; fi
		;;
	*)
		echo ".gooseberry may contain at most one GOOSEBERRY_TOKEN" >&2
		exit 1
		;;
esac
if [ "$auth_enabled" = true ] && [ -z "$controller_token" ]; then
	echo "GOOSEBERRY_TOKEN is required when GOOSEBERRY_AUTH_ENABLED=true. Set a unique strong GOOSEBERRY_TOKEN in .gooseberry, then rerun setup." >&2
	exit 1
fi
if [ -n "$controller_token" ] && [ "$controller_token" = "$browser_token" ]; then
	echo ".gooseberry controller and browser tokens must be distinct" >&2
	exit 1
fi

auth_max_age_lines=$(grep -c '^GOOSEBERRY_AUTH_MAX_AGE_DAYS=' "$gooseberry_env" || true)
case "$auth_max_age_lines" in
	0) ;;
	1) validate_auth_max_age_days "$(read_env_value GOOSEBERRY_AUTH_MAX_AGE_DAYS "$gooseberry_env")" ;;
	*)
		echo ".gooseberry may contain at most one GOOSEBERRY_AUTH_MAX_AGE_DAYS" >&2
		exit 1
		;;
esac

mount_roots=$(read_env_value GOOSEBERRY_MOUNT_ROOTS "$gooseberry_env") || {
	echo ".gooseberry must contain exactly one GOOSEBERRY_MOUNT_ROOTS" >&2
	exit 1
}
separator=$path_list_delimiter
case "$mount_roots" in
	*','*"$path_list_delimiter"*)
		echo "GOOSEBERRY_MOUNT_ROOTS must not mix comma and $path_list_delimiter separators" >&2
		exit 1
		;;
esac
case "$mount_roots" in *,*) separator=, ;; esac
case "$mount_roots" in
	''|"$separator"*|*"$separator"|*"$separator$separator"*)
		echo "GOOSEBERRY_MOUNT_ROOTS must not contain empty entries" >&2
		exit 1
		;;
esac
old_ifs=$IFS
IFS=$separator
set -f
set -- $mount_roots
set +f
IFS=$old_ifs
canonical_mount_roots=
for mount_root do
	case "$mount_root" in
		/*) validate_env_path "GOOSEBERRY_MOUNT_ROOTS entries" "$mount_root" ;;
		*)
			echo "GOOSEBERRY_MOUNT_ROOTS entries must be absolute: $mount_root" >&2
			exit 1
			;;
	esac
	canonical_mount_root=$(realpath "$mount_root") || {
		echo "GOOSEBERRY_MOUNT_ROOTS entry is missing or unresolved: $mount_root" >&2
		exit 1
	}
	case ",$canonical_mount_roots," in
		*",$canonical_mount_root,"*)
			echo "GOOSEBERRY_MOUNT_ROOTS must not contain duplicate entries: $mount_root" >&2
			exit 1
			;;
	esac
	if paths_overlap "$configured_data_root" "$canonical_mount_root"; then
		echo "GOOSEBERRY_DATA_PATH must be disjoint from every GOOSEBERRY_MOUNT_ROOTS entry" >&2
		exit 1
	fi
	if [ -n "$canonical_mount_roots" ]; then
		canonical_mount_roots=$canonical_mount_roots,$canonical_mount_root
	else
		canonical_mount_roots=$canonical_mount_root
	fi
done
if paths_overlap "$configured_data_root" "$configured_project_root"; then
	echo "GOOSEBERRY_DATA_PATH must be disjoint from GOOSEBERRY_PROJECT_PATH" >&2
	exit 1
fi

if [ -e "$configured_data_root" ] && [ ! -d "$configured_data_root" ]; then
	echo "GOOSEBERRY_DATA_PATH is not a directory: $configured_data" >&2
	exit 1
fi
if [ -e "$configured_data_root/pixie" ] || [ -L "$configured_data_root/pixie" ]; then
	echo "Legacy Pixie runtime state exists at $configured_data_root/pixie. Gooseberry will not migrate or remove it. Preserve it separately, then use a new empty GOOSEBERRY_DATA_PATH." >&2
	exit 1
fi
if [ -d "$configured_data_root/gooseberry" ] && { [ ! -d "$configured_data_root/gooseberry/app" ] || [ ! -d "$configured_data_root/gooseberry/browser" ]; }; then
	echo "Breaking deployment layout: $configured_data_root/gooseberry must contain only established app and browser state. Setup will not migrate or remove existing data." >&2
	exit 1
fi
if [ -d "$configured_data_root" ] && [ ! -d "$configured_data_root/gooseberry" ] && [ -n "$(find "$configured_data_root" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
	echo "GOOSEBERRY_DATA_PATH is a non-empty directory not recognized as the Goose deployment layout: $configured_data" >&2
	exit 1
fi

# Only synchronize the user service environment after all .gooseberry and layout checks pass.
sync_goose_env

mkdir -p \
	"$configured_data_root/gooseberry/app" \
	"$configured_data_root/gooseberry/browser/artifacts" \
	"$configured_data_root/gooseberry/browser/state"
chmod 700 \
	"$configured_data_root" \
	"$configured_data_root/gooseberry" \
	"$configured_data_root/gooseberry/app" \
	"$configured_data_root/gooseberry/browser" \
	"$configured_data_root/gooseberry/browser/artifacts" \
	"$configured_data_root/gooseberry/browser/state"
for state_path in \
	"$configured_data_root/gooseberry/app" \
	"$configured_data_root/gooseberry/browser" \
	"$configured_data_root/gooseberry/browser/artifacts" \
	"$configured_data_root/gooseberry/browser/state"; do
	state_owner=$(stat -c '%u' "$state_path") || {
		echo "could not inspect Gooseberry state ownership: $state_path" >&2
		exit 1
	}
	if [ "$state_owner" != "$gooseberry_uid" ]; then
		echo "Gooseberry state must be owned by technical user UID $gooseberry_uid: $state_path" >&2
		exit 1
	fi
done
chmod 600 "$gooseberry_env"

echo "Deployment files are ready. Install and start host-native Goose separately; setup does not perform privileged installation. Goose must run /usr/local/bin/goose serve --enable-scheduler on loopback and use the same GOOSE_SERVER__SECRET_KEY as GOOSEBERRY_GOOSE_SECRET_KEY in .gooseberry."
echo "Then run: docker compose --env-file .gooseberry up -d --remove-orphans"
