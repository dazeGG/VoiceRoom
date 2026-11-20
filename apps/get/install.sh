#!/bin/sh
# This file is both the streamed installer and the installed voiceroom command.
set +x
set -eu
umask 077
LC_ALL=C
export LC_ALL

install_dir=${VOICEROOM_HOME:-/opt/voiceroom}
bin=${VOICEROOM_BIN_DIR:-/usr/local/bin}
release_base=${VOICEROOM_RELEASE_BASE:-https://github.com/dazeGG/VoiceRoom/releases}
duckdns_url=${VOICEROOM_DUCKDNS_URL:-https://www.duckdns.org}
desec_url=${VOICEROOM_DESEC_URL:-https://desec.io/api/v1}
env_file=$install_dir/.env
current=$install_dir/current
recovery=$install_dir/.upgrade
work=
rollback_upgrade=false
rollback_domain=false
rollback_dns=false
terminal=false

say() { printf '%s\n' "$*" >&2; }
fail() { say "VoiceRoom: $*"; exit 1; }

usage() {
  cat <<'EOF'
voiceroom install [--version vX.Y.Z] [--provider duckdns|desec|own] [--domain NAME]
voiceroom upgrade [vX.Y.Z]
voiceroom domain set [--provider duckdns|desec|own] [--domain NAME]
voiceroom domain show
voiceroom status
voiceroom owner-link [--rotate]
EOF
}

http() {
  curl --disable --silent --fail --connect-timeout 8 --max-time 60 "$@" 2>/dev/null
}

download_release() {
  case $release_base in
    https://*) http --proto '=https' --proto-redir '=https' --location "$@" ;;
    http://*) http --proto '=http' --proto-redir '=http' --location "$@" ;;
    *) return 1 ;;
  esac
}

open_terminal() {
  if [ "$terminal" = false ]; then
    { exec 3<>/dev/tty; } 2>/dev/null ||
      fail 'An interactive terminal is required. Run this command from an SSH session with a TTY.'
    terminal=true
  fi
}

prompt() {
  open_terminal
  printf '%s' "$1" >&3
  IFS= read -r answer <&3 || fail 'Input was closed.'
}

read_token() {
  if [ -z "$token" ]; then
    open_terminal
    tty_mode=$(stty -g <&3) || fail 'Cannot read terminal settings.'
    stty -echo <&3 || fail 'Cannot hide token input.'
    printf '%s API token: ' "$provider" >&3
    IFS= read -r token <&3 || fail 'Input was closed.'
    stty "$tty_mode" <&3
    tty_mode=
    printf '\n' >&3
  fi
  case $token in
    ''|*[!a-zA-Z0-9_.-]*) fail 'Enter a valid DNS provider token.' ;;
  esac
}

require_docker() {
  if ! docker compose version >/dev/null 2>&1; then
    [ "$1" = install ] || fail 'Install Docker Engine and the Docker Compose plugin.'
    prompt 'Install Docker Engine and Compose using https://get.docker.com? [y/N] '
    case $answer in y|Y|yes|YES) ;; *) fail 'Docker and Compose are required.' ;; esac
    http --location --proto '=https' --proto-redir '=https' https://get.docker.com -o "$work/docker.sh" ||
      fail 'Could not download the official Docker installer.'
    sh "$work/docker.sh" </dev/null >/dev/null 2>&1 9>&- || fail 'The official Docker installer failed.'
  fi
  docker info >/dev/null 2>&1 || fail 'Start Docker Engine and check local Docker access.'
  docker compose up --help 2>/dev/null | grep -q -- '--wait-timeout' ||
    fail 'Update the Docker Compose plugin to a version that supports --wait and --wait-timeout.'
}

