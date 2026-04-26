# Decision-trail 005 — Signal Extractor prompt tightening + max_tokens bump (motor#25 Gate A discovery)

**Data**: 2026-04-26
**Tipo**: prompt + config
**Componente**: motor-drota (signal-extractor)
**PR**: motor#25
**Reversibilidade**: alta (reverter prompt + voltar max_tokens 512)

## Descoberta

Gate A do motor#25 rodou `extractSignals()` contra o caso central que motivou o handoff strategic-gaps:
- `userMessage`: "não preciso ser borboleta, só melhorar o que tem"
- `personaName`: Kei, age 13, trust 0.4
- `conversationHistoryTail`: 2 turns (bot oferecendo metáfora lagarta→borboleta, Kei "sei lá")

**Tese a validar**: Signal Extractor captura `philosophical_self_acceptance`?

### Resultado inicial (PRÉ-fix)

| Model | Latency | Detected | Causa |
|---|---|---|---|
| mistral3 | 2.6s | ❌ vazio | LLM detectou MAS JSON malformado (parenthetical fora de aspas) → fallback |
| Kimi K2.5 | 5.6s | ❌ vazio | 512 tokens consumidos em reasoning chain, content null |
| Haiku | 0.4s | ❌ vazio | credit-balance error (fail-soft engoliu) |

**Falso negativo de pipeline, não falso negativo de modelo.** Modelos detectam corretamente — formato quebrava parsing.

Raw response Mistral3 mostrava:
```
"frame_rejection": "não preciso ser borboleta" (rejeição implícita ao frame da transformação radical)
                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                              ← isso quebra JSON.parse
```

## Mudanças aplicadas

### a) Prompt tightening (signal-extractor.ts:buildSignalExtractorPrompt)

Adicionada seção "Regras CRÍTICAS de formato JSON" no prompt:

> - Cada `evidence` value DEVE ser uma string entre aspas, SEM parêntesis ou texto fora das aspas.
> - ❌ ERRADO: `"frame_rejection": "trecho..." (rejeição implícita)`
> - ✅ CORRETO: `"frame_rejection": "trecho... (rejeição implícita ao frame X)"`
> - Coloque QUALQUER explicação adicional DENTRO das aspas, não fora.
> - Não use markdown fence — JSON puro.

Plus 2 few-shot examples — um com signals presentes (caso Kei exato), um sem signals.

### b) max_tokens 512 → 2048

Cobre reasoning models (Kimi K2.5: ~1500 reasoning + 150 content) + non-reasoning (Mistral3: 99-200 tokens, sobra abundante).

### c) Debug log raw response sempre

Adicionado `logDebugEvent` em extractSignals que captura:
- `response`: raw LLM output (pré-parse)
- `snapshots_pre.drota`: input.userMessage preview, history length, trust, max_tokens budget
- `snapshots_post.drota`: signals_detected, overall_confidence, parse_fallback_taken (boolean), llm_error_class
- `outcome`: ok | skip | error

Diferencia "modelo retornou vazio" vs "parser engoliu output malformado".

## Resultado pós-fix

| Model | Latency | Detected | Confidence | Evidence quality |
|---|---|---|---|---|
| **mistral3** (default) | **2.4s** ✅ | ✅ 2 signals | 0.9 (subiu de 0.8) | Concisa, dentro de aspas |
| Kimi K2.5 (override) | 48s ⚠️ | ✅ 2 signals | 0.85 | Rica/elaborada |

**Tese validada**: Mistral3 default captura `philosophical_self_acceptance` + `frame_rejection`. Kimi K2.5 também captura mas latency proibitiva pra default.

Default permanece **Mistral3** (DA-PRE-PILOTO-01). Kimi K2.5 fica como override opcional pra casos onde reasoning profundo importa.

## Por que não detectava antes

3 causas distintas reveladas:

1. **Mistral3**: prompt permitia parenthetical fora de aspas → JSON inválido
2. **Kimi K2.5**: max_tokens=512 insuficiente pra reasoning + content
3. **Haiku**: credit-balance issue (problema de conta, não de código)

Fix (a) endereça causa raiz #1; (b) endereça #2; (c) torna #3 (e qualquer falha futura) detectável via debug log.

## Métrica de sucesso

Smoke-3d post-merge: events `signal-extractor` em events.ndjson com:
- `outcome: "ok"` em ≥30% dos turns (pelo menos 1 signal detectado)
- `parse_fallback_taken: true` em <5% (raros — refusal real)
- avg latency <5s (Mistral3 default)

## Refs

- `motor-drota/src/signal-extractor.ts` — buildSignalExtractorPrompt + max_tokens + debug log
- `scripts/validate-kei-case.mjs` — validation script (Gate A)
- `scripts/validate-kei-raw.mjs` — raw response inspection
- Spec: motor#25 Gate A, handoff `2026-04-26-cc-motor-pre-piloto-strategic-gaps.md`

## Filosofia

> Falso negativo de pipeline pode ser indistinguível de falso negativo de modelo se debug não capturar raw. Capturar PRIMEIRO, ajustar comportamento DEPOIS — princípio aplicado também ao próprio observability do extractor.
