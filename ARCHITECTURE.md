# ARCHITECTURE.md — ascendimacy-motor

> Single source of truth do motor canônico Ascendimacy.
> Documento vivo. Atualiza a cada PR significativo. Substitui leitura
> dispersa de specs, handoffs e PRs antigos para entender o estado atual.

**Versão:** 1.0 — 2026-04-25
**Cobre PRs:** motor#1 → motor#23
**Pendente:** motor#24 (smoke-3d hardening — pool slim + prompt cache + parse fallback)

---

## 1. O que é o motor canônico

Três processos Node apartados (`planejador`, `motor-drota`, `motor-execucao`)
comunicando via MCP stdio, orquestrados por um quarto processo (`orchestrator`).
Cada um carrega responsabilidade única, fala via contratos tipados, e roda com
seu próprio LLM configurável (ou determinístico, no caso do motor de execução).

A separação não é estética: ela é o **POC do manifesto docker linguístico** —
hipótese de que sistemas Ascendimacy são melhor organizados como containers
de processo com interface estrita, não como módulos acoplados num monolito.
Se esta arquitetura escalar, ela vira o template para Drota Corporativa,
Bloom, IDC interview e demais produtos.

Sujeito de teste primário: **Paula Mendes** (persona em `fixtures/paula-mendes.yaml`)
e **Ryo + Kei Ochiai** (personas para o piloto eBrota Kids Nagareyama).

---

## 2. As 4 camadas da arquitetura

```
                 ┌──────────────────────────────────────────┐
                 │  USUÁRIO (criança, adulto, persona-sim)  │
                 └────────────────┬─────────────────────────┘
                                  │
                                  ▼
        ┌──────────────────────────────────────────────────┐
        │           ORCHESTRATOR (CLI + MCP clients)       │
        │  • Conecta os 3 servers via stdio                │
        │  • Auto-hook: detect_achievement → emit_card     │
        │  • Trace writer (NDJSON v0.3.x)                  │
        └─────┬───────────────┬─────────────────┬──────────┘
              │               │                 │
              ▼               ▼                 ▼
       ┌────────────┐  ┌──────────────┐  ┌──────────────────┐
       │ PLANEJADOR │  │ MOTOR DROTA  │  │ MOTOR EXECUÇÃO   │
       │ Estratégia │  │ Tática       │  │ Infraestrutura   │
       │            │  │              │  │                  │
       │ Sonnet 4.6 │  │ Kimi K2.5    │  │ Determinístico   │
       │   OU       │  │   OU         │  │ + SQLite         │
       │ Kimi K2.5  │  │ Mistral 3    │  │                  │
       │ (default)  │  │              │  │                  │
       └────────────┘  └──────────────┘  └──────────────────┘
              │               │                 │
              └───────────────┴─────────────────┘
                              │
                              ▼
                      ┌────────────────┐
                      │    SHARED      │
                      │  (contracts +  │
                      │   scoring +    │
                      │   primitives)  │
                      └────────────────┘
```

### Responsabilidades estritas

**Planejador (estratégia).** Recebe `(state, persona, incomingMessage)`.
Decide *qual conjunto de ações vale considerar agora*. Aplica:

- Eligibility (age gate, sessionMode/joint filter, refusal cooldown).
- Scoring determinístico (`scoreItem` + `scorePool` em shared).
- Slice top-K do pool.
- Aplica `parent_pinned` / `parent_rejected` (override parental) e
  `used_in_session` (penalty -100 contra repetição).
- Compõe `instruction_addition` quando programa Gardner ou onboarding ativos.
- Emite `contextHints` (urgency, language, joint state, gardner_pause_reason).

LLM aqui é usado **apenas para `strategicRationale`** e refinar
`contextHints` — **não para escolher conteúdo**. Escolha é determinística.

**Motor Drota (tática).** Recebe `(contentPool, instruction_addition, persona, state, contextHints)`.
Decide:

- Qual item do pool vai ser materializado neste turn (re-rank com peso baixo).
- Como é a **fala em linguagem natural** que vai pro usuário (`linguisticMaterialization`).

Ancoragem é obrigatória: o output deve citar/adaptar o conteúdo do item
selecionado. Se o pool está vazio, usa fallback conversacional.
Se o LLM retorna texto não-JSON ("Could not generate..."), **isso quebra
hoje** — corrigido em motor#24 (parse fallback).

**Motor Execução (infraestrutura).** Sem LLM. Determinístico.

- `get_state(sessionId)` — hidrata SessionState do SQLite (incl. `statusMatrix`,
  `gardnerProgram`, `eventLog`, `treeNodes`).
- `execute_playbook(sessionId, playbookId, selectedContentId, materialization)` —
  aplica o turn, atualiza state, escreve event log com hash-chain.
- `detect_achievement(sessionId, prevMatrix, currMatrix, sacrificeSpent)` —
  retorna `AchievementSignal | null` (kinds: `status_to_pasto`, `ignition`,
  `sacrifice_high`, `crossing`).
