# ascendimacy-motor — CLAUDE.md

> Leia este arquivo inteiro antes de qualquer ação no repo.
> Atualizado: 2026-05-05 (v2 — pós-simplificacao Motor Drota Steps 1-5)

---

## 1. Estado atual

| Campo | Valor |
|---|---|
| **Branch ativa** | `feat/motor-simplificacao-v1` |
| **PR aberta** | motor#65 — Steps 1-5 implementados, aguarda STS verde para merge |
| **Spec ativa** | `ascendimacy-ops/docs/specs/2026-05-05-bugfix-materializer-content-anchor.md` |
| **Próximo** | Fix BUG-CM-01 (content anchor) + BUG-PL-01 (deflection gate) |
| **STS último** | 72/72 turns PASS — bot não ancora Fact, não recua em deflection |
| **LLM local** | OVMS qwen14b (Qwen2.5-14B-Instruct int4) via `host.docker.internal:9000/v3` |

---

## 2. Arquitetura (pós-simplificacao)

```
planejador/
  plan.ts              → scorePool determinístico + LLM rationale/contextHints
                          + triageForParents + Gardner instruction + Trigger Evaluator
  pool-builder.ts      → seed YAML + filtro por idade/sessionMode
  trigger-evaluator.ts → avalia transitions.yaml (read-only)

motor-drota/
  unified-assessor.ts          → rule-based first + local/Haiku: mood+signals em 1 chamada
  pragmatic-selector.ts        → determinístico zero-LLM: filtro mood/budget → menor custo
  constrained-materializer.ts  → STABLE_MATERIALIZER_PREFIX + buildUserMessage + callGateway
  server.ts                    → orquestra 3 componentes via USE_SIMPLIFIED_PIPELINE flag

shared/
  gateway-client.ts   → callGateway + callLocalVllm (provider=local → fetch direto)
  llm-router.ts       → anthropic | infomaniak | local
  scorer.ts           → scorePool determinístico
  helix-*.ts          → Double Helix state machine
  parental-*.ts       → perfil parental + triage rule-based/Haiku
  gardner-*.ts        → programa 5 semanas
  mood.ts             → MoodReading, comfort gate ≤3
  stable-state-cache  → campos estáveis por sessão, voláteis por turn
```

---

## 3. Pipeline por turn

```
[mensagem do sujeito]
  → extract_signals (unified-assessor)
  → planTurn (planejador) — LLM real
      ↓ { contentPool, contextHints, instruction_addition }
  → handleSimplifiedPipeline (USE_SIMPLIFIED_PIPELINE=true)
      1. assess()       — unified-assessor → { mood, signals, engagement }
      2. selectAction() — pragmatic-selector (zero LLM)
      3. materialize()  — constrained-materializer → texto final
  → execute_playbook → Helix advance → auto-hook → Bridge
```

---

## 4. Env crítico

```env
LLM_PROVIDER=local
LOCAL_LLM_BASE_URL=http://host.docker.internal:9000/v3
LOCAL_LLM_MODEL=qwen14b
LOCAL_LLM_API_KEY=local
USE_SIMPLIFIED_PIPELINE=true
USE_MOCK_LLM=false
ASC_LLM_TIMEOUT_SECONDS=120
ASC_EVENT_TIMEOUT_SECONDS=1200
# restaurar nuvem: LLM_PROVIDER=anthropic (sem mudar código)
```

---

## 5. Comandos

```bash
# build
npm run build --workspace shared && npm run build --workspace motor-drota && npm run build --workspace planejador

# testes
npm test --workspace shared && npm test --workspace motor-drota && npm test --workspace planejador

# STS smoke 1x8 turns
cd ~/ascendimacy-sts && set -a && . ~/ascendimacy-motor/.env && set +a
export MOTOR_PATH=~/ascendimacy-motor
npx sts run-scenario scenarios/nagareyama-realista-v1.yaml --verbose

# STS completo 3x12 Ryo+Kei
npx sts run-scenario scenarios/nagareyama-realista-v1.yaml \
  --output ~/ascendimacy-ops/docs/tests/$(date +%Y-%m-%d)-sts-nagareyama.md

# push
git push origin feat/motor-simplificacao-v1
```

---