compose() (
  # Compose gives ambient variables precedence over --env-file.
  unset PERSONAL_DOMAIN PERSONAL_ORIGIN PERSONAL_CADDY_SITE PERSONAL_SIGNAL_URL PERSONAL_BIND_HOST \
    PERSONAL_HTTP_PORT PERSONAL_HTTPS_PORT PERSONAL_RTC_TCP_PORT PERSONAL_RTC_UDP_PORT \
    PERSONAL_LIVEKIT_EXTERNAL_IP PERSONAL_LIVEKIT_NODE_IP PERSONAL_ROOM_IDLE_TTL_MS \
    PERSONAL_ROOM_PRUNE_INTERVAL_MS PERSONAL_POSTGRES_PASSWORD PERSONAL_GATE_SECRET \
    PERSONAL_LIVEKIT_API_KEY PERSONAL_LIVEKIT_API_SECRET COMPOSE_PROFILES COMPOSE_ENV_FILES COMPOSE_REMOVE_ORPHANS
  compose_bundle=$1
  compose_env=$2
  shift 2
  docker compose --project-name voiceroom-personal --env-file "$compose_env" \
    -f "$compose_bundle/docker-compose.personal.yml" "$@" 2>/dev/null
)

version_valid() {
  case $1 in ''|*[!v0-9.]*) return 1 ;; esac
  printf '%s\n' "$1" | grep -Exq 'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)'
}

manifest_version() {
  jq -ers '
    if length == 1 and (.[0] |
      .schemaVersion == 1 and (.version | type == "string") and
      (.files | keys == ["docker-compose.personal.yml", "install.sh"]
        and all(.[]; test("^[a-f0-9]{64}$"))) and
      (.images | keys == ["api", "caddy", "livekit", "postgres"]
        and all(.[]; test("^[a-z0-9._:/-]+@sha256:[a-f0-9]{64}$"))))
    then .[0].version else error("invalid manifest") end
  ' "$1" 2>/dev/null
}

verify_asset() {
  hash=$(jq -er --arg file "$2" '.files[$file]' "$1/manifest.json" 2>/dev/null) || return 1
  sum=$(sha256sum < "$1/$2" 2>/dev/null) || return 1
  [ "${sum%% *}" = "$hash" ]
}

read_bundle() {
  bundle_version=$(manifest_version "$1/manifest.json") &&
    version_valid "$bundle_version" &&
    verify_asset "$1" docker-compose.personal.yml && verify_asset "$1" install.sh
}

fetch_bundle() {
  requested=$1
  if [ -z "$requested" ]; then
    download_release "$release_base/latest/download/manifest.json" -o "$work/latest.json" ||
      fail 'No current installer release is available.'
    requested=$(manifest_version "$work/latest.json") || fail 'Invalid latest release manifest.'
  fi
  version_valid "$requested" || fail 'Use a release version such as v2.15.0.'
  mkdir "$work/bundle"
  for asset in manifest.json docker-compose.personal.yml install.sh; do
    download_release "$release_base/download/$requested/$asset" -o "$work/bundle/$asset" ||
      fail "Could not download $asset for $requested."
  done
  if ! read_bundle "$work/bundle" || [ "$bundle_version" != "$requested" ]; then
    fail 'Release manifest or SHA-256 integrity check failed.'
  fi
  candidate=$install_dir/bundles/$requested
  if [ -e "$candidate" ]; then
    if ! cmp -s "$work/bundle/manifest.json" "$candidate/manifest.json" || ! read_bundle "$candidate"; then
      fail "Cached bundle for $requested differs from the release."
    fi
  else
    mkdir -p "$install_dir/bundles"
    mv "$work/bundle" "$candidate"
  fi
}

validate_images() {
  compose "$1" "$2" config --format json > "$work/compose.json" &&
    jq -e --slurpfile manifest "$1/manifest.json" '
      $manifest[0].images as $images | .services |
      keys == ["api", "caddy", "livekit", "livekit-gate", "migrate", "postgres"] and
      all(.[]; has("build") | not) and
      .api.image == $images.api and .migrate.image == $images.api and
      ."livekit-gate".image == $images.api and .caddy.image == $images.caddy and
      .livekit.image == $images.livekit and .postgres.image == $images.postgres
    ' "$work/compose.json" >/dev/null 2>&1
}

activate() {
  ln -s "$1" "$work/current" && mv -Tf "$work/current" "$current"
}

install_cli() {
  mkdir -p "$bin" || return 1
  cli_temp=$(mktemp "$bin/.voiceroom.XXXXXX") || return 1
  if install -m 755 "$1/install.sh" "$cli_temp" && mv -Tf "$cli_temp" "$bin/voiceroom"; then
    return 0
  fi
  rm -f "$cli_temp"
  return 1
}

