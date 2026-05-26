# motor-channels — Deploy Guide (Infomaniak VPS)

## Prerequisites

- Node 22 on the VPS (already provisioned per D6 ops#1115)
- `ascendimacy` system user created
- Ports: no inbound port required (stdio MCP transport; HTTP planned V0.2)

## Option A — Direct (systemd)

```bash
# 1. Build on VPS
git clone git@github.com:ascendimacy/ascendimacy-motor.git /opt/ascendimacy/motor
cd /opt/ascendimacy/motor
npm ci
npm run build --workspace=@ascendimacy/motor-channels

# 2. Set up runtime directory
mkdir -p /opt/ascendimacy/motor-channels/dist
cp -r packages/motor-channels/dist/* /opt/ascendimacy/motor-channels/dist/
cp -r node_modules /opt/ascendimacy/motor-channels/

# 3. Configure env
cp packages/motor-channels/env.example /opt/ascendimacy/motor-channels/.env
# edit .env — paths are fine as-is if /data is mounted

# 4. Create data directories
mkdir -p /data/session /data/db /data/cards
chown -R ascendimacy: /data

# 5. Install and start service
cp packages/motor-channels/deploy/motor-channels.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now motor-channels
```

## Option B — Docker

```bash
# Build from monorepo root
docker build -f packages/motor-channels/Dockerfile -t motor-channels .

# Run (stdin required for stdio MCP transport)
docker run -i \
  -v motor-data:/data \
  --env-file packages/motor-channels/.env \
  motor-channels
```

## First run — QR scan (Baileys auth)

On first start, Baileys generates a QR code to stderr:

```bash
# systemd: watch stderr for QR
journalctl -u motor-channels -f

# docker: already on terminal stderr
```

Open WhatsApp → Linked Devices → Link a Device → scan QR.  
Auth state is persisted in `SESSION_PATH` — subsequent restarts skip QR.

## Health check

```bash
# Via MCP tool (requires orchestrator or mcp-cli):
# channel.status → { connected, lastSeen, queueDepth }

# Via logs:
journalctl -u motor-channels -f
# Look for: [motor-channels] connection: open
```

## Log monitoring

```bash
journalctl -u motor-channels -f          # live
journalctl -u motor-channels --since today  # today
journalctl -u motor-channels -n 100      # last 100 lines
```

## Cards setup

Place card package markdown files in `CARDS_PATH` (`/data/cards`):

```
/data/cards/
  carta-01.md
  carta-02.md
  ...
```

File name = cardId (lowercase alphanumeric + hyphens).
