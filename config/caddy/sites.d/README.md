# Extra Caddy sites

Host-managed sites served by VoiceRoom's Caddy. The directory is mounted read-only at `/etc/caddy/sites.d`.

- Put `<name>.caddy` files here on the host. They are never committed (`.gitignore`) and survive deploys.
- Each file is imported by the `Caddyfile` at top level, so it holds ordinary site blocks.
- A syntax error stops Caddy. Validate first, then reload; see "Дополнительные сайты через Caddy" in `docs/SELF_HOSTING.md`.