- `emit_card_for_signal(signal, ...)` — pipeline server-side com scaffold guard.
- Persistência: tabelas `kids_*` em SQLite, ver §9.

**Orchestrator.** Não é uma camada conceitual; é **plumbing**. Conecta os 3
servers, faz auto-hook (`detect_achievement` → `emit_card_for_signal` após
`execute_playbook`), escreve trace, propaga `STS_VIRTUAL_NOW` e `MOTOR_STATE_DIR`.

### O que isso NÃO é

- **Não é monolito disfarçado.** Cada processo sobe sozinho via `npm run dev:*`,
  pode ser swapado por outra implementação que respeite o contrato MCP.
- **Não é cliente de LLM.** Os LLMs são encapsulados em `llm-clients.ts` por
  servidor. Roteamento via `shared/src/llm-router.ts` (provider-aware, env-overridable).
- **Não é o produto eBrota Kids.** O motor é genérico; o produto é uma
  parametrização (persona profile + playbook + content pool).

---

## 3. Workspace — 6 packages

| Package | Tipo | Responsabilidade | Tem LLM? |
|---|---|---|---|
| `shared` | lib | Contracts, types, scoring, status matrix, debug-logger, llm-router | não |
| `planejador` | server | MCP server `plan_turn` + LLM call (Sonnet/Kimi) | sim |
| `motor-drota` | server | MCP server `evaluate_and_select` + LLM call (Kimi/Mistral) | sim |
| `motor-execucao` | server | MCP server (5 tools) + SQLite | não |
| `orchestrator` | CLI | `runTurn` + auto-hook + trace writer | não |
| `weekly-report` | lib | Aggregate + markdown + PDF para digest semanal | não |

**Build:** `npm run build` (workspace, 6 packages).
**Test:** `npm run test` (vitest, 479 verde no head atual).
**Smoke:** `npm run smoke` (rubric G1-G3 com mocks).

### Conteúdo crítico em `shared/`

```
shared/src/
├── contracts.ts             # Tipos MCP (PlanTurnInput, EvaluateAndSelectInput, etc.)
├── content-item.ts          # 7 tipos de ContentItem (curiosity_hook, card_archetype, etc.)
├── scorer.ts                # scoreItem + scorePool (puros, deterministicos, clock injetável)
├── status-matrix.ts         # canEmitChallenge + invariante brejo→baia→pasto
├── tree-node.ts             # Status matrix como rows em kids_tree_nodes
├── trace-schema.ts          # TurnTrace v0.3.x (versionado)
├── llm-router.ts            # Roteamento provider/model por step (env-overridable)
├── llm-config.ts            # Timeouts + retries + classifyLlmError
├── debug-logger.ts          # NDJSON event log + content-addressable store
├── card-catalog.ts          # CardArchetype, CardSpec, CardFront, CardBack
├── card-authenticity.ts     # HMAC-SHA256 sign/verify + QR base URL
├── card-cheat-code.ts       # 3-palavras determinístico + slugify unicode
├── card-image-provider.ts   # Interface + MockProvider (real é débito Bloco 6/7)
├── parental-authorization.ts # triageRuleBased + triageWithHaiku + dispatch
├── gardner-onboarding.ts    # onboarding sessions → GardnerAssessment
├── bullying-check.ts        # 5 patterns pt-br + ja, NÃO flaga diferenciação saudável
└── mixins/
    └── with-gardner-program.ts # Composer 5 semanas × 3 fases
```

---

## 4. Contratos MCP — tabela canônica

### Planejador

| Tool | Input | Output |
|---|---|---|
| `plan_turn` | `{sessionId, state, persona, incomingMessage, sessionMode?}` | `{strategicRationale, contentPool: ScoredContentItem[], instructionAddition?, contextHints}` |

### Motor Drota

| Tool | Input | Output |
|---|---|---|
| `evaluate_and_select` | `{sessionId, contentPool, instructionAddition?, state, persona, strategicRationale, contextHints}` | `{selectedContent: ScoredContentItem, linguisticMaterialization, skipReason?, rawOutput?}` |

### Motor Execução

| Tool | Input | Output |
|---|---|---|
| `get_state` | `{sessionId}` | `SessionState` (com `statusMatrix`, `gardnerProgram`, `eventLog`, `treeNodes`) |
| `execute_playbook` | `{sessionId, playbookId, selectedContentId?, materialization, incomingMessage}` | `{newState, eventLogEntry}` |
| `detect_achievement` | `{sessionId, previousMatrix, currentMatrix, sacrificeSpent}` | `{signal: AchievementSignal \| null}` |
| `emit_card_for_signal` | `{signal, persona, sessionId, sessionContext}` | `{cardId?, skipped?, skipReason?}` |
| `parent_decision_set` / `parent_decision_list` | (CRUD parental decisions) | — |
| `gardner_program_{start,advance,pause,resume}` | (CRUD programa Gardner) | — |
| `card_save` / `card_list_by_child` / `card_list_by_session` / `card_list_in_range` | (CRUD cards emitidos) | — |

