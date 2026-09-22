#!/usr/bin/env bash
#
# Corre las pruebas del servidor en el orden correcto.
#
# Existe porque las suites no comparten precondiciones: unas necesitan el
# registro abierto y otras necesitan REGISTRO_CODIGO configurado, y correrlas
# todas contra un mismo servidor da fallas que parecen del codigo y son del
# entorno. Media hora se fue en eso una vez.
#
# Uso:  DATABASE_URL=postgresql://... ./pruebas.sh
set -uo pipefail
cd "$(dirname "$0")"

: "${DATABASE_URL:?Falta DATABASE_URL (una base de prueba, no la de produccion)}"
export AUTH_SECRET="${AUTH_SECRET:-secreto-de-prueba-largo-1234567890}"
export AUTH_REQUIRED=true
export AI_STRATEGY=local
# Apunta al mock, no a un Ollama de verdad: las pruebas tienen que dar siempre
# lo mismo, y un modelo real no da dos veces la misma respuesta.
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export PORT="${PORT:-4000}"

fallas=0

# El mock de Ollama: las pruebas de IA que resuelve el servidor necesitan algo
# que conteste como un modelo, sin descargar un modelo de verdad.
levantar_mock() {
  pkill -f "mock-ollama" 2>/dev/null
  sleep 1
  nohup node mock-ollama.mjs > /tmp/mock-ollama.log 2>&1 &
  sleep 1
}

levantar() {
  pkill -f "tsx.*src/index" 2>/dev/null
  sleep 1
  REGISTRO_CODIGO="$1" nohup npx tsx src/index.ts > /tmp/servidor-pruebas.log 2>&1 &
  for _ in $(seq 1 30); do
    sleep 1
    if curl -sf "http://localhost:${PORT}/health" > /dev/null; then return 0; fi
  done
  echo "El servidor no arranco. Ultimas lineas:"
  tail -20 /tmp/servidor-pruebas.log
  exit 1
}

# Una suite pasa si termina con codigo 0. El resumen "N OK, 0 fallas" lo
# imprimen casi todas, pero no todas (test-collab describe lo que verifico en
# prosa), asi que el criterio es el codigo de salida y el resumen es informativo.
correr() {
  printf '%-26s ' "$1"
  local salida codigo
  salida="$(timeout 300 node "$1" 2>&1)"
  codigo=$?
  echo "$salida" | tail -1
  if [ "$codigo" -ne 0 ]; then
    fallas=$((fallas + 1))
    echo "$salida" | tail -12 | sed 's/^/      /'
  fi
}

echo "== Con el registro abierto =="
levantar_mock
levantar ""
correr test-auth.mjs
correr test-anfitrion.mjs
correr test-registro.mjs
correr test-collab.mjs
# Estas dos tambien necesitan el servidor: hablan con /api/ai contra el mock.
correr test-dominio.mjs
correr test-eapx.mjs

echo
echo "== Con codigo de registro, para probar las invitaciones =="
levantar "SECRETO-DE-PRUEBA"
correr test-invitaciones.mjs
correr test-relevo.mjs


pkill -f "tsx.*src/index" 2>/dev/null

echo
if [ "$fallas" -eq 0 ]; then
  echo "Todo en verde."
else
  echo "$fallas suite(s) con fallas."
fi
exit "$fallas"
