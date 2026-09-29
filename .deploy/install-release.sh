#!/usr/bin/env bash
set -euo pipefail

release_id="$1"
archive="/home/harshita/tmp/goshipsy-release-${release_id}.tgz"
release_root="/opt/goshipsy/releases/${release_id}"
stage_root="/opt/goshipsy/releases/.stage-${release_id}"

if [[ ! "$release_id" =~ ^[0-9]{14}$ ]]; then
  echo "Invalid release id" >&2
  exit 2
fi
if [[ ! -f "$archive" ]]; then
  echo "Release archive not found: $archive" >&2
  exit 2
fi
if [[ -e "$release_root" || -e "$stage_root" ]]; then
  echo "Release already exists: $release_id" >&2
  exit 2
fi

mkdir -p /opt/goshipsy/releases /opt/goshipsy/shared/data "$stage_root" "$release_root"
tar -xzf "$archive" -C "$stage_root"

mv "$stage_root/dist/client" "$release_root/landing"
mv "$stage_root/client-panel/dist" "$release_root/client"
mkdir -p "$release_root/api"
mv "$stage_root/client-panel/server.mjs" "$release_root/api/server.mjs"
mv "$stage_root/client-panel/package.json" "$release_root/api/package.json"
mv "$stage_root/client-panel/package-lock.json" "$release_root/api/package-lock.json"
mv "$stage_root/admin-panel/dist" "$release_root/admin"
mv "$stage_root/.deploy/ecosystem.config.cjs" "$release_root/ecosystem.config.cjs"

install -m 0644 "$stage_root/.deploy/goshipsy.nginx" /etc/nginx/sites-available/goshipsy
ln -sfn /etc/nginx/sites-available/goshipsy /etc/nginx/sites-enabled/goshipsy
ln -sfn "$release_root" /opt/goshipsy/current

chown -R harshita:harshita /opt/goshipsy
rm -f "$stage_root/.deploy/goshipsy.nginx"
rmdir "$stage_root/dist" "$stage_root/client-panel" "$stage_root/admin-panel" "$stage_root/.deploy" "$stage_root"

nginx -t
systemctl reload nginx