### Trace v0.3.x

Schema versionado em `shared/src/trace-schema.ts`. Cada `TurnTrace` carrega:

```
{
  turnNumber,
  incomingMessage,
  finalResponse,
  statusSnapshot,
  gardnerProgramSnapshot,        // week, day, phase, paused, pause_reason
  selectedContent,
  gardnerChannelsObserved,
  caselTargetsTouched,
  sacrificeSpent,
  screenSeconds,
  instructionAdditionApplied,
  statusTransitions,
  flags,
  emittedCardId?,
  cardEmissionSkipReason?,
  parseFailure?                  // motor#24
}
```

Bumpa versão minor quando adiciona campo opcional, major quando muda shape.

---

## 5. Fluxo de um turn — passo a passo

```
1.  orchestrator.runTurn(sessionId, personaId, incomingMessage)
        │
        ▼
2.  motor-execucao.get_state(sessionId)
        ↓ retorna state com prev_status_matrix snapshot
        │
3.  prevStatusMatrix = { ...state.statusMatrix }   (snapshot pré-turn)
        │
        ▼
4.  planejador.plan_turn({state, persona, incomingMessage})
        │   ├── load content pool (filter por age + sessionMode + refusal)
        │   ├── apply parent_pinned / parent_rejected
        │   ├── apply used_in_session penalty (-100)
        │   ├── scorer.scorePool(eligibles)
        │   ├── slice top-K (motor#24: + char budget 2000)
        │   ├── compose instruction_addition (gardner / onboarding)
        │   ├── LLM call (Sonnet/Kimi) → strategicRationale + contextHints
        │   └── retorna { strategicRationale, contentPool, instructionAddition, contextHints }
        │
        ▼
5.  motor-drota.evaluate_and_select({contentPool, instructionAddition,
                                     state, persona, strategicRationale, contextHints})
        │   ├── build prompt (5 blocos Anthropic)
        │   ├── motor#24: prefix estável com cache_control
        │   ├── LLM call (Kimi/Mistral) com timeout 90s, max_tokens 2048-4096
        │   ├── parse JSON → { selectedContent, linguisticMaterialization }
        │   ├── motor#24: parse fallback se "Could not [...]" → contentPool[0] + skipReason
        │   └── sanitize (remove forbidden words, identificadores técnicos)
        │
        ▼
6.  motor-execucao.execute_playbook({sessionId, playbookId,
                                     selectedContentId, materialization})
        │   ├── update tree_nodes (status matrix transitions)
        │   ├── append event_log com hash-chain
        │   └── retorna newState
        │
        ▼
7.  motor-execucao.get_state(sessionId)   (re-fetch para currMatrix)
        │
        ▼
8.  AUTO-HOOK (orchestrator):
        sacrificeSpent = selectedContent.sacrifice_amount ?? 0
        signal = detect_achievement({prevMatrix, currMatrix, sacrificeSpent})
        if signal: emit_card_for_signal(signal, ...)
        │
        ▼
9.  orchestrator.appendTurn(traceWriter, turnTrace)
        ├── escreve fixtures/traces/<persona>/<sessionId>/trace.json
        └── se ASC_DEBUG_MODE: NDJSON em logs/debug/<run_id>/events.ndjson
```

Latência típica (real-llm, Kimi K2.5 via Infomaniak):

- planejador: 3-7s
- motor-drota: 4-10s (com reasoning)
- motor-execucao: 10-50ms (cada call)
- **Total por turn: 8-18s**

---

## 6. Schema de Content Items + scoring

### Os 7 tipos de ContentItem

Discriminated union em `shared/src/content-item.ts`. Todos compartilham campos
base (`id`, `domain`, `casel_target`, `gardner_channels`, `age_min`, `age_max`,
`group_compatible`, `sacrifice_type`, `sacrifice_amount?`).

| Tipo | Uso | Hoje populado? |
|---|---|---|
| `curiosity_hook` | Fato + bridge + quest para sessão regular | sim (85 items em `content/hooks/seed.json`) |
| `cultural_diamond` | Conceito profundo (kintsugi, ubuntu, mottainai) | scaffolds |
| `card_archetype` | Arquétipo de carta (epic/legendary/rare/common) | 5 scaffolds em `content/cards/archetypes-seed.json` |
| `gtd_review` | Item de review (GTD adulto) | não — Drota Corporativa |
| `gtd_task` | Task GTD | não |
| `dynamic` | Técnica de grupo (tier_list, teach_back) | não — Bloco 6 |
| `challenge` | Quest standalone | não — Bloco 6 |

**v1 (motor atual) é hooks-only.** Outros tipos passam pelo schema mas
fazem fallback genérico na serialização do drota. Bloco 5b (Content Engine
charter) traz arquétipos editoriais reais.

### Scoring (determinístico)

