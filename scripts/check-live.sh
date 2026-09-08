#!/usr/bin/env bash
# Basic post-deploy checks against the live servers.
# Run manually from the repo root (or anywhere - paths are resolved from the script location):
#   ./scripts/check-live.sh
#
# Checks each service is up, and that the deployed version matches the local
# version.json (VERSION + GIT_COMMIT), so you can tell an update actually landed.
# Exits 0 if everything passed, 1 if any check failed.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Hosts (override via env, e.g. WEBAPP_URL=http://localhost:4000 ./scripts/check-live.sh)
SERVER_URL="${SERVER_URL:-https://server-aiqa.winterwell.com}"
MCP_URL="${MCP_URL:-https://mcp-aiqa.winterwell.com}"
WEBAPP_URL="${WEBAPP_URL:-https://app-aiqa.winterwell.com}"
WEBSITE_URL="${WEBSITE_URL:-https://aiqa.winterwell.com}"

TIMEOUT="${TIMEOUT:-15}"
VERBOSE=""
CERT_WARN_DAYS="${CERT_WARN_DAYS:-21}"

while [ $# -gt 0 ]; do
    case "$1" in
        -v|--verbose) VERBOSE=1 ;;
        -t|--timeout) TIMEOUT="$2"; shift ;;
        -h|--help)
            cat <<USAGE
Usage: ./scripts/check-live.sh [-v] [-t SECONDS]

Basic post-deploy checks of the live servers: aiqa server, mcp, webapp, website.
Each service must be up, and its deployed version must match the local
VERSION.txt / version.json (VERSION + GIT_COMMIT), so you can tell an update
actually landed. Exits 0 if all checks passed, 1 if any failed.

  -v, --verbose          show response bodies
  -t, --timeout SECONDS  per-request timeout (default $TIMEOUT)

Host overrides (env): SERVER_URL, MCP_URL, WEBAPP_URL, WEBSITE_URL,
                      CERT_WARN_DAYS (default $CERT_WARN_DAYS)
USAGE
            exit 0 ;;
        *) echo "Unknown argument: $1 (try --help)"; exit 2 ;;
    esac
    shift
done

if [ -t 1 ]; then
    RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
else
    RED=""; GREEN=""; YELLOW=""; BOLD=""; OFF=""
fi

PASS=0
FAIL=0
WARN=0
FAILURES=""

ok()   { PASS=$((PASS+1)); echo "  ${GREEN}PASS${OFF} $1"; }
bad()  { FAIL=$((FAIL+1)); FAILURES="$FAILURES\n  - $1"; echo "  ${RED}FAIL${OFF} $1"; }
warn() { WARN=$((WARN+1)); echo "  ${YELLOW}WARN${OFF} $1"; }
section() { echo; echo "${BOLD}$1${OFF}"; }

# json_field FILE KEY - read a top-level string field, using jq when available
json_field() {
    if command -v jq >/dev/null 2>&1; then
        jq -r --arg k "$2" '.[$k] // empty' "$1" 2>/dev/null
    else
        grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$1" 2>/dev/null \
            | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/'
    fi
}