settings() {
  provider=
  domain=
  version=
  while [ "$#" -gt 0 ]; do
    [ "$#" -ge 2 ] || fail 'Missing option value. See voiceroom --help.'
    case $1 in
      --provider) provider=$2 ;;
      --domain) domain=$2 ;;
      --version) [ "$operation" = install ] || fail 'Use upgrade to change the release.'; version=$2 ;;
      *) fail 'Unknown option. See voiceroom --help.' ;;
    esac
    shift 2
  done
}

valid_domain() {
  case $1 in ''|*[!a-z0-9.-]*) return 1 ;; esac
  [ "${#1}" -le 253 ] && printf '%s\n' "$1" |
    grep -Exq '([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?'
}

select_domain() {
  if [ -z "$provider" ]; then
    prompt 'DNS provider [1 DuckDNS (default), 2 deSEC, 3 own domain]: '
    case $answer in
      ''|1) provider=duckdns ;;
      2) provider=desec ;;
      3) provider=own ;;
      *) fail 'Select DuckDNS, deSEC or own domain.' ;;
    esac
  fi
  if [ -z "$domain" ]; then
    case $provider in
      duckdns) prompt 'Enter the name you created at duckdns.org: ' ;;
      desec) prompt 'Enter the domain you registered with deSEC (such as your-name.dedyn.io): ' ;;
      own) prompt 'Enter your domain name: ' ;;
      *) fail 'Use --provider duckdns, desec or own.' ;;
    esac
    domain=$answer
  fi
  domain=$(printf '%s' "${domain%.}" | tr '[:upper:]' '[:lower:]')
  case $provider in
    duckdns)
      case $domain in
        *.duckdns.org) ;;
        *.*) fail 'Enter a DuckDNS name ending in .duckdns.org.' ;;
        *) domain=$domain.duckdns.org ;;
      esac
      # DuckDNS resolves nested names to the address of the registered label.
      label=${domain%.duckdns.org}
      label=${label##*.}
      ;;
    desec|own) ;;
    *) fail 'Use --provider duckdns, desec or own.' ;;
  esac
  valid_domain "$domain" || fail 'Enter a valid public DNS name.'
  if [ "$provider" != own ]; then read_token; fi
}

valid_ipv4() {
  case $1 in ''|*[!0-9.]*) return 1 ;; esac
  printf '%s\n' "$1" | awk -F. '
    NF != 4 { exit 1 }
    { for (i = 1; i <= 4; i++) if ($i !~ /^(0|[1-9][0-9]?[0-9]?)$/ || $i > 255) exit 1 }
  '
}

duckdns_write() {
  if [ -n "$1" ]; then
    action="ip=$1"
  else
    action='clear=true'
  fi
  response=$(printf 'data-urlencode = "token=%s"\n' "$token" |
    http --config - --get --data-urlencode "domains=$label" --data-urlencode "$action" "$duckdns_url/update") ||
    return 1
  [ "$response" = OK ]
}

duckdns_record() {
  result=$(dig "@$duckdns_ns" +time=2 +tries=1 +norecurse +noall +comments +answer "$label.duckdns.org." "$1" 2>/dev/null) ||
    return 1
  printf '%s\n' "$result" | grep -Eq 'status: (NOERROR|NXDOMAIN),' || return 1
  printf '%s\n' "$result" | grep -Eq '^;; flags:.*[[:space:]]aa[[:space:];]' || return 1
  printf '%s\n' "$result" | awk -v record="$1" '$3 == "IN" && $4 == record { print $5 }'
}

desec_request() {
  # The header is passed on stdin so the token is never a process argument.
  printf 'header = "Authorization: Token %s"\n' "$token" |
    curl --disable --silent --connect-timeout 8 --max-time 60 --config - \
      --output "$work/desec-response.json" --write-out '%{http_code}' "$@" 2>/dev/null
}

desec_write() {
  code=$(desec_request --request PUT --header 'Content-Type: application/json' \
    --data-binary "@$1" "$desec_url/domains/$domain/rrsets/") || return 1
  case $code in 200|201|204) return 0 ;; *) return 1 ;; esac
}

