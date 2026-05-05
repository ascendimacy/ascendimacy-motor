# ascendimacy-motor — CLAUDE.md

> Leia este arquivo inteiro antes de qualquer ação no repo.
> Atualizado: 2026-05-05 (v3 — Karpathy behavioral constraints integrados)

---

## 0. Comportamento obrigatório (Karpathy constraints)

Esses 4 princípios valem para TODA tarefa neste repo, sem exceção.

### P1 — Perguntar antes de codar
Se o handoff ou spec não especifica algo com clareza, PARE e pergunte.
Não escolha uma interpretação e siga em frente. Não assuma silenciosamente.
Exemplos de ambiguidade que exigem pergunta:
- "Modifica o materializer" — qual arquivo exatamente? qual função?
- "Adiciona teste" — unitário com mock ou integração com callGateway real?
- "Corrige o bug" — o fix da spec ou uma abordagem diferente?
De: assumpção silenciosa. Para: "Antes de começar: [pergunta específica]."

### P2 — Simplicidade primeiro
Escreva o mínimo de código que resolve o problema especificado.
Não adicione abstrações especulativas. Não crie flexibilidade que ninguém pediu.
Exemplos específicos neste repo:
- Não extraia interface nova se a função já funciona
- Não crie factory pra algo que tem 1 implementação
- Não adicione campo ao StateVector sem spec que o justifique
- Não amplie o STABLE_MATERIALIZER_PREFIX sem medir impacto no prefix caching
Referencial: o Pragmatic Selector tem ~50 linhas e zero abstrações. É o modelo.

### P3 — Cirurgia, não reforma
Toque APENAS o que a tarefa exige. Não melhore código vizinho. Não refatore o que não está quebrado.
Exemplos específicos neste repo:
- Se o handoff diz "modifica buildSystemPrompt em plan.ts", não toque em pool-builder.ts
- Se o bugfix é no STABLE_MATERIALIZER_PREFIX, não refatore buildUserMessage junto
- Não renomeie variáveis, não reordene imports, não ajuste estilo fora do escopo
- Não abra DTs novos durante o fix — registre e deixe para depois
Exceção única: se o código vizinho tem bug que CAUSA o problema sendo resolvido, documente e pergunte.

### P4 — Alvo verificavel antes de escrever
Transforme instruções vagas em critérios verificáveis antes de codar.
Exemplos específicos neste repo:
- "Corrige o content anchor" → "Fact aparece na materialização em ≥6/8 turns no STS"
- "Adiciona deflection gate" → "Bot muda de tema no turn seguinte após deflection_thematic detectado"
- "Melhora o assessor" → "mood_method='rule' em ≥70% dos turns com sinal explícito de distress"
Se o handoff já tem Definition of Done com checkboxes, esses são os alvos. Use-os.
Se não tem, escreva os alvos e confirme com Jun antes de começar.

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
Alvo verificável (P4): Fact mencionado em ≥6/8 turns no STS smoke
Spec: `ascendimacy-ops/docs/specs/2026-05-05-bugfix-materializer-content-anchor.md`

**BUG-PL-01** — `planejador/src/plan.ts`
Causa: `buildSystemPrompt` não injeta `extracted_signals` → deflection ignorada 3 turns
Fix: adicionar `signalsBlock` + `deflectionBlock` quando `deflection_thematic` presente
Alvo verificável (P4): bot muda de tema no turn seguinte após deflection_thematic
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
- Ver comportamento obrigatório §0 acima — especialmente P1 e P3

---

## 11. Repos relacionados

```
~/ascendimacy-motor/   ← este repo (código)
~/ascendimacy-ops/     ← specs, handoffs, testes
~/ascendimacy-sts/     ← STS harness + scenarios + fixtures
```

Git pull nos três antes de iniciar sessão.

---

> 🌳 Crescer para colher.
> CLAUDE.md v3.0 — 2026-05-05
