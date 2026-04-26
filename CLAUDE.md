# CLAUDE.md — ascendimacy-motor

> **Antes de qualquer trabalho neste repo, lê `ARCHITECTURE.md`** — single source of truth, atualizado a cada PR.

## Onde estamos (motor#1 → motor#25)

Walking skeleton (motor#1) era 3 MCP servers + orchestrator simples. Hoje (motor#25) é **engine pedagógico** com:

- **4 camadas** (Planejador / Motor Drota / Motor Execução / Bridge) ↔ contratos MCP estáveis
- **Provider router** multi-LLM (motor#21): Anthropic / Infomaniak por callsite, default Kimi-first
- **Robustness** (motor#20): timeouts/retries/error-classifier
- **Debug mode** (motor#19): NDJSON event log + CAS + reasoning capture + utility scripts
- **Pool slim + prompt cache + parse fallback** (motor#25 §A): smoke-3d hardening
- **Pastor foundations** (motor#25 §B): Signal Extractor (15 signals taxonomy) + transitions.yaml declarativo + Trigger Evaluator + candidate_set Shannon entropy

Próximos: motor#26 (F6 Quality Gate + EfficacyIndex via STS) → motor#27 (cultural defaults + Pulso) → piloto Nagareyama.

Ver `ARCHITECTURE.md` §10 (PRs históricos), §11 (débitos), §13 (componentes sensoriais), §14 (função de transição).

## Workspace

```
shared/         # contracts MCP, schemas, scoring, content-item types, llm-router, semantic-signals, transitions-schema, debug-logger
planejador/     # Claude Sonnet — strategic rationale + content scoring + slicePoolForDrota + trigger-evaluator
motor-drota/    # Infomaniak Kimi — linguistic materialization + signal-extractor + parse-output fallback
motor-execucao/ # SQLite state + playbook executor + Bloco 5a auto-hook (cards) + Bloco 6 dyad
orchestrator/   # CLI multi-MCP + trace-writer + auto-hook integration
weekly-report/  # Bloco 3 weekly report aggregator
```

## Provider config (motor#21)

Defaults: TUDO Infomaniak/Kimi K2.5 (planejador, drota, persona-sim) + mistral3 (haiku-triage, haiku-bullying, signal-extractor). Zero Anthropic credit dependency.

Override per-callsite via env (ver `shared/src/llm-router.ts`):

```bash
PLANEJADOR_PROVIDER=anthropic
PLANEJADOR_MODEL=claude-sonnet-4-6
DROTA_MODEL=moonshotai/Kimi-K2.5
SIGNAL_EXTRACTOR_MODEL=mistral3
LLM_PROVIDER=anthropic   # global override
```

Timeouts + retries: `ASC_LLM_TIMEOUT_<STEP>` (segundos), `ASC_LLM_MAX_RETRIES_<STEP>`. Defaults em `shared/src/llm-config.ts`.

## Debug mode (motor#19)

`ASC_DEBUG_MODE=true` liga captura completa em `logs/debug/<run_id>/` — NDJSON events + content/ + snapshots/ (CAS dedup). Reasoning capture funciona pra Anthropic (`thinking` blocks) e Infomaniak (`reasoning` field).

Replay: `node scripts/debug-timeline.mjs --run <run_id>` ou `scripts/debug-by-session.mjs --run <run_id> --out by-session.md`.

## Decision-trail (motor#25)

Toda mudança de **prompt / archetype / scoring / voice profile / transitions.yaml** vai pra `motorops/decision-trail/<DATA>-<NNN>-<slug>.md`. Inclui: o que mudou, por quê, métrica de sucesso, refs.

## Must NOT

- Não pushar sem build + test verdes (`npm run build && npm test`)
- Não committar `.env` ou chaves reais
- Não mergear PR sem Jun validar (Tier N2 — abre PR e notifica)
- Não bumpa minor de ARCHITECTURE.md sem entrada na §15 versionamento
- Não anti-scope: ver handoff `2026-04-26-cc-motor-pre-piloto-strategic-gaps.md` — itens explicitamente fora do escopo pré-piloto (Edit Learner v2, Re-entry primitive, BookContentLayer, etc)

## Stack de chamadas LLM por turn (post-motor#25)

```
user_message → orchestrator
    ↓
[1] motor-execucao.get_state         (no LLM)
[2] motor-drota.extract_signals      (Mistral3 ~5s)  ← motor#25
[3] motor-execucao.log_event         (no LLM, signals_extracted)
[4] motor-execucao.get_state         (no LLM, refresh)
[5] planejador.plan_turn             (Sonnet/Kimi ~10-30s)
       ├ slicePoolForDrota (no LLM)  ← motor#25
       ├ trigger-evaluator (no LLM)  ← motor#25
       └ shannonEntropy (no LLM)     ← motor#25
[6] motor-execucao.log_event × N     (transition_evaluated, candidate_set_emitted) ← motor#25
[7] motor-drota.evaluate_and_select  (Kimi ~15-30s — agora com cache_control)
[8] motor-execucao.execute_playbook  (no LLM)
[9] motor-execucao.detect_achievement (no LLM)
[10] motor-execucao.emit_card_for_signal (Haiku ~2s se signal)
```

Per-turn LLM calls: 2-4 (extractor + planejador + drota + opcional Haiku triage). Latency pós-bumps: ~30-90s real-llm.

## Contexto Ascendimacy

Ver `CLAUDE.md` em `ascendimacy-ops`.

> 🌳 Cada teto vira chão.
