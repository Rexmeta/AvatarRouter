#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/scripts run avatar:migrate-renderer
pnpm --filter @workspace/db run push
