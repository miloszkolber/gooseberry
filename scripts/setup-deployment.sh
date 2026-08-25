#!/bin/sh
set -eu

project_root=${1:-}
ssh_user=${2:-core}
ssh_host=${3:-host.docker.internal}

if [ -z "$project_root" ] || [ "${project_root#/}" = "$project_root" ]; then
    echo "usage: $0 /absolute/project-root [ssh-user] [ssh-host]" >&2
    exit 2
fi
if [ ! -d "$project_root" ]; then
    echo "project directory does not exist: $project_root" >&2
    exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
secrets_dir="$script_dir/secrets"
env_file="$script_dir/.env"
key_file="$secrets_dir/mewa_ed25519"
known_hosts="$secrets_dir/known_hosts"

mkdir -p "$secrets_dir"
chmod 700 "$secrets_dir"
if [ ! -f "$key_file" ]; then
    ssh-keygen -q -t ed25519 -N "" -C "mewa-code" -f "$key_file"
fi
chmod 600 "$key_file"

if [ ! -s "$known_hosts" ]; then
    if ! ssh-keyscan -H -p 22 "$ssh_host" > "$known_hosts" 2>/dev/null; then
        : > "$known_hosts"
        echo "Could not scan $ssh_host. Add its host key to $known_hosts before starting Mewa." >&2
    fi
fi
chmod 600 "$known_hosts"

if [ ! -f "$env_file" ]; then
    browser_token=$(LC_ALL=C od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
    sed \
        -e "s|^MEWA_PROJECT_PATH=.*|MEWA_PROJECT_PATH=$project_root|" \
        -e "s|^MEWA_MOUNT_ROOTS=.*|MEWA_MOUNT_ROOTS=$project_root|" \
        -e "s|^MEWA_BROWSER_TOKEN=.*|MEWA_BROWSER_TOKEN=$browser_token|" \
        -e "s|^MEWA_SSH_HOST=.*|MEWA_SSH_HOST=$ssh_host|" \
        -e "s|^MEWA_SSH_USER=.*|MEWA_SSH_USER=$ssh_user|" \
        "$script_dir/.env.example" > "$env_file"
    chmod 600 "$env_file"
fi

echo "Deployment files are ready. Install this public key for $ssh_user on the development host:"
cat "$key_file.pub"
echo "Then run: docker compose up -d"
