# Decision-trail 003 — transitions.yaml v0 declarativo (motor#25)

**Data**: 2026-04-26
**Tipo**: schema / config
**Componente**: shared (schema) + planejador (loader) + content/profiles (data)
**PR**: motor#25
**Reversibilidade**: média (reverter = remover plan.ts integration; YAML pode ficar)

## O que foi adicionado

Schema declarativo de função de transição da statusMatrix.

### Arquivos novos

- `content/profiles/kids.transitions.yaml` v0 — primeira função de transição commitada
- `shared/src/transitions-schema.ts` — Zod validator + `evaluateTransition`
- `planejador/src/trigger-evaluator.ts` — load YAML + cache + `evaluateAllTransitions`

### Schema kids v0

```yaml
profile_id: kids
schema_version: v0
transitions:
  brejo_to_baia:
    required_signals: [philosophical_self_acceptance, voluntary_topic_deepening]
    minimum_window_turns: 2
    confirmatory_signals: [voluntary_topic_deepening, mood_drift_up]
    regression_to_brejo_if: [distress_marker_high, 2_consecutive_deflexions]
  baia_to_pasto:
    required_signals: [meta_cognitive_observation, frame_synthesis]
    minimum_window_turns: 5
    confirmatory_signals: [voluntary_application_to_new_context, peer_reference]
    regression_to_baia_if: [distress_marker_high, explicit_request_for_simpler_framing]
```

## Decisões importantes

**DA-PRE-PILOTO-02 default: declarativo bloqueante**. Função computacional vira tech debt explícito SE função estática mostrar-se insuficiente após 30d de piloto. **Não inverter ordem** — função computacional sem hipótese declarada é caixa-preta dobrada.

**Match mode default: OR**. `required_signals: [A, B]` significa "A OU B basta". Mais permissivo pro v0 — ajustamos via piloto se ficar muito sensível.

**v0 read-only**: trigger-evaluator EMITE eventos `transition_evaluated` mas **NÃO move statusMatrix**. Movimentação real continua via `inject_status` (manual). Auto-mov fica pra v1 pós-piloto, depois de validar precision.

## Por que

Pré-motor#25, ARCHITECTURE.md §6 e §9 falavam em statusMatrix com invariante `brejo → baia → pasto` mas em **nenhum lugar estava declarado** o que faz a matrix se mover. Sem isso, "pastor" era palavra: motor não tinha critério para parar de empurrar archetypes da fase atual; Pedagógico não conseguia medir eficácia.

## Como evolui

Quando motor#26 (F6 Quality Gate + EfficacyIndex) e motor#27 (cultural defaults) mergerem, este YAML pode ganhar:
- `confidence_threshold: 0.7` por transição (override do default)
- `voice_profile_override: "ja_quiet_bridge"` por estado pra ajustar drota

Mudanças no YAML versionam via `schema_version` bump. Auto-loader cache de 60s in-memory invalida quando arquivo modificado.

## Métrica de sucesso

Smoke-3d-replay sobre traces existentes deve mostrar `transition_evaluated` event com `fired=false` (signals capturados via Signal Extractor mas não suficientes pra trigger). Validação positiva: caso Kei "não preciso ser borboleta" deve eventualmente disparar `philosophical_self_acceptance` → `brejo_to_baia.fired=true` em scenario com inject_status emocional=brejo.

## Refs

- `content/profiles/kids.transitions.yaml`
- `shared/src/transitions-schema.ts`
- `planejador/src/trigger-evaluator.ts`
- ARCHITECTURE.md §14 (adicionado neste PR)
- Handoff: `docs/handoffs/2026-04-26-cc-motor-pre-piloto-strategic-gaps.md` §motor#25
