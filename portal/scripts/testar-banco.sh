#!/usr/bin/env bash
# Executa os testes do banco (pgTAP) contra o Supabase local.
# Uso: npm run test:db   (requer `npx supabase start` em execução)
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
falhas=0
for arquivo in "$DIR"/supabase/tests/*.test.sql; do
  nome="$(basename "$arquivo")"
  saida="$(cd "$DIR/supabase/tests" && psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -f "$nome" 2>&1)"
  status=$?
  if [ $status -ne 0 ] || grep -qE "^not ok|Looks like" <<<"$saida"; then
    echo "✗ $nome"
    grep -E "not ok|Looks like|ERROR|#" <<<"$saida" | head -40
    falhas=$((falhas + 1))
  else
    total="$(grep -cE '^ok ' <<<"$saida")"
    echo "✓ $nome ($total verificações)"
  fi
done
if [ $falhas -gt 0 ]; then
  echo "$falhas arquivo(s) de teste com falha."
  exit 1
fi
echo "Todos os testes do banco passaram."