Implementado em `shared/src/scorer.ts`. Função pura, clock injetável.

```
score = base_score
      + parent_pinned_bonus       (+1000 se persona.profile.parent_pinned_ids inclui)
      − parent_rejected_penalty   (−1000 se rejected)
      + casel_focus_bonus         (+15 se casel_target inclui dim ativa)
      + tree_top_domain_bonus     (+10 se domain == top do tree)
      + surprise_bonus            (+8 se domain != recent_3)
      − recent_domain_penalty     (−12 se domain em recent_3)
      + engagement_bonus          (+5 se engagement_history[id] > 0.7)
      − used_in_session_penalty   (−100 se id em eventLog desta session)  ← motor#23
      × decay_factor              (half-life temporal por tipo de item)
```

**Decisões importantes:**

- **`used_in_session` é -100, não -1000.** Permite reuso eventual se nada
  melhor sobrar; mas garante que próxima call drota não vai pegar o mesmo
  hook do turn anterior. (Corrige reuso massivo de `bio_dolphin_names` em
  smoke-3d antes do motor#23.)
- **`parent_pinned` vence tudo.** Bloqueio parental é override absoluto.
- **`surprise` vs `recent_domain` se cancelam parcialmente.** Visto na
  prática produz rotação saudável de domínios sem repetir.
- **Half-life é por tipo:** hooks 30 dias, cards permanente, dynamics 7 dias.

---

## 7. Configuração de providers (LLM router)

Implementado em `shared/src/llm-router.ts` (motor#21). **Defaults: TUDO Kimi K2.5
via Infomaniak**, zero dependência de Anthropic.

### Steps e providers

| Step | Provider default | Model default | Override env |
|---|---|---|---|
| `planejador` | infomaniak | `moonshotai/Kimi-K2.5` | `PLANEJADOR_PROVIDER`, `PLANEJADOR_MODEL` |
| `drota` | infomaniak | `moonshotai/Kimi-K2.5` | `DROTA_PROVIDER`, `DROTA_MODEL` (legacy: `MOTOR_DROTA_MODEL`) |
| `persona-sim` | infomaniak | `moonshotai/Kimi-K2.5` | `PERSONA_SIM_PROVIDER`, `PERSONA_SIM_MODEL` |
| `haiku-triage` | infomaniak | `mistral3` | `HAIKU_TRIAGE_PROVIDER`, `HAIKU_TRIAGE_MODEL` |
| `haiku-bullying` | infomaniak | `mistral3` | `HAIKU_BULLYING_PROVIDER`, `HAIKU_BULLYING_MODEL` |

### Override global

```bash
LLM_PROVIDER=anthropic     # força todos os steps para Anthropic
USE_MOCK_LLM=true          # força mocks (CI default)
```

### Timeouts e retries (motor#20)

| Step | Timeout | Retries |
|---|---|---|
| planejador | 30s | 3 |
| drota | 90s | 2 |
| haiku-triage | 15s | 2 |
| persona-sim | 30s | 3 |

Override via `ASC_LLM_TIMEOUT_<STEP>` (segundos) ou `ASC_LLM_MAX_RETRIES_<STEP>`.
Globais: `ASC_LLM_TIMEOUT_SECONDS`, `ASC_LLM_MAX_RETRIES`.

### Reasoning capture

`LlmCallResult` carrega `{ content, reasoning?, tokens: { in, out, reasoning } }`.

- **Anthropic Sonnet 4.6:** extended thinking ON em debug mode (budget 1024).
- **Kimi K2.5 / DeepSeek-R1 via Infomaniak:** campo `reasoning` exposto pelo
  OpenAI-compat layer; capturado e logado.

---

## 8. Debug mode + observability

Spec: [`docs/specs/2026-04-24-debug-mode.md`](https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/specs/2026-04-24-debug-mode.md) em ascendimacy-ops.

### Ativação

```bash
ASC_DEBUG_MODE=true
ASC_DEBUG_RUN_ID=<custom>   # opcional, auto-gen se omitido
ASC_DEBUG_DIR=./logs/debug  # opcional
```

### Layout

```
logs/debug/<run_id>/
├── manifest.json            # metadata: scenario, personas, started_at, env
├── events.ndjson            # 1 linha = 1 evento, cronológico, cross-process
├── content/<sha256>.txt     # CAS dedup: prompts, responses, reasoning
└── snapshots/<sha256>.json  # CAS dedup: SessionState, contentPool, contextHints
```

### O que é logado

Por evento (NDJSON):
```
{
  "ts": "...",
  "step": "planejador|drota|motor-execucao",
  "kind": "llm_call|state_snapshot|achievement_detection|card_emission",
  "user_id": "ryo-ochiai",
  "turn": 3,
  "tokens": { "in": 1234, "out": 567, "reasoning": 890 },
  "latency_ms": 4521,
  "snapshots_pre": ["sha256:abc..."],
  "snapshots_post": ["sha256:def..."],
  "outcome": "success|error",
  "error_class": "..."
}
```

Conteúdo grande (prompts, responses, reasoning chains, state JSON) vive em
`content/` e `snapshots/` por SHA256 — dedup automático.

### Replay cronológico

```bash
node scripts/debug-timeline.mjs --run <run_id>
node scripts/debug-timeline.mjs --run <run_id> --user ryo-ochiai
node scripts/debug-timeline.mjs --run <run_id> --step drota
node scripts/debug-timeline.mjs --run <run_id> --turn 5
node scripts/debug-timeline.mjs --run <run_id> --tokens-only
node scripts/debug-timeline.mjs --run <run_id> --reasoning-only
node scripts/debug-timeline.mjs --run <run_id> --list
```

Ordena por wall-clock `ts`, resolve hashes CAS, renderiza timeline legível
com snapshots inline.

### Custo

- **Flag OFF:** zero overhead, zero writes.
- **Flag ON:** +5-10ms/call, +50-200MB/run, +~2× custo Sonnet (thinking tokens).

---

## 9. Persistência (SQLite)

Tabelas em `motor-execucao/src/state-manager.ts` + DDLs incrementais.
Path do DB: `MOTOR_STATE_DIR/state.db` (default `./fixtures/state/state.db`).

### Tabelas principais

| Tabela | Conteúdo | DDL em |
|---|---|---|
| `kids_helix_state` | active_dimension, progress, cycle_phase, cycle_day, queue, deferred, completed | state-manager.ts |
| `kids_tree_nodes` | Status matrix (session × zone × key UNIQUE), populada via upsertNode | tree-nodes.ts |
| `kids_event_log` | append-only com hash-chain (event_id, type, sensitivity, participants, evidence) | event-log.ts |
| `kids_gardner_program` | session_id PK, week, day, phase, paused, pause_reason, phases_completed | gardner-program.ts |
| `kids_parent_decisions` | content_id × persona × decision (pending/approved/rejected/pinned) | parent-decisions.ts |
| `kids_emitted_cards` | card_id PK, child_id, archetype_id, signature HMAC, front/back JSON | cards-repo.ts |

### Invariantes

- **Status matrix transitions são policiadas no `applyStatusTransition`** —
  invariante `brejo → baia → pasto` (não pula direto brejo→pasto exceto em
  kind `status_to_pasto`).
- **Event log tem hash-chain.** Qualquer corrupção é detectável.
- **`parent_decisions.UNIQUE(content_id, persona)`** garante 1 decisão ativa
  por par; histórico vai pra evento, não duplica row.
- **Card archetypes com `is_scaffold: true` são bloqueados em
  `env !== 'test'`** — guard explícito em `emit_card_for_signal`.

### Virtual clock + state dir

- `STS_VIRTUAL_NOW` (ISO timestamp) — todos os `getNow()` respeitam.
- `MOTOR_STATE_DIR` — todos os `resolveDbPath()` respeitam.

Permite scenario runner (sts) rodar 30 dias simulados em segundos com
state dir isolado por scenario.

---

## 10. Histórico de PRs — motor#1 → motor#23

Cada PR fechou um milestone discreto. Lista compacta para ancoragem temporal.

| PR | Data | Foco | Status |
|---|---|---|---|
| **motor#1** | 23-abr | MVP walking skeleton (H0-H8 inteiro num PR) | merged |
| motor#2 | 23-abr | Cleanup pós-MVP — updateState merge, sanitize word boundaries | merged |
| motor#3 | 23-abr | Motor canônico MVP (re-aberto/redo) | merged |
| motor#7 | 23-abr | Issue arch — contextHints não chegam no drota (causa raiz #4-6) | closed |
| motor#8 | 24-abr | Fix propagar contextHints + detecção de língua | merged |
| **motor#9** | 24-abr | Bloco 1 #17 — schemas e primitives (content-item + scorer + 85 hooks) | merged |
| **motor#10** | 24-abr | Bloco 2a — retrofit candidateActions→contentPool + status matrix como tree_nodes | merged |
| **motor#11** | 24-abr | Bloco 2b — mixin withGardnerProgram (5 semanas × 3 fases) | merged |
| **motor#12** | 24-abr | Bloco 3 — observabilidade completa (trace v0.3 + weekly-report PDF) | merged |
| **motor#13** | 24-abr | Bloco 4 — onboarding parental + autorização 3 camadas | merged |
| **motor#14** | 24-abr | Bloco 5a — card generation runtime (schema + pipeline + HMAC + PDF) | merged |
| **motor#15** | 24-abr | Bloco 6 — dinâmicas em grupo (dyad Ryo+Kei) | merged |
| motor#16 | 24-abr | Virtual clock + MOTOR_STATE_DIR env (prep sts#6 scenario runner) | merged |
| motor#17 | 24-abr | Hotfix Bloco 5a — auto-hook detectAchievement + emit_card | merged |
| motor#18 | 25-abr | Bloco 7 prep — kind crossing + prev_matrix snapshot + inventário enriquecido | merged |
| **motor#19** | 25-abr | **Debug mode** — observability completa do pipeline LLM | merged |
| motor#20 | 25-abr | LLM robustness — timeouts + retries + classifier + tests | merged |
| **motor#21** | 25-abr | **LLM router multi-provider** — defaults TUDO Kimi via Infomaniak | merged |
| motor#22 | 25-abr | Hotfix provider-aware mock detection | merged |
| motor#23 | 25-abr | Drota prompt clarity + pool used_in_session penalty (corrige reuso) | merged |

**Estado head (post-motor#23):** 479 testes verde, build clean, smoke-3d passou
com Kimi via Infomaniak (cards emergiram, mas com 3 achados pendentes).

### Negrito = milestone arquitetural

PRs em **negrito** mudaram contratos ou trouxeram nova capacidade fundamental.
Os outros são fixes/hotfixes/preps.

### Bug issues ainda abertas

- **motor#4 (B-001 Paula)** — repetição literal + artefato prometido não entregue
- **motor#5 (B-002 Ryo)** — planejador perde contexto + muda regras mid-conversation
- **motor#6 (B-003 Kei)** — alucinação de estados emocionais sem base no incoming

Estavam atribuídas a state integration quebrado (corrigido em motor#8).
**Ainda não fechadas porque não foram re-validadas com STS v0.2 head + Kimi.**
Provável que estejam parcial ou totalmente resolvidas — Bloco 7 piloto vai validar.

---

## 11. Débitos abertos e roadmap próximo

### Imediato — motor#24 (smoke-3d hardening)

Handoff: [`docs/handoffs/2026-04-25-cc-motor-19-followup.md`](https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/handoffs/2026-04-25-cc-motor-19-followup.md)

Três fixes em 1 PR (~3-4h CC):

1. **content_pool slim** — `slicePoolForDrota` no planejador (top-K=7 +
   maxTotalChars=2000 + excludeUsedInSession). Reduz prompt drota de
   ~4400 chars → ~2000 chars.
2. **Prompt cache prefix** — quebrar drota system prompt em 2 blocos
   com `cache_control: ephemeral` (Anthropic) + `prompt_cache_key`
   (Infomaniak best-effort). Em run de 30 dias × ~22 events × 6 calls,
   economiza ~99K tokens redundantes.
3. **Parse fallback** — try/catch + regex extract + hard fallback para
   `contentPool[0]` quando Kimi retorna "Could not [...]" em vez de JSON.

### Médio prazo — Bloco 7 (piloto Nagareyama)

Issue: [ascendimacy-ops#382](https://github.com/ascendimacy/ascendimacy-ops/issues/382)

- Fase 1: smoke-3d simulado (✅ rodou pre-motor#24, validar pós)
- Fase 2: nagareyama-30d simulado (pendente)
- Fase 3: análise de findings + Channel Diversification spec (se necessário)
- Fase 4 (opcional): real-llm 30 dias ($15-50)
- Fases 5-9: texto JP Yuji/Yuko, consentimento, archetypes editoriais,
  CardImageProvider real, piloto Nagareyama com Ryo+Kei.

### Longo prazo — pós-piloto

- **Channel Diversification refactor** — se findings da Fase 3 mostrarem
  necessidade. Spec já existe em `docs/specs/2026-04-24-channel-diversification-refactor.md`.
- **Bloco 8** — infra WhatsApp-bot real (hoje há scenario runner, mas
  deploy real é outro escopo).
- **CardImageProvider real** — Anthropic Vision vs Gemini vs Replicate+LoRA.
  Issue: ascendimacy-ops#381.
- **Drota Corporativa parametrização** — usar mesmo motor com perfil
  diferente. v2 do MOTOR-DROTA spec, planejado em #130.

### Pendências em aberto não-resolvidas

- **STS v0.2 re-run** das 3 personas (Paula, Ryo, Kei) com Kimi — para
  validar se motor#4-6 estão de fato resolvidos.
- **CLAUDE.md atualizar** — está fóssil em "H0-H8 walking skeleton".
  Trabalho menor, candidato a delegar pro CC junto com motor#24.
- **Outros 6 ContentItem types** sem seeds — `cultural_diamond`,
  `gtd_review`, `gtd_task`, `dynamic`, `challenge`, `card_archetype`
  (este último com 5 scaffolds).

---

## 12. Onde encontrar o quê

Mapa para sessões novas (claude.ai e CC) — começa por aqui, navega daqui.

### Quero entender o motor inteiro
→ Este arquivo (`ARCHITECTURE.md`).

### Quero saber como o motor se posiciona no ecossistema
→ [`docs/specs/2026-04-23-docker-linguistico-manifesto.md`](https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/specs/2026-04-23-docker-linguistico-manifesto.md) em ascendimacy-ops.
→ [`docs/handoffs/2026-04-23-jun-claude-session-handoff.md`](https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/handoffs/2026-04-23-jun-claude-session-handoff.md) (sessão original).

### Quero a teoria pedagógica do eBrota Kids
→ [`docs/specs/2026-04-24-ebrota-learning-mechanics-paper.md`](https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/specs/2026-04-24-ebrota-learning-mechanics-paper.md).
→ [`docs/handbooks/ebrota-toolkit-v0.1/`](https://github.com/ascendimacy/ascendimacy-ops/tree/main/docs/handbooks/ebrota-toolkit-v0.1) (livro de 12 partes).

### Quero entender content items e scoring
→ §3 e §6 deste arquivo.
→ [`docs/specs/2026-04-24-materialization-strategy.md`](https://github.com/ascendimacy/ascendimacy-ops/blob/main/docs/specs/2026-04-24-materialization-strategy.md) §3.2 schema, §3.3 scorer.

### Quero rodar scenarios sintéticos
→ Repo `ascendimacy-sts` (separado).
→ `npx sts run-scenario scenarios/smoke-3d.yaml --verbose`
→ Para real-llm: `--real-llm` flag (precisa `INFOMANIAK_API_KEY`).

### Quero debugar um run específico
→ §8 deste arquivo (debug mode).
→ `node scripts/debug-timeline.mjs --run <run_id>`.

### Quero saber o que cada PR fez
→ §10 deste arquivo (tabela compacta).
→ Cada PR no repo tem corpo detalhado: https://github.com/ascendimacy/ascendimacy-motor/pulls?q=is%3Apr+is%3Aclosed

### Quero rodar testes
```bash
npm install
npm run build
npm run test    # 479 verde
npm run smoke   # rubric G1-G3 com mocks
```

### Quero entender contratos MCP exatos (tipos)
→ `shared/src/contracts.ts` (fonte de verdade).
→ §4 deste arquivo (tabela navegável).

### Quero abrir um PR novo
→ Lê este arquivo + `CLAUDE.md` (instruções específicas pra CC).
→ Procura precedente em PRs análogos (§10).
→ Sempre adiciona testes (`vitest`).
→ `npm run build && npm run test && npm run smoke` antes do push.

---

## 13. Componentes sensoriais (motor#25)

Antes do motor#25, motor-drota tinha só um componente sensorial: Environment
Assessor lendo state_vector escalar (mood, trust, engagement_signal categórico).
Signals semânticos profundos — frame filosófico, frame rejection, meta-cognição,
auto-aceitação, auto-deprecação — não tinham onde ser capturados. Quando Kei
disse "não preciso ser borboleta" (frame filosófico de auto-aceitação claro),
literalmente nenhum componente do motor enxergou.

Motor#25 introduz **Signal Extractor** como segundo componente sensorial,
rodando ANTES do Environment Assessor.

### Pipeline sensorial (post-motor#25)

```
user_message
    ↓
[1. Signal Extractor]  ← NOVO motor#25
    ↓ extract_signals MCP tool em motor-drota
    ↓ output: { signals: SemanticSignal[], evidence?, confidence? }
    ↓ persistido como event "signals_extracted" no event_log
    ↓
[2. Environment Assessor]  ← existente pré-#25
    ↓ lê state_vector (mood, trust, engagement_signal)
    ↓
[3. evaluate_and_select pipeline]
    ↓
linguisticMaterialization
```

### Taxonomia v0 (15 signals — DA-PRE-PILOTO-01)

Spec: `shared/src/semantic-signals.ts`. Lista canônica:

| Categoria | Signals |
|---|---|
| Frame e meta-cognição | `philosophical_self_acceptance`, `frame_rejection`, `meta_cognitive_observation`, `frame_synthesis` |
| Engajamento | `voluntary_topic_deepening`, `vulnerability_offering` |
| Distress markers | `distress_marker_high`, `distress_marker_low` |
| Deflexões | `deflection_thematic`, `deflection_silence` |
| Mood drift | `mood_drift_up`, `mood_drift_down` |
| Relacional | `peer_reference`, `authority_questioning`, `gatekeeper_resistance` |

Expandir conforme aparecem gaps no piloto. **30 antes de validar é
especificação no escuro.**

### Provider routing

Default: Infomaniak/Mistral3 (não-reasoning, ~5s/call). Razão: tarefa é
classificação de signals em texto curto, não exige reasoning chain.
Override via env `SIGNAL_EXTRACTOR_PROVIDER`/`SIGNAL_EXTRACTOR_MODEL`.

Fail-soft: erro do extractor não trava o turn — retorna `signals: []`,
`overall_confidence: 0`. Trigger Evaluator vê isso como "sem signals" e
não emite transition_evaluated.

**Raw response logging**: extractor sempre loga raw LLM output via
`logDebugEvent` (step `signal-extractor`) com flag `parse_fallback_taken`
nos snapshots_post — diferencia "modelo retornou vazio" de "parser engoliu
output malformado". Descoberto durante validação Gate A do motor#25 que
Mistral3 detectava signals corretamente mas formato JSON quebrava parsing.
Ver `motorops/decision-trail/2026-04-26-005-signal-extractor-prompt-tightening.md`.

### Read-only — não pondera scoring runtime

**Crítico**: Signal Extractor SÓ CAPTURA. Não influencia scoring,
selection, voice profile. Os signals alimentam:

1. **Trigger Evaluator** (§14) — função de transição
2. **MotorOps batch agg** (pós-piloto) — análise de padrões

Auto-tuning baseado em signals fica pra v1 pós-piloto, depois de validar
precision/recall com auditoria humana sobre traces reais.

---

## 14. Função de transição (motor#25)

Antes do motor#25, ARCHITECTURE.md §6 e §9 falavam em statusMatrix com
invariante `brejo → baia → pasto`, mas em nenhum lugar estava declarado
**o que faz statusMatrix se mover**. Sem isso, "pastor" era palavra:
motor não tinha critério para parar de empurrar archetypes da fase atual;
Pedagógico não conseguia medir eficácia.

Motor#25 introduz **schema declarativo per-perfil** em YAML, lido pelo
Planejador a cada turn.

### Filosofia (DA-PRE-PILOTO-02)

**Declarativo bloqueante**. Função computacional vira tech debt explícito
SE função estática mostrar-se insuficiente após 30d de piloto. Inverter
essa ordem = caixa-preta dobrada.

### Layout de arquivos

```
content/profiles/<profile_id>.transitions.yaml   ← schema declarativo
shared/src/transitions-schema.ts                  ← Zod validator
planejador/src/trigger-evaluator.ts               ← carrega + avalia
```

Profiles previstos: `kids`, `eprumo`, `drota-corp` (per ARCHITECTURE.md §1).
v0 commitado: `kids.transitions.yaml`.

### Schema YAML (kids v0)

```yaml
profile_id: kids
schema_version: v0
transitions:
  brejo_to_baia:
    required_signals:
      - philosophical_self_acceptance
      - voluntary_topic_deepening
    minimum_window_turns: 2
    confirmatory_signals: [...]
    regression_to_brejo_if: [distress_marker_high, ...]

  baia_to_pasto:
    required_signals:
      - meta_cognitive_observation
      - frame_synthesis
    minimum_window_turns: 5
    ...
```

### Trigger Evaluator — fluxo

`planejador/src/trigger-evaluator.ts` — função `evaluateAllTransitions`:

1. Carrega `<profile_id>.transitions.yaml` (cached em memória)
2. Coleta signals dos últimos 5 turns via `collectRecentSignals(eventLog)`
3. Conta turns desde último `transition_evaluated.fired=true` event
4. Avalia cada transição: required_signals match (OR default) + janela ok + sem regression
5. Retorna lista `TransitionEvaluationResult[]` em `PlanTurnOutput.transitionEvaluations`

Orchestrator loga cada como event `transition_evaluated` no event_log.

### v0: read-only — NÃO move statusMatrix

**Crítico em v0**: Trigger Evaluator SÓ EMITE EVENTOS. statusMatrix continua
sob controle manual via `inject_status` (smoke-3d/nagareyama-30d) ou outro
mecanismo externo.

Auto-movimentação baseada em transição fired fica pra v1 pós-piloto, depois
de validar precision/recall via auditoria humana de 30d de eventos
`transition_evaluated`.

### candidate_set entropy (handoff #25 B5)

Em paralelo, plan_turn calcula Shannon entropy sobre archetype_ids do pool
(`PlanTurnOutput.candidateSetEntropy`). Loga como event `candidate_set_emitted`.

Razão: smoke-3d mostrou drota selecionando o mesmo item 12x antes do
USED_IN_SESSION_PENALTY (motor#23). Com pool slim (motor#25 Tarefa 1) +
entropy log, dá pra detectar "carrossel upstream" — se entropy é baixa,
problema é do Planejador, não do drota.

Threshold de "baixa entropy" calibra-se com piloto. v0: só registra.

---

## Filosofia em 5 linhas

> O motor não inventa: ancora.
> A escolha estratégica é determinística; o LLM tem voz, não voto.
> Cada camada respeita seu escopo; bridge é nomeada, não tácita.
> Persistência é evento, não estado mutável.
> Crescer para colher.

---

## Versionamento deste documento

| Versão | Data | Mudança |
|---|---|---|
| 1.0 | 2026-04-25 | Versão inicial — cobre motor#1 → motor#23 + débitos motor#24 |
| 1.1 | 2026-04-26 | motor#25 — handoff #24 (pool slim + prompt cache + parse fallback) + handoff #25 (Pastor foundations: Signal Extractor §13 + Trigger Evaluator §14 + candidate_set entropy + transitions.yaml v0 + 15 signals taxonomy) |

Quando motor#26+ adicionar capacidade nova (provider, content type, mecânica),
bump minor. Quando contratos MCP mudarem shape (não retrocompatível),
bump major.

> 🌳 *Cada teto vira chão.*