# As json_field, but for the first element of an array-valued field.
json_first_in_array() {
    if command -v jq >/dev/null 2>&1; then
        jq -r --arg k "$2" '.[$k][0] // empty' "$1" 2>/dev/null
    else
        tr -d '\n' < "$1" 2>/dev/null \
            | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\[[[:space:]]*\"[^\"]*\"" \
            | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
    fi
}

BODY=$(mktemp)
trap 'rm -f "$BODY"' EXIT

# fetch URL - GET into $BODY, echo the HTTP status code ("000" if unreachable)
fetch() {
    local code
    # curl already prints 000 on failure, so take its output and only substitute
    # when there is none - "|| echo 000" would append a second code.
    code=$(curl -sS -m "$TIMEOUT" -o "$BODY" -w '%{http_code}' "$1" 2>/dev/null) || true
    echo "${code:-000}"
}

# check_status LABEL URL EXPECTED_CODE
check_status() {
    local label="$1" url="$2" want="$3"
    local code
    code=$(fetch "$url")
    if [ "$code" = "$want" ]; then
        ok "$label ($url -> $code)"
    else
        bad "$label ($url -> $code, expected $want)"
    fi
    [ -n "$VERBOSE" ] && echo "       $(head -c 200 "$BODY" | tr '\n' ' ')"
    [ "$code" = "$want" ]
}

# check_version LABEL URL - fetch a version.json-shaped response and compare to local
check_version() {
    local label="$1" url="$2" code live_version live_commit
    code=$(fetch "$url")
    if [ "$code" != "200" ]; then
        bad "$label version endpoint ($url -> $code)"
        return 1
    fi
    live_version=$(json_field "$BODY" VERSION)
    live_commit=$(json_field "$BODY" GIT_COMMIT)
    if [ -z "$live_version" ]; then
        bad "$label version endpoint returned no VERSION ($url): $(head -c 120 "$BODY" | tr '\n' ' ')"
        return 1
    fi
    if [ "$live_version" = "$LOCAL_VERSION" ]; then
        ok "$label version $live_version matches local"
    else
        bad "$label version $live_version != local $LOCAL_VERSION"
    fi
    if [ -z "$LOCAL_COMMIT" ] || [ -z "$live_commit" ]; then
        warn "$label commit not comparable (live='$live_commit' local='$LOCAL_COMMIT')"
    elif [ "$live_commit" = "$LOCAL_COMMIT" ]; then
        ok "$label commit ${live_commit:0:8} matches local"
    else
        bad "$label commit ${live_commit:0:8} != local ${LOCAL_COMMIT:0:8}"
    fi
}

# check_cert HOSTNAME - warn if the TLS cert is close to expiry
check_cert() {
    local host="$1" end days
    case "$host" in http://*) return 0 ;; esac
    host="${host#https://}"; host="${host%%/*}"
    if ! command -v openssl >/dev/null 2>&1; then
        warn "openssl not found, skipping TLS check for $host"
        return 0
    fi
    end=$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//')
    if [ -z "$end" ]; then
        bad "TLS certificate for $host could not be read"
        return 1
    fi
    # BSD date (macOS) and GNU date parse differently; try both
    local end_epoch
    end_epoch=$(date -j -f "%b %d %T %Y %Z" "$end" +%s 2>/dev/null \
        || date -d "$end" +%s 2>/dev/null)
    if [ -z "$end_epoch" ]; then
        warn "TLS certificate for $host expires $end (could not parse date)"
        return 0
    fi
    days=$(( (end_epoch - $(date +%s)) / 86400 ))
    if [ "$days" -lt 0 ]; then
        bad "TLS certificate for $host EXPIRED $(( -days )) days ago"
    elif [ "$days" -lt "$CERT_WARN_DAYS" ]; then
        warn "TLS certificate for $host expires in $days days"
    else
        ok "TLS certificate for $host valid for $days days"
    fi
}

# ---------------------------------------------------------------- local version
LOCAL_VERSION=$(tr -d '[:space:]' < "$ROOT/VERSION.txt" 2>/dev/null)
LOCAL_COMMIT=$(json_field "$ROOT/version.json" GIT_COMMIT)
LOCAL_JSON_VERSION=$(json_field "$ROOT/version.json" VERSION)
HEAD_COMMIT=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)

echo "${BOLD}AIQA live server checks${OFF}  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Local version : ${LOCAL_VERSION:-?} (version.json commit ${LOCAL_COMMIT:0:8}, HEAD ${HEAD_COMMIT:0:8})"

if [ -z "$LOCAL_VERSION" ]; then
    echo "${RED}Cannot read $ROOT/VERSION.txt - aborting${OFF}"
    exit 2
fi
if [ -n "$LOCAL_JSON_VERSION" ] && [ "$LOCAL_JSON_VERSION" != "$LOCAL_VERSION" ]; then
    echo "${YELLOW}Note: version.json says $LOCAL_JSON_VERSION but VERSION.txt says $LOCAL_VERSION"
    echo "      - run ./set-version-json.sh${OFF}"
fi

# ------------------------------------------------------------------ aiqa server
section "aiqa server - $SERVER_URL"
check_status "server root" "$SERVER_URL/" 200
check_status "server /health" "$SERVER_URL/health" 200
if [ "$(json_field "$BODY" status)" = "ok" ]; then
    ok "server /health reports status=ok"
else
    bad "server /health did not report status=ok: $(head -c 120 "$BODY" | tr '\n' ' ')"
fi
check_version "server" "$SERVER_URL/version"
check_cert "$SERVER_URL"

# -------------------------------------------------------------------- mcp server
section "mcp server - $MCP_URL"
if check_status "mcp /health" "$MCP_URL/health" 200; then
    mcp_version=$(json_field "$BODY" VERSION)
    [ -z "$mcp_version" ] && mcp_version=$(json_field "$BODY" version)
    # Read now: every later fetch overwrites $BODY
    mcp_oauth=$(json_field "$BODY" oauth)
    if [ "$(json_field "$BODY" status)" != "ok" ]; then
        bad "mcp /health did not report status=ok: $(head -c 120 "$BODY" | tr '\n' ' ')"
    elif [ "$mcp_version" = "$LOCAL_VERSION" ]; then
        ok "mcp version $mcp_version matches local"
    else
        bad "mcp version ${mcp_version:-?} != local $LOCAL_VERSION"
    fi