prepare_dns() {
  if ! ip=$(http --ipv4 "${VOICEROOM_IP_URL:-https://api.ipify.org}") || ! valid_ipv4 "$ip"; then
    fail 'Could not determine the public IPv4 address of this server.'
  fi
  case $provider in
    duckdns)
      duckdns_ns=$(dig +time=2 +tries=1 +short duckdns.org. NS 2>/dev/null | awk 'NR == 1 {print $1}')
      if [ -z "$duckdns_ns" ] || ! old_a=$(duckdns_record A) || ! old_aaaa=$(duckdns_record AAAA); then
        fail 'Could not read the current DuckDNS records from an authoritative server.'
      fi
      [ -z "$old_aaaa" ] || fail 'Remove the DuckDNS AAAA record before installing on this IPv4 server.'
      if [ -n "$old_a" ]; then valid_ipv4 "$old_a" || fail 'Unexpected DuckDNS A record.'; fi
      rollback_dns=true
      duckdns_write "$ip" || fail 'DuckDNS rejected the update. Check the registered name and API token.'
      ;;
    desec)
      code=$(desec_request "$desec_url/domains/$domain/rrsets/@/A/") ||
        fail 'Could not access the deSEC zone.'
      case $code in
        200)
          jq -e 'select((.ttl | type == "number") and (.records | type == "array")) |
            [{subname:"", type:"A", ttl, records}]' \
            "$work/desec-response.json" > "$work/dns-before.json" 2>/dev/null ||
            fail 'deSEC returned an invalid A record.'
          ;;
        404) printf '%s\n' '[{"subname":"","type":"A","ttl":3600,"records":[]}]' > "$work/dns-before.json" ;;
        *) fail 'deSEC could not read the A record. Check the domain and API token.' ;;
      esac
      jq --arg ip "$ip" '.[0].records = [$ip]' "$work/dns-before.json" > "$work/dns-after.json"
      rollback_dns=true
      desec_write "$work/dns-after.json" || fail 'deSEC rejected the A record update.'
      ;;
  esac
  say "Checking DNS for $domain ($ip)…"
  attempts=${VOICEROOM_DNS_WAIT:-36}
  while [ "$attempts" -gt 0 ]; do
    if resolved=$(dig +time=2 +tries=1 +short "$domain." A 2>/dev/null) &&
      [ "$resolved" = "$ip" ] &&
      ipv6=$(dig +time=2 +tries=1 +short "$domain." AAAA 2>/dev/null) && [ -z "$ipv6" ]; then
      return
    fi
    attempts=$((attempts - 1))
    if [ "$attempts" -gt 0 ]; then sleep 5; fi
  done
  fail "DNS must resolve $domain to $ip with no AAAA record. Check the records and allow for DNS propagation."
}

restore_dns() {
  case $provider in
    duckdns) duckdns_write "$old_a" ;;
    desec) desec_write "$work/dns-before.json" ;;
  esac
}

check_ports() {
  for port in 80 443 7881 7882; do
    protocol=tcp
    filter=-ltn
    if [ "$port" = 7882 ]; then protocol=udp; filter=-aun; fi
    bound=$(ss -H "$filter" "sport = :$port" 2>/dev/null) || fail 'Could not check local ports using ss.'
    [ -z "$bound" ] || fail "Local port $port/$protocol is already in use."
  done
}

check_project() {
  project_label='label=com.docker.compose.project=voiceroom-personal'
  if ! existing_containers=$(docker ps --all --quiet --filter "$project_label" 2>/dev/null) ||
    ! existing_volumes=$(docker volume ls --quiet --filter "$project_label" 2>/dev/null); then
    fail 'Could not check for an existing personal Compose project.'
  fi
  [ -z "$existing_containers$existing_volumes" ] ||
    fail 'A personal Compose project already exists. Restore its installer environment before continuing.'
}

get_setting() {
  awk -F= -v key="$1" '$1 == key { value = substr($0, length(key) + 2) } END { print value }' "$env_file"
}

load_installation() {
  if [ ! -f "$env_file" ] || ! read_bundle "$current"; then
    fail 'Run voiceroom install first, or restore the installed bundle.'
  fi
  active=$(readlink "$current") || fail 'Cannot locate the active bundle.'
  installed_domain=$(get_setting PERSONAL_DOMAIN)
  installed_provider=$(get_setting VR_DNS_PROVIDER)
  valid_domain "$installed_domain" || fail 'Invalid PERSONAL_DOMAIN in the installation environment.'
  case $installed_provider in own|duckdns|desec) ;; *) fail 'Invalid DNS provider in the installation environment.' ;; esac
}

