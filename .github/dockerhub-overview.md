<p align="center">
  <img src="https://raw.githubusercontent.com/eng1n88r/overload/main/assets/banner.svg" alt="Overload — self-hosted workout builder, tracker &amp; training analytics" width="880">
</p>

# Overload

Self-hosted workout builder, tracker & training analytics. Build training plans, log sets at the
gym with a live rest timer and effort ratings, and watch strength, volume, recovery, body weight
and nutrition trends. Ships an MCP server so Claude can read your history and program your
training.

Source, screenshots and documentation: https://github.com/eng1n88r/overload

## Quick start

```bash
docker run -d --name overload \
  -p 3001:3001 \
  -v ./appdata:/data \
  -e DATABASE_URL=file:/data/overload.db \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  --restart unless-stopped \
  exbarboss/overload:latest
```

Open http://localhost:3001 and sign up — the first account becomes the admin, then registration
closes.

## Compose

```yaml
services:
  overload:
    image: exbarboss/overload:latest
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: file:/data/overload.db
      SESSION_SECRET: change-me-to-a-long-random-string
    volumes:
      - ./appdata:/data
    restart: unless-stopped
```

## Notes

- Everything lives in one SQLite file under the `/data` volume — back up that folder; nothing in
  the app ever deletes it. Migrations apply automatically on start.
- First boot seeds the 881-exercise catalog (about ten seconds).
- `linux/amd64` and `linux/arm64`.
- Tags: `latest`, plus `0.2.0` / `0.2` / `0` per release — see the changelog in the repository
  README.

MIT licensed.
