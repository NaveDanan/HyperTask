#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mkdir -p .sources
fetch_source() {
  local name=$1 url=$2 revision=$3 directory=".sources/$1"
  if [[ ! -d "$directory/.git" ]]; then
    git clone --filter=blob:none --no-checkout "$url" "$directory"
  fi
  git -C "$directory" fetch origin "$revision"
  git -C "$directory" checkout --detach "$revision"
  [[ $(git -C "$directory" rev-parse HEAD) == "$revision" ]]
}
fetch_source cloud https://github.com/AppFlowy-IO/AppFlowy-Cloud.git 592f644a24beb159d45f25a4cabc34621ef7382c
fetch_source auth https://github.com/AppFlowy-IO/auth.git 43770901225d5fb6d2a262e62412e1c223ffd85c
fetch_source web https://github.com/AppFlowy-IO/AppFlowy-Web.git 10d88d9ca498c15a30c20777b709cffb1749b4c0