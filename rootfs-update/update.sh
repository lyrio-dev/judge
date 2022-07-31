#!/bin/bash -e
# Dependencies: jq, gcc, curl

CONFIG_FILE="$(dirname "${BASH_SOURCE[0]}")/config.json"
RENAMEAT2_SOURCE_FILE="$(dirname "${BASH_SOURCE[0]}")/renameat2.c"

if ! [ -f "$CONFIG_FILE" ]; then
    echo "Configuration file $CONFIG_FILE not found"
    exit 2
fi

function readConfig() {
    jq -r ".$1" "$CONFIG_FILE"
}

ROOTFS_REPO="$(readConfig rootfsRepo)"
GITHUB_TOKEN="$(readConfig githubToken)"
ROOTFS_DIR="$(readConfig rootfsDir)"
ROOTFS_OLD_DIR="$(readConfig rootfsOldDir)"
EXTRACT_DIR="$(readConfig extractDir)"

function callGitHubApi() {
    API_PATH="$1"
    shift
    curl "$@" \
         -H "Authorization: token $GITHUB_TOKEN" \
         -H "Accept: application/vnd.github+json" \
         "https://api.github.com/repos/$ROOTFS_REPO/$API_PATH"
}

# Get artifact ID
LATEST_ARTIFACT_ID="$(callGitHubApi "actions/artifacts?per_page=1" | jq -r .artifacts[0].id)"

# Download and extract artifact zip
rm -rf "$EXTRACT_DIR"
mkdir "$EXTRACT_DIR"
callGitHubApi "actions/artifacts/$LATEST_ARTIFACT_ID/zip" -L | zcat > "$EXTRACT_DIR/rootfs.tar.xz"

# Extract tar
tar -xJf "$EXTRACT_DIR/rootfs.tar.xz" -C "$EXTRACT_DIR"
rm -rf "$ROOTFS_OLD_DIR"
mkdir -p "$ROOTFS_DIR" "$ROOTFS_OLD_DIR"

# Rename file atomically
RENAMEAT2_BINARY="$(mktemp /tmp/renameat2-XXXXXXXX)"
gcc "$RENAMEAT2_SOURCE_FILE" -o "$RENAMEAT2_BINARY"
"$RENAMEAT2_BINARY" "$EXTRACT_DIR/rootfs" "$ROOTFS_OLD_DIR"
"$RENAMEAT2_BINARY" "$ROOTFS_OLD_DIR" "$ROOTFS_DIR"
rm -rf "$EXTRACT_DIR" "$RENAMEAT2_BINARY"