start_stack() {
  compose "$1" "$2" up -d --wait --wait-timeout 120 --no-build --pull never >/dev/null
}

edge_ready() {
  host_to_check=$1
  health_attempts=${VOICEROOM_HEALTH_WAIT:-36}
  while [ "$health_attempts" -gt 0 ]; do
    if health_code=$(http --noproxy '*' --resolve "$host_to_check:443:127.0.0.1" \
      --output /dev/null --write-out '%{http_code}' "https://$host_to_check/api/readyz") &&
      [ "$health_code" = 200 ]; then return 0; fi
    health_attempts=$((health_attempts - 1))
    if [ "$health_attempts" -gt 0 ]; then sleep 5; fi
  done
  return 1
}

owner_link() {
  link=$(compose "$current" "$env_file" exec -T api node apps/api/src/scripts/owner-link.ts "$@") || return 1
  case $link in "https://$installed_domain/#owner="*) ;; *) return 1 ;; esac
  owner_token=${link#*#owner=}
  case $owner_token in ''|*[!a-zA-Z0-9_-]*) return 1 ;; esac
  printf '%s\n' "$link"
}

write_env() {
  # Generate independently before writing, so a failed generator cannot leave a partial .env.
  if ! postgres_password=$(openssl rand -hex 32 2>/dev/null) ||
    ! gate_secret=$(openssl rand -hex 32 2>/dev/null) ||
    ! livekit_key=$(openssl rand -hex 16 2>/dev/null) ||
    ! livekit_secret=$(openssl rand -hex 32 2>/dev/null); then
    fail 'Could not generate installation secrets.'
  fi
  cat > "$work/.env" <<EOF
PERSONAL_DOMAIN=$domain
VR_DNS_PROVIDER=$provider
PERSONAL_POSTGRES_PASSWORD=$postgres_password
PERSONAL_GATE_SECRET=$gate_secret
PERSONAL_LIVEKIT_API_KEY=$livekit_key
PERSONAL_LIVEKIT_API_SECRET=$livekit_secret
EOF
}

install_stack() {
  if [ -f "$env_file" ]; then
    load_installation
    [ -z "$version" ] || [ "$version" = "$bundle_version" ] || fail 'Use voiceroom upgrade to change the release.'
    [ -z "$provider$domain" ] || say 'Using the installed domain. Use voiceroom domain set to change it.'
    say 'Reusing the active release and installation environment.'
    install_cli "$current" || fail 'Could not install the voiceroom command.'
  else
    check_project
    check_ports
    fetch_bundle "$version"
    select_domain
    write_env
    validate_images "$candidate" "$work/.env" || fail 'The release Compose images do not match its manifest.'
    prepare_dns
    if ! activate "$candidate" || ! install_cli "$candidate" || ! ln -T "$work/.env" "$env_file"; then
      fail 'Could not save the installation.'
    fi
    rollback_dns=false
    installed_domain=$domain
  fi
  say 'Pulling the pinned images and starting the personal stack…'
  compose "$current" "$env_file" pull >/dev/null || fail 'Image pull failed. Check registry access and rerun install.'
  start_stack "$current" "$env_file" || fail 'The stack did not become healthy. Run voiceroom status.'
  edge_ready "$installed_domain" ||
    fail 'HTTPS readiness failed. Check DNS, the TLS certificate and inbound TCP ports 80 and 443, then rerun install.'
  say 'Local HTTPS is ready. Test inbound TCP 7881 and UDP 7882 from another network.'
  printf 'Meet: https://%s/\n' "$installed_domain"
  if link=$(owner_link); then
    printf 'Private owner link: %s\n' "$link"
  else
    say 'Owner link unavailable. Issue a new one with voiceroom owner-link --rotate.'
  fi
}

backup_config() {
  mkdir -p "$install_dir/backups" &&
    backup=$(mktemp -d "$install_dir/backups/previous.XXXXXX") &&
    cp "$env_file" "$backup/.env" && cp "$current/manifest.json" "$backup/manifest.json"
}

stop_writers() {
  compose "$1" "$env_file" stop caddy api livekit-gate >/dev/null
}

