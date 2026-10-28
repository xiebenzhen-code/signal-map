#!/usr/bin/env bash
# Run only on the intended Lighthouse host after the pinned image has loaded.
set -euo pipefail
IMAGE='ghcr.io/diygod/rsshub@sha256:5503609009925e464ddea3830844f7a77090b61b81061de6dcb80c19efc995ff'
NAME='signal-map-rsshub'
command -v docker >/dev/null
docker info >/dev/null
# Never pull implicitly or replace an existing container.
docker image inspect "$IMAGE" >/dev/null
if docker container inspect "$NAME" >/dev/null 2>&1; then
  echo "STOP: $NAME already exists; inspect it before continuing." >&2
  exit 1
fi
if ss -H -ltn 'sport = :1200' | grep -q .; then
  echo 'STOP: port 1200 is occupied.' >&2
  exit 1
fi
docker run -d --pull=never --name "$NAME" --restart unless-stopped \
  --network bridge -p 127.0.0.1:1200:1200 --cpus 0.25 --memory 512m \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  -e NODE_ENV=production -e CACHE_TYPE=memory -e CACHE_EXPIRE=3600 \
  -e REQUEST_RETRY=0 -e REQUEST_TIMEOUT=10000 -e NO_LOGFILES=true \
  "$IMAGE"
docker inspect "$NAME" --format 'image={{.Image}} running={{.State.Running}} ports={{json .HostConfig.PortBindings}}'
echo 'Container created. Running is not feed readiness; run verify-local.sh separately.'