fi
# /sse must reject unauthenticated clients (401), which also proves the MCP app is live
check_status "mcp /sse rejects anonymous access" "$MCP_URL/sse" 401
# That 401 points clients at the discovery document, so it has to resolve - it
# needs a location block in the nginx config, which is easy to miss on deploy
if check_status "mcp discovery document" "$MCP_URL/.well-known/oauth-protected-resource" 200; then
    # Read now: every later fetch overwrites $BODY
    advertises_as=$(json_first_in_array "$BODY" authorization_servers)
    prm_resource=$(json_field "$BODY" resource)
fi

# OAuth is optional, so 'disabled' is a normal answer - but 'error' means it is
# configured and not working, which is otherwise invisible until a user tries to
# connect and their client fails with nothing to go on.
case "$mcp_oauth" in
    enabled)
        ok "mcp oauth is enabled"
        if [ -z "${advertises_as:-}" ]; then
            bad "mcp oauth is enabled but the discovery document advertises no authorization_servers"
        else
            ok "mcp points clients at $advertises_as"
        fi
        # The resource is what clients send as RFC 8707 `resource`, and so the
        # audience the provider issues for. If it is not the public URL, no
        # provider-side API identifier can match it, and every tool call 401s
        # after an otherwise clean login - the hardest failure here to read.
        if [ "${prm_resource:-}" = "$MCP_URL" ]; then
            ok "mcp declares its own URL as the resource"
        else
            bad "mcp resource is '${prm_resource:-}', expected $MCP_URL (check MCP_PUBLIC_URL)"
        fi
        # Clients discover the provider themselves now, so its metadata is on
        # the critical path. Without dynamic registration they cannot connect at
        # all: neither Cursor nor Claude will ask a user for a client_id.
        if [ -n "${advertises_as:-}" ] && check_status "provider metadata" \
            "${advertises_as%/}/.well-known/openid-configuration" 200; then
            if [ -n "$(json_field "$BODY" registration_endpoint)" ]; then
                ok "provider advertises dynamic client registration"
            else
                bad "provider advertises no registration_endpoint - clients cannot self-register"
            fi
        fi
        ;;
    disabled)
        warn "mcp oauth is off (API keys only)"
        ;;
    error)
        bad "mcp oauth is configured but not working (/health reports oauth=error) - check the service log"
        ;;
    "")
        warn "mcp /health reported no oauth field (older deploy?)"
        ;;
    *)
        bad "mcp /health reported an unexpected oauth state: $mcp_oauth"
        ;;
esac

check_cert "$MCP_URL"

# ----------------------------------------------------------------------- webapp
section "webapp - $WEBAPP_URL"
if check_status "webapp index" "$WEBAPP_URL/" 200; then
    if grep -qi "<html" "$BODY"; then
        ok "webapp index served HTML"
        # A stale/broken deploy usually shows up as index.html pointing at missing bundles
        assets=$(grep -oE '(src|href)="/assets/[^"]+\.(js|css)"' "$BODY" \
            | sed -E 's/.*"(\/assets[^"]+)".*/\1/' | sort -u)
        if [ -z "$assets" ]; then
            warn "webapp index referenced no /assets bundles - check the build"
        else
            for a in $assets; do
                code=$(curl -sS -m "$TIMEOUT" -o /dev/null -w '%{http_code}' "$WEBAPP_URL$a" 2>/dev/null || echo 000)
                if [ "$code" = "200" ]; then
                    ok "webapp asset $a -> 200"
                else
                    bad "webapp asset $a -> $code"
                fi
            done
        fi
    else
        bad "webapp index did not look like HTML"
    fi
fi
check_version "webapp" "$WEBAPP_URL/.well-known/version.json"
check_cert "$WEBAPP_URL"

# ---------------------------------------------------------------------- website
section "website - $WEBSITE_URL"
if check_status "website index" "$WEBSITE_URL/" 200; then
    if grep -qi "<html" "$BODY"; then
        ok "website index served HTML"
    else
        bad "website index did not look like HTML"
    fi
fi
check_status "website /docs.html" "$WEBSITE_URL/docs.html" 200
check_version "website" "$WEBSITE_URL/.well-known/version.json"
# aiqa.winterwell.com also proxies the API through to the server
check_version "website->server proxy" "$WEBSITE_URL/version"
check_cert "$WEBSITE_URL"

# ---------------------------------------------------------------------- summary
section "Summary"
echo "  ${GREEN}$PASS passed${OFF}, ${RED}$FAIL failed${OFF}, ${YELLOW}$WARN warnings${OFF}"
if [ "$FAIL" -gt 0 ]; then
    printf "Failures:%b\n" "$FAILURES"
    exit 1
fi
echo "  ${GREEN}All live checks passed for version $LOCAL_VERSION${OFF}"
exit 0