recover_upgrade() {
  [ -f "$recovery/target" ] || return 1
  active=$(readlink "$current") || return 1
  if [ "$active" != "$(cat "$recovery/target")" ]; then
    say 'Restoring the previous release…'
    if [ -f "$recovery/database.dump" ]; then
      stop_writers "$active" &&
        compose "$active" "$env_file" up -d --wait --wait-timeout 120 --no-build --pull never postgres >/dev/null &&
        compose "$active" "$env_file" exec -T postgres pg_restore --clean --if-exists --create --exit-on-error \
          --username=voice_room --dbname=postgres < "$recovery/database.dump" >/dev/null || return 1
    fi
    start_stack "$active" "$env_file" && edge_ready "$installed_domain" || return 1
    say 'Previous release is healthy.'
  fi
  install_cli "$active" && rm -rf "$recovery"
}

upgrade_stack() {
  old_version=$bundle_version
  fetch_bundle "${1:-}"
  if [ "$candidate" = "$active" ]; then
    say "$old_version is already installed."
    return
  fi
  validate_images "$candidate" "$env_file" || fail 'The release Compose images do not match its manifest.'
  backup_config || fail 'Could not back up the installation environment and manifest.'
  say "Pulling $bundle_version. The server will stop accepting calls during the upgrade."
  compose "$candidate" "$env_file" pull >/dev/null || fail 'Image pull failed. The previous release is still active.'
  mkdir "$work/upgrade"
  printf '%s\n' "$candidate" > "$work/upgrade/target"
  rollback_upgrade=true
  mv "$work/upgrade" "$recovery"
  stop_writers "$active" || fail 'Could not stop the stack for migration.'
  if ! compose "$active" "$env_file" exec -T postgres pg_dump --format=custom --username=voice_room voice_room \
    > "$recovery/partial.dump" || ! mv "$recovery/partial.dump" "$recovery/database.dump"; then
    fail 'Could not snapshot PostgreSQL.'
  fi
  if ! compose "$candidate" "$env_file" up -d --wait --wait-timeout 120 --no-build --pull never postgres >/dev/null ||
    ! compose "$candidate" "$env_file" run --rm -T --no-deps --pull never migrate >/dev/null ||
    ! start_stack "$candidate" "$env_file" || ! edge_ready "$installed_domain"; then
    fail 'Upgrade failed during migration or readiness checks.'
  fi
  activate "$candidate" || fail 'Could not activate the new release.'
  recover_upgrade || fail 'Upgrade is active, but local cleanup needs to be retried.'
  rollback_upgrade=false
  say "Upgraded to $bundle_version."
}

change_domain() {
  select_domain
  awk '!/^(PERSONAL_DOMAIN|VR_DNS_PROVIDER|PERSONAL_ORIGIN|PERSONAL_CADDY_SITE|PERSONAL_SIGNAL_URL)=/' \
    "$env_file" > "$work/.env"
  printf 'PERSONAL_DOMAIN=%s\nVR_DNS_PROVIDER=%s\n' "$domain" "$provider" >> "$work/.env"
  validate_images "$current" "$work/.env" || fail 'Could not render Compose for the new domain.'
  prepare_dns
  rollback_domain=true
  if ! start_stack "$current" "$work/.env" || ! edge_ready "$domain"; then
    fail 'The stack did not become ready on the new domain.'
  fi
  mv -Tf "$work/.env" "$env_file" || fail 'Could not save the new domain.'
  rollback_domain=false
  rollback_dns=false
  printf 'Meet: https://%s/\n' "$domain"
}

