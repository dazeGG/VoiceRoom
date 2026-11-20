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
replace_dns=false

say() { printf '%s\n' "$*" >&2; }
fail() { say "VoiceRoom: $*"; exit 1; }

usage() {
  cat <<'EOF'
voiceroom install [--version vX.Y.Z] [--provider duckdns|desec|own] [--domain NAME] [--replace-dns]
voiceroom upgrade [vX.Y.Z] [--replace-dns]
voiceroom domain set [--provider duckdns|desec|own] [--domain NAME] [--replace-dns]
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

try_terminal() {
  if [ "$terminal" = false ]; then
    # A failed redirection on exec can terminate a noninteractive POSIX shell.
    ( : <>/dev/tty ) 2>/dev/null || return 1
    exec 3<>/dev/tty
    terminal=true
  fi
}

open_terminal() {
  try_terminal || fail 'An interactive terminal is required. Run this command from an SSH session with a TTY.'
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

run_compose() (
  # Compose gives ambient variables precedence over --env-file.
  unset PERSONAL_DOMAIN PERSONAL_ORIGIN PERSONAL_CADDY_SITE PERSONAL_SIGNAL_URL PERSONAL_BIND_HOST \
    PERSONAL_HTTP_PORT PERSONAL_HTTPS_PORT PERSONAL_RTC_TCP_PORT PERSONAL_RTC_UDP_PORT \
    PERSONAL_TURN_ENABLED PERSONAL_TURN_UDP_PORT PERSONAL_RELAY_PORT_FIRST PERSONAL_RELAY_PORT_LAST \
    PERSONAL_LIVEKIT_EXTERNAL_IP PERSONAL_LIVEKIT_NODE_IP PERSONAL_ROOM_IDLE_TTL_MS \
    PERSONAL_ROOM_PRUNE_INTERVAL_MS PERSONAL_POSTGRES_PASSWORD PERSONAL_GATE_SECRET \
    PERSONAL_LIVEKIT_API_KEY PERSONAL_LIVEKIT_API_SECRET COMPOSE_PROFILES COMPOSE_ENV_FILES COMPOSE_REMOVE_ORPHANS
  compose_bundle=$1
  compose_env=$2
  shift 2
  docker compose --ansi never --project-name voiceroom-personal --env-file "$compose_env" \
    -f "$compose_bundle/docker-compose.personal.yml" "$@"
)

compose() { run_compose "$@" 2>/dev/null; }

pull_images() {
  pull_attempt=1
  while ! run_compose "$1" "$2" pull --quiet >/dev/null 2> "$work/pull.stderr"; do
    if [ "$pull_attempt" -eq 3 ]; then
      # Mask literal installation secrets and discard credential fields and signed URL details.
      printf '%s\n' "$token" | awk '
        function mask(line, value,    result, at) {
          while ((at = index(line, value)) > 0) {
            result = result substr(line, 1, at - 1) "[redacted]"
            line = substr(line, at + length(value))
          }
          return result line
        }
        FILENAME == "-" { if (length) secrets[++count] = $0; next }
        FILENAME == ARGV[2] {
          if ($0 ~ /^(export[[:space:]]+)?[^=]*(PASSWORD|SECRET|TOKEN|API_KEY|CREDENTIAL)[^=]*=/) {
            value = substr($0, index($0, "=") + 1)
            sub(/^[[:space:]\047"]+/, "", value)
            sub(/[[:space:]\047"]+$/, "", value)
            if (length(value)) secrets[++count] = value
          }
          next
        }
        {
          gsub(/[[:cntrl:]]/, "", $0)
          message = tolower($0)
          if (message ~ /authorization[" ]*:/ ||
              message ~ /(password|secret|token|api[_ -]?key|credential|auth)[" ]*=/ ||
              message ~ /(^[[:space:]]*|")(password|secret|token|api[_ -]?key|credential|auth)"?[[:space:]]*:/) next
          gsub(/:\/\/[^\/[:space:]@]+@/, "://[redacted]@", $0)
          gsub(/[?#][^[:space:]]+/, "[redacted]", $0)
          for (i = 1; i <= count; i++) $0 = mask($0, secrets[i])
          print
        }
      ' - "$2" "$work/pull.stderr" | tail -n 12 >&2
      return 1
    fi
    say "Image pull attempt $pull_attempt of 3 failed. Retrying…"
    sleep "$pull_attempt"
    pull_attempt=$((pull_attempt + 1))
  done
}

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

read_turn_domain() {
  jq -er '.services.caddy.environment | if .TURN_ENABLED == "true" then .TURN_DOMAIN else "" end' "$1"
}

turn_udp_ports() {
  # The first UDP binding is direct RTC. Compose expands the relay range into individual ports.
  jq -r '[.services.livekit.ports[]? | select(.protocol == "udp") | .published][1:][]' "$1"
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
    if [ "$1" = --replace-dns ]; then
      replace_dns=true
      shift
      continue
    fi
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
  response=$(printf 'data-urlencode = "token=%s"\n' "$token" |
    http --config - --get --data-urlencode "domains=$label" "$@" "$duckdns_url/update") ||
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
    --data-binary "@$1" "$desec_url/domains/$zone/rrsets/") || return 1
  case $code in 200|201|204) return 0 ;; *) return 1 ;; esac
}

desec_snapshot() {
  code=$(desec_request "$desec_url/domains/$zone/rrsets/${1:-@}/$2/") ||
    fail 'Could not access the deSEC zone.'
  case $code in
    200) jq -e --arg subname "$1" --arg type "$2" '
      select((.ttl | type == "number") and (.records | type == "array" and all(.[]; test("^[0-9A-Fa-f:.]+$")))) |
      {subname: $subname, type: $type, ttl, records}' "$work/desec-response.json" 2>/dev/null ||
      fail "deSEC returned an invalid $2 record." ;;
    404) jq -n --arg subname "$1" --arg type "$2" '{subname: $subname, type: $type, ttl: 3600, records: []}' ;;
    *) fail "deSEC could not read the $2 record. Check the domain and API token." ;;
  esac
}

confirm_dns_replacement() {
  [ -s "$work/dns-conflicts" ] || return 0
  if [ "$replace_dns" = true ]; then
    cat "$work/dns-conflicts" >&2
    return
  fi
  if ! try_terminal; then
    cat "$work/dns-conflicts" >&2
    fail 'DNS replacement requires confirmation on a terminal or --replace-dns.'
  fi
  cat "$work/dns-conflicts" >&3
  prompt 'Replace these DNS records? [y/N] '
  case $answer in y|Y|yes|YES) ;; *) fail 'DNS records were left unchanged.' ;; esac
}

dns_matches() {
  resolved=$(dig +time=2 +tries=1 +short "$1." A 2>/dev/null) && [ "$resolved" = "$ip" ] &&
    ipv6=$(dig +time=2 +tries=1 +short "$1." AAAA 2>/dev/null) && [ -z "$ipv6" ]
}

prepare_dns() {
  if ! ip=$(http --ipv4 "${VOICEROOM_IP_URL:-https://api.ipify.org}") || ! valid_ipv4 "$ip"; then
    fail 'Could not determine the public IPv4 address of this server.'
  fi
  if [ -n "$turn_domain" ]; then
    valid_domain "$turn_domain" || fail 'The derived TURN hostname is not a valid public DNS name.'
  fi
  dns_names=$domain
  if [ "$1" = turn ]; then
    dns_names=$turn_domain
    if dns_matches "$turn_domain"; then return; fi
    if [ "$provider" != own ]; then read_token; fi
  elif [ -n "$turn_domain" ]; then
    dns_names="$domain $turn_domain"
  fi
  : > "$work/dns-conflicts"
  case $provider in
    duckdns)
      # Nested names use the same address as the registered label.
      label=${domain%.duckdns.org}
      label=${label##*.}
      duckdns_ns=$(dig +time=2 +tries=1 +short duckdns.org. NS 2>/dev/null | awk 'NR == 1 {print $1}')
      if [ -z "$duckdns_ns" ] || ! old_a=$(duckdns_record A) || ! old_aaaa=$(duckdns_record AAAA); then
        fail 'Could not read the current DuckDNS records from an authoritative server.'
      fi
      if [ -n "$old_a" ]; then valid_ipv4 "$old_a" || fail 'Unexpected DuckDNS A record.'; fi
      case $old_aaaa in *[!0-9a-fA-F:.]*) fail 'Unexpected DuckDNS AAAA record.' ;; esac
      for address in $old_a $old_aaaa; do
        if [ "$address" != "$ip" ]; then
          printf '%s currently points to %s, not this server (%s).\n' "$label.duckdns.org" "$address" "$ip" >> "$work/dns-conflicts"
        fi
      done
      confirm_dns_replacement
      rollback_dns=true
      if [ -n "$old_aaaa" ]; then
        duckdns_write --data-urlencode 'clear=true' || fail 'DuckDNS rejected the IPv6 record removal.'
      fi
      duckdns_write --data-urlencode "ip=$ip" || fail 'DuckDNS rejected the update. Check the registered name and API token.'
      ;;
    desec)
      zone=$domain
      case $domain in
        *.dedyn.io)
          suffix=${domain%.dedyn.io}
          zone=${suffix##*.}.dedyn.io
          ;;
      esac
      for dns_name in $dns_names; do
        subname=${dns_name%"$zone"}
        desec_snapshot "${subname%.}" A >> "$work/dns-records.json"
        desec_snapshot "${subname%.}" AAAA >> "$work/dns-records.json"
      done
      jq -s 'map(select(.type == "A" or (.records | length > 0)))' "$work/dns-records.json" > "$work/dns-before.json"
      jq -r --arg zone "$zone" --arg ip "$ip" '
        .[] | ([.subname, $zone] | map(select(length > 0)) | join(".")) as $name |
        .records[] | select(. != $ip) | "\($name) currently points to \(.), not this server (\($ip))."
      ' "$work/dns-before.json" > "$work/dns-conflicts"
      confirm_dns_replacement
      jq --arg ip "$ip" 'map(.records = (if .type == "A" then [$ip] else [] end))' \
        "$work/dns-before.json" > "$work/dns-after.json"
      rollback_dns=true
      desec_write "$work/dns-after.json" || fail 'deSEC rejected the DNS update. Check the token permissions.'
      ;;
    own)
      for dns_name in $dns_names; do say "Set an A record for $dns_name to $ip. Remove any AAAA record."; done
      ;;
  esac
  say "Checking DNS for $dns_names ($ip)…"
  attempts=${VOICEROOM_DNS_WAIT:-36}
  missing=$dns_names
  while [ "$attempts" -gt 0 ]; do
    missing=
    for dns_name in $dns_names; do
      if ! dns_matches "$dns_name"; then missing=$dns_name; break; fi
    done
    if [ -z "$missing" ]; then return; fi
    attempts=$((attempts - 1))
    if [ "$attempts" -gt 0 ]; then sleep 5; fi
  done
  fail "DNS must resolve $missing to $ip with no AAAA record. Check the records and allow for DNS propagation."
}

