#!/bin/bash
# weekly-variance.sh — H-AC-12 manual weekly run wrapper (Opção B)
#
# Spec: ascendimacy-ops/docs/specs/H-AC-12-variancia-geracao-v0.md (v1)
# Decisão Jun 2026-05-13: sem GitHub Action automation (Opção B); Jun
# dispara este script da WSL semanalmente (ou ad-hoc) pra produzir o
# feed longitudinal em ops#1058.
#
# Pré-requisitos:
#   - Qwen3 stack up em LLM_LOCAL_ENDPOINT (default WSL→Windows :9000)
#   - INFOMANIAK_API_KEY + INFOMANIAK_PRODUCT_ID exportados (opcional —
#     se ausentes, roda só Qwen3 local após confirmação)
#   - gh CLI autenticado (`gh auth status` deve mostrar ascendimacy/* push)
#
# Uso:
#   bash scripts/weekly-variance.sh             # default: tenta full, fallback Qwen3-only
#   bash scripts/weekly-variance.sh --qwen3     # força Qwen3-only (skip prompt)
#   bash scripts/weekly-variance.sh --no-comment # não posta em ops#1058 (sandbox)
#
# Output:
#   - Markdown report no stdout
#   - Salvo em /tmp/h-ac-12-latest-report.md (override via REPORT_OUT)
#   - Posted como comment em ops#1058 (a menos que --no-comment)

set -euo pipefail

# ── Args ────────────────────────────────────────────────────────────────
FORCE_QWEN_ONLY=0
SKIP_COMMENT=0
for arg in "$@"; do
    case "$arg" in
        --qwen3) FORCE_QWEN_ONLY=1 ;;
        --no-comment) SKIP_COMMENT=1 ;;
        --help|-h)
            sed -n '2,28p' "$0"
            exit 0
            ;;
        *)
            echo "Arg desconhecido: $arg (use --help)" >&2
            exit 2
            ;;
    esac
done

# ── CWD ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$REPO_ROOT"

REPORT_OUT="${REPORT_OUT:-/tmp/h-ac-12-latest-report.md}"

# ── Sanity: Qwen3 stack up ───────────────────────────────────────────────
WIN_IP="$(ip route show | awk '/default/ {print $3}' 2>/dev/null || echo "")"
DEFAULT_ENDPOINT="http://${WIN_IP:-172.28.160.1}:9000"
ENDPOINT_BASE="${LLM_LOCAL_ENDPOINT:-${DEFAULT_ENDPOINT}/v1/chat/completions}"
ENDPOINT_PROBE="${ENDPOINT_BASE%/chat/completions}/models"

echo "▶ Checking Qwen3 stack at $ENDPOINT_PROBE…"
if ! curl -fsS --max-time 5 "$ENDPOINT_PROBE" > /dev/null 2>&1; then
    echo "  ✗ Qwen3 offline. Start llama.cpp SYCL stack first (llama-qwen3-30b.bat)."
    exit 1
fi
echo "  ✓ Qwen3 up"

# ── Sanity: gh CLI auth (apenas se vai comentar) ────────────────────────
if [ "$SKIP_COMMENT" = "0" ]; then
    if ! gh auth status >/dev/null 2>&1; then
        echo "  ✗ gh CLI não autenticado. Rode: gh auth login" >&2
        exit 1
    fi
    echo "  ✓ gh CLI autenticado"
fi

# ── Decide mode (full vs qwen3-only) ────────────────────────────────────
MODE_ARGS=""
if [ "$FORCE_QWEN_ONLY" = "1" ]; then
    MODE_ARGS="--manual --model qwen3 --n 30"
    echo "▶ Modo: Qwen3-only (forçado)"
elif [ -z "${INFOMANIAK_API_KEY:-}" ] || [ -z "${INFOMANIAK_PRODUCT_ID:-}" ]; then
    echo "  ⚠ INFOMANIAK_API_KEY/PRODUCT_ID ausentes — Kimi K2.5 indisponível."
    read -r -p "Continuar com Qwen3 only? [y/N]: " ANS
    if [ "${ANS:-N}" != "y" ] && [ "${ANS:-N}" != "Y" ]; then
        echo "Aborted."
        exit 1
    fi
    MODE_ARGS="--manual --model qwen3 --n 30"
    echo "▶ Modo: Qwen3-only (Infomaniak creds ausentes)"
else
    MODE_ARGS="--full"
    echo "▶ Modo: full (Kimi + Qwen3)"
fi

# ── Build ────────────────────────────────────────────────────────────────
echo "▶ Building motor (postbuild copia prompts/)…"
if ! npm run build > /tmp/h-ac-12-build.log 2>&1; then
    echo "  ✗ Build falhou. Veja /tmp/h-ac-12-build.log" >&2
    tail -20 /tmp/h-ac-12-build.log
    exit 1
fi
echo "  ✓ build OK"

# ── Run ──────────────────────────────────────────────────────────────────
echo "▶ Executando measure-menu-variance.mjs $MODE_ARGS…"
echo "  (latência esperada: ~5min Kimi por persona, ~7min Qwen3 por persona)"
echo ""

COMMENT_ARG=""
if [ "$SKIP_COMMENT" = "0" ]; then
    COMMENT_ARG="--comment-on ops#1058"
fi

# Note: script retorna exit code 0 (PASS) ou 1 (FAIL). Não tratamos como
# erro fatal — relatório fica salvo + postado mesmo se algum KPI reprovou.
set +e
node scripts/measure-menu-variance.mjs $MODE_ARGS $COMMENT_ARG --output "$REPORT_OUT"
EXIT_CODE=$?
set -e

echo ""
echo "▶ Done."
echo "  Report: $REPORT_OUT"
if [ "$SKIP_COMMENT" = "0" ]; then
    echo "  Comment posted: https://github.com/ascendimacy/ascendimacy-ops/issues/1058"
fi

if [ "$EXIT_CODE" = "0" ]; then
    echo "  Result: PASS — todos os limiares v0 atendidos"
else
    echo "  Result: FAIL — algum KPI reprovou (veja sinais acionáveis no report)"
fi

exit "$EXIT_CODE"