## 6. Decisões fechadas

| ID | Decisão |
|---|---|
| DS-01 | 3 componentes Motor Drota em vez de 6 |
| DS-02 | Action Evaluator+Selector → Pragmatic Selector determinístico |
| DS-03 | Post-Processor → constraints no prompt do Materializer |
| DS-04 | Edit Learner v1 = event logger |
| DS-05 | 2 chamadas LLM por turn: Assessor + Materializer |
| DS-06 | signal-extractor+mood → Unified Assessor (1 chamada) |
| DS-09 | Modelo Materializer configurável via env (default: qwen local) |
| DS-10 | StableStateCache: estáveis por sessão, voláteis por turn |
| DS-11 | Interfaces Planejador↔Drota↔Bridge preservadas |
| DS-B | `USE_SIMPLIFIED_PIPELINE=true` — side-by-side, fluxo antigo preservado |

---

## 7. DTs abertos

| ID | Onde | Descrição |
|---|---|---|
| DT-SIM-02 | stable-state-cache.ts | VoiceProfile sem tipo formal → stub |
| DT-SIM-05 | constrained-materializer.ts | model "qwen" não no LlmStep enum → step "drota" |
| DT-SIM-06 | inaugural-template.ts | Voice profiles sem loader runtime |

---

## 8. Bugs ativos

**BUG-CM-01** — `constrained-materializer.ts`
Causa: `STABLE_MATERIALIZER_PREFIX` usa "POSSIBILIDADE LATENTE" → Qwen14B ignora Fact
Fix: substituir por `CONTEÚDO PEDAGÓGICO (regra obrigatória)`
Spec: `ascendimacy-ops/docs/specs/2026-05-05-bugfix-materializer-content-anchor.md`

**BUG-PL-01** — `planejador/src/plan.ts`
Causa: `buildSystemPrompt` não injeta `extracted_signals` → deflection ignorada 3 turns
Fix: adicionar `signalsBlock` + `deflectionBlock` quando `deflection_thematic` presente
Spec: mesma spec acima

---

## 9. Specs de referência

| Área | Arquivo em ascendimacy-ops |
|---|---|
| Arquitetura Motor Drota simplificado | `docs/specs/2026-04-28-motor-simplificacao-llm-spec-v1.md` |
| Step 5 feature flag (server.ts) | `docs/handoffs/2026-04-28-motor-simplificacao-step5-handoff.md` |
| vLLM local / OVMS qwen14b | `docs/handoffs/2026-04-28-local-vllm-gpt-oss-motor-sts.md` |
| STS realista Ryo+Kei | `docs/specs/2026-05-05-sts-realista-ryo-kei.md` |
| Bugfix planejador provider=local | `docs/specs/2026-05-05-bugfix-planejador-local-provider.md` |
| Bugfix materializer anchor+deflection | `docs/specs/2026-05-05-bugfix-materializer-content-anchor.md` |
| Double Helix | `docs/specs/2026-04-24-dual-helix-consolidated.md` |
| Pulso (omikuji) | `docs/specs/2026-04-26-pulso-spec-v0.md` |
| StateVector primitives | `docs/specs/2026-04-27-statevector-primitives-inventory-f1.md` |

```bash
ls ~/ascendimacy-ops/docs/specs/
ls ~/ascendimacy-ops/docs/handoffs/
```

---

## 10. Regras de trabalho

- Nunca commitar direto em `main` — sempre branch + PR
- Branch ativa: `feat/motor-simplificacao-v1` até merge motor#65
- Antes de qualquer mudança arquitetural: ler spec em ascendimacy-ops
- Antes de modificar `STABLE_MATERIALIZER_PREFIX` ou `STABLE_DROTA_PREFIX`: verificar prefix caching
- `npm test` verde antes de qualquer push
- STS smoke obrigatório antes de merge

---

## 11. Repos relacionados

```
~/ascendimacy-motor/   ← este repo (código)
~/ascendimacy-ops/     ← specs, handoffs, testes
~/ascendimacy-sts/     ← STS harness + scenarios + fixtures
```

Git pull nos três antes de iniciar sessão.

---

> 🌳 Crescer para colhar.
> CLAUDE.md v2.0 — 2026-05-05