restore_dns() {
  case $provider in
    duckdns)
      if [ -n "$old_a" ]; then
        set -- --data-urlencode "ip=$old_a"
      else
        duckdns_write --data-urlencode 'clear=true' || return 1
        set --
      fi
      if [ -n "$old_aaaa" ]; then set -- "$@" --data-urlencode "ipv6=$old_aaaa"; fi
      [ "$#" -eq 0 ] || duckdns_write "$@"
      ;;
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

check_turn_ports() {
  ports=$(turn_udp_ports "$1")
  if [ -z "$ports" ]; then return; fi
  old_ports=
  if [ "$#" -gt 1 ]; then old_ports=$(turn_udp_ports "$2"); fi
  sockets=$(ss -H -aun 2>/dev/null) || fail 'Could not check local ports using ss.'
  busy=$(printf '%s\n' "$sockets" | awk -v ports="$ports" -v old="$old_ports" '
    BEGIN {
      count = split(ports, requested, "\n")
      for (i = 1; i <= count; i++) new_port[requested[i]] = 1
      count = split(old, previous, "\n")
      for (i = 1; i <= count; i++) delete new_port[previous[i]]
    }
    NF >= 5 {
      port = $(NF - 1)
      sub(/^.*:/, "", port)
      if (port in new_port) { print port; exit }
    }
  ')
  [ -z "$busy" ] || fail "Local port $busy/udp is already in use."
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

turn_ready() {
  if [ -z "$1" ]; then return 0; fi
  health_attempts=${VOICEROOM_HEALTH_WAIT:-36}
  while [ "$health_attempts" -gt 0 ]; do
    if timeout 8 openssl s_client -connect 127.0.0.1:443 -servername "$1" \
      -verify_hostname "$1" -verify_return_error </dev/null >/dev/null 2>&1; then return 0; fi
    health_attempts=$((health_attempts - 1))
    if [ "$health_attempts" -gt 0 ]; then sleep 5; fi
  done
  say "TURN/TLS is not ready at $1:443. Check its DNS record, certificate and inbound TCP ports 80 and 443."
  return 1
}

render_active() {
  compose "$current" "$env_file" config --format json > "$work/active.json" ||
    fail 'Could not render the installed Compose configuration.'
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
    render_active
    turn_domain=$(read_turn_domain "$work/active.json")
    install_cli "$current" || fail 'Could not install the voiceroom command.'
  else
    check_project
    check_ports
    fetch_bundle "$version"
    select_domain
    write_env
    validate_images "$candidate" "$work/.env" || fail 'The release Compose images do not match its manifest.'
    turn_domain=$(read_turn_domain "$work/compose.json")
    check_turn_ports "$work/compose.json"
    prepare_dns all
    if ! activate "$candidate" || ! install_cli "$candidate" || ! ln -T "$work/.env" "$env_file"; then
      fail 'Could not save the installation.'
    fi
    rollback_dns=false
    installed_domain=$domain
  fi
  say 'Pulling the pinned images and starting the personal stack…'
  pull_images "$current" "$env_file" || fail 'Image pull failed. Check registry access and rerun install.'
  start_stack "$current" "$env_file" || fail 'The stack did not become healthy. Run voiceroom status.'
  edge_ready "$installed_domain" ||
    fail 'HTTPS readiness failed. Check DNS, the TLS certificate and inbound TCP ports 80 and 443, then rerun install.'
  turn_ready "$turn_domain" || exit 1
  say 'Local HTTPS is ready. Test inbound TCP 7881 and UDP 7882 from another network.'
  if [ -n "$turn_domain" ]; then say "Test TURN/TLS on $turn_domain:443 from a network that blocks the direct ports."; fi
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
  turn_domain=$(read_turn_domain "$work/compose.json")
  render_active
  check_turn_ports "$work/compose.json" "$work/active.json"
  if [ -n "$turn_domain" ] && [ "$(read_turn_domain "$work/active.json")" != "$turn_domain" ]; then
    domain=$installed_domain
    provider=$installed_provider
    prepare_dns turn
  fi
  backup_config || fail 'Could not back up the installation environment and manifest.'
  say "Pulling $bundle_version. The server will stop accepting calls during the upgrade."
  pull_images "$candidate" "$env_file" || fail 'Image pull failed. The previous release is still active.'
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
    ! start_stack "$candidate" "$env_file" || ! edge_ready "$installed_domain" || ! turn_ready "$turn_domain"; then
    fail 'Upgrade failed during migration or readiness checks.'
  fi
  activate "$candidate" || fail 'Could not activate the new release.'
  rollback_dns=false
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
  turn_domain=$(read_turn_domain "$work/compose.json")
  prepare_dns all
  rollback_domain=true
  if ! start_stack "$current" "$work/.env" || ! edge_ready "$domain" || ! turn_ready "$turn_domain"; then
    fail 'The stack did not become ready on the new domain.'
  fi
  mv -Tf "$work/.env" "$env_file" || fail 'Could not save the new domain.'
  rollback_domain=false
  rollback_dns=false
  printf 'Meet: https://%s/\n' "$domain"
}

status() {
  printf 'Version: %s\nDomain: %s\n' "$bundle_version" "$installed_domain"
  render_active
  turn_domain=$(read_turn_domain "$work/active.json")
  if [ -n "$turn_domain" ]; then
    printf 'TURN/TLS: %s:443/tcp\n' "$turn_domain"
    turn_udp_ports "$work/active.json" | awk '
      NR == 1 { printf "TURN UDP: %s/udp\n", $0 }
      NR == 2 { relay_start = $0 }
      END { if (NR >= 2) printf "TURN relay: %s-%s/udp\n", relay_start, $0 }
    '
  else
    printf 'TURN: disabled\n'
  fi
  compose "$current" "$env_file" ps --all --format json > "$work/status.json" ||
    fail 'Could not read container status.'
  jq -rs '
    flatten[] | [.Service, .State, (.Health // "")] |
    map(if type == "string" and test("^[a-z0-9-]{0,32}$") then . else "unknown" end) |
    join(" ")
  ' "$work/status.json" 2>/dev/null || fail 'Could not read container status.'
  edge_ready "$installed_domain" || fail 'HTTPS is not ready.'
  turn_ready "$turn_domain" || exit 1
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
  if [ "$operation" = upgrade ] && [ "$rollback_dns" = true ] && [ -f "$recovery/target" ] &&
    [ "$(readlink "$current")" = "$(cat "$recovery/target")" ]; then
    rollback_dns=false
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
  for dependency in curl openssl jq dig ss flock sha256sum timeout; do
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
      version=
      for argument do
        case $argument in
          --replace-dns) replace_dns=true ;;
          *)
            [ -z "$version" ] || fail 'Usage: voiceroom upgrade [vX.Y.Z] [--replace-dns]'
            version_valid "$argument" || fail 'Use a release version such as v2.15.0.'
            version=$argument
            ;;
        esac
      done
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
    upgrade) upgrade_stack "$version" ;;
    domain) change_domain ;;
    status) status ;;
    owner-link) owner_link "$@" || fail 'Owner link unavailable. If it was used, pass --rotate to issue a new link.' ;;
  esac
}

main "$@"
