#!/usr/bin/env bash
# PreToolUse / Edit|Write|MultiEdit — leave a note saying where the digging is.
#
# This hook does not publish on the bus. It writes a note on disk and the seat
# reports it. Repo runtimes receive chaired assignments through their adapter,
# but never get road credentials or authority to address peers directly.
#
# It runs before every edit, so the fast path has to be cheap: one check of the
# remote and a one-line file.
set -uo pipefail
# Outside a city runtime the whole plugin stays silent (see the guard).
. "$(dirname "$0")/solo-en-ciudad.sh"
nada() { printf '{}\n'; exit 0; }

# One resolver for settings and for "does this repo belong to the city".
# It used to be a hardcoded organisation name, which meant this hook did nothing
# at all for anybody who was not that one company.
. "${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/scripts/city-env.sh"
REPO="$(repo_de_la_ciudad)" || nada

CITY_SCOPE="$(printf '%s' "${CITY_ADDRESS:-city}" | tr -c 'A-Za-z0-9_.@-' '-')"
DIR="$CITY_DIR/digging/$CITY_SCOPE"
mkdir -p "$DIR" 2>/dev/null || nada

# The parcel comes from the file being touched, matched against parcels.yml in
# the data repo. Without that, the house is the whole repo.
ENTRADA="$(cat)"
FICHERO="$(sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$ENTRADA" | head -1)"
RAIZ="$(git rev-parse --show-toplevel 2>/dev/null || echo '')"
REL="${FICHERO#$RAIZ/}"

PARCELA="$REPO"
EQUIPO="${AGENTS_CITY_DATA:-$HOME/agents-city-data}"
if [ -n "$REL" ] && [ -f "$EQUIPO/parcelas.yml" ]; then
  EN_REPO=0
  while IFS= read -r linea; do
    case "$linea" in
      "  $REPO:") EN_REPO=1; continue ;;
      "  "[a-zA-Z0-9_.-]*":") EN_REPO=0; continue ;;
    esac
    [ "$EN_REPO" -eq 1 ] || continue
    case "$linea" in *"- ruta:"*) ;; *) continue ;; esac
    RUTA="$(sed -n 's/.*- ruta:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$linea")"
    [ -z "$RUTA" ] && { PARCELA="$REPO"; break; }   # empty path = the whole repo
    # shellcheck disable=SC2254
    case "$REL" in $RUTA) PARCELA="$REPO:$RUTA"; break ;; esac
  done < "$EQUIPO/parcelas.yml"
fi

# El agente no es la persona, y tampoco es el repo: es ESTA ventana. Una persona
# tiene la del puesto y una por repo, y si trabaja con worktrees, una por
# worktree — mismo repo, ramas distintas, agentes distintos. Se distinguen por
# el directorio del worktree y la rama, que es lo que de verdad los separa.
DIRTRAB="$(basename "$RAIZ")"
RAMA="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
PRINCIPAL="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')"
[ -z "$PRINCIPAL" ] && PRINCIPAL=main

AGENTE="$DIRTRAB"
if [ -n "$RAMA" ] && [ "$RAMA" != "$PRINCIPAL" ] && [ "$RAMA" != "HEAD" ]; then
  AGENTE="$DIRTRAB@$RAMA"
fi

# Un fichero por agente, no por repo: dos worktrees del mismo repo son dos.
SEGURO="$(printf '%s' "$AGENTE" | tr -c 'A-Za-z0-9_.@-' '-')"
printf '{"repo":"%s","parcela":"%s","agente":"%s","rama":"%s","ts":%s}\n' \
  "$REPO" "$PARCELA" "$AGENTE" "$RAMA" "$(date +%s)" > "$DIR/$SEGURO.json"
nada