status() {
  printf 'Version: %s\nDomain: %s\n' "$bundle_version" "$installed_domain"
  compose "$current" "$env_file" ps --all --format json > "$work/status.json" ||
    fail 'Could not read container status.'
  jq -rs '
    flatten[] | [.Service, .State, (.Health // "")] |
    map(if type == "string" and test("^[a-z0-9-]{0,32}$") then . else "unknown" end) |
    join(" ")
  ' "$work/status.json" 2>/dev/null || fail 'Could not read container status.'
  edge_ready "$installed_domain" || fail 'HTTPS is not ready.'
  say 'HTTPS is ready.'
}

finish() {
  result=$?
  trap - 0
  trap '' HUP INT TERM
  if [ -n "${tty_mode:-}" ]; then stty "$tty_mode" <&3 || :; printf '\n' >&3; fi
  if [ "$rollback_domain" = true ] && [ ! -f "$work/.env" ]; then
    rollback_domain=false
    rollback_dns=false
  fi
  if [ "$operation" = install ] && [ "$rollback_dns" = true ] && [ -f "$env_file" ]; then
    if [ "$(stat -c '%d:%i' "$env_file")" = "$(stat -c '%d:%i' "$work/.env")" ]; then rollback_dns=false; fi
  fi
  if [ "$rollback_dns" = true ]; then
    restore_dns || say 'Could not restore the former DNS record. Check the DNS provider.'
  fi
  if [ "$rollback_domain" = true ]; then
    if start_stack "$current" "$env_file" && edge_ready "$installed_domain"; then
      say 'Previous domain is healthy.'
    else
      say 'Could not restore the previous domain. Rerun voiceroom install with the saved environment.'
    fi
  fi
  if [ "$rollback_upgrade" = true ] && [ -d "$recovery" ]; then
    recover_upgrade || say 'Could not restore the previous release. Recovery files are private; rerun voiceroom install to retry.'
  fi
  if [ -n "$work" ]; then rm -rf "$work"; fi
  exit "$result"
}

main() {
  case ${1:-} in -h|--help|help) usage; return ;; esac
  if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
    fail 'VoiceRoom Meet requires Linux x86_64.'
  fi
  [ "$(id -u)" = 0 ] || fail 'Run the installer as root, for example: curl -fsSL https://get.voiceroom.ru | sudo sh'
  case $install_dir:$bin in /*:/*) ;; *) fail 'Use absolute installation paths.' ;; esac
  for dependency in curl openssl jq dig ss flock sha256sum; do
    command -v "$dependency" >/dev/null 2>&1 || fail "Missing $dependency. Install the required host packages and retry."
  done
  token=${VOICEROOM_DNS_TOKEN:-}
  unset VOICEROOM_DNS_TOKEN
  operation=${1:-install}
  if [ "$#" -gt 0 ]; then
    case $1 in --*) operation=install ;; *) shift ;; esac
  elif [ "${0##*/}" = voiceroom ]; then usage; return
  fi
  case $operation in
    install) settings "$@" ;;
    upgrade)
      [ "$#" -le 1 ] || fail 'Usage: voiceroom upgrade [vX.Y.Z]'
      if [ "$#" -eq 1 ]; then version_valid "$1" || fail 'Use a release version such as v2.15.0.'; fi
      ;;
    domain)
      case ${1:-} in
        set) shift; settings "$@" ;;
        show) shift; [ "$#" -eq 0 ] || fail 'Usage: voiceroom domain show'; operation=show ;;
        *) fail 'Usage: voiceroom domain set|show' ;;
      esac
      ;;
    status) [ "$#" -eq 0 ] || fail 'Usage: voiceroom status' ;;
    owner-link)
      [ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && [ "$1" = --rotate ]; } ||
        fail 'Usage: voiceroom owner-link [--rotate]'
      ;;
    *) fail 'Unknown command. See voiceroom --help.' ;;
  esac

  mkdir -p "$install_dir"
  chmod 700 "$install_dir"
  exec 9>"$install_dir/.lock"
  flock -n 9 || fail 'Another VoiceRoom command is running.'
  trap finish 0
  trap 'exit 1' HUP INT TERM
  work=$(mktemp -d "$install_dir/.staging.XXXXXX")

  if [ "$operation" = show ]; then
    load_installation
    printf '%s (%s)\n' "$installed_domain" "$installed_provider"
    return
  fi
  require_docker "$operation"
  if [ "$operation" != install ] || [ -d "$recovery" ]; then load_installation; fi
  if [ -d "$recovery" ]; then
    case $operation in install|upgrade) ;; *) fail 'Run voiceroom install to recover the interrupted upgrade.' ;; esac
    recover_upgrade || fail 'An interrupted upgrade could not be recovered. The private snapshot is retained.'
  fi
  case $operation in
    install) install_stack ;;
    upgrade) upgrade_stack "$@" ;;
    domain) change_domain ;;
    status) status ;;
    owner-link) owner_link "$@" || fail 'Owner link unavailable. If it was used, pass --rotate to issue a new link.' ;;
  esac
}

main "$@"
