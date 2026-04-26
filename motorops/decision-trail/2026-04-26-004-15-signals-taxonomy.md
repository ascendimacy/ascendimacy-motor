# Decision-trail 004 — 15 signals taxonomy v0 (motor#25)

**Data**: 2026-04-26
**Tipo**: taxonomia / sensorial
**Componente**: shared (taxonomy) + motor-drota (Signal Extractor)
**PR**: motor#25
**Reversibilidade**: alta (reverter = remover SEMANTIC_SIGNALS const + rollback Signal Extractor)

## Taxonomia v0

15 signals em `shared/src/semantic-signals.ts`:

| Categoria | Signals |
|---|---|
| Frame e meta-cognição | philosophical_self_acceptance, frame_rejection, meta_cognitive_observation, frame_synthesis |
| Engajamento | voluntary_topic_deepening, vulnerability_offering |
| Distress markers | distress_marker_high, distress_marker_low |
| Deflexões | deflection_thematic, deflection_silence |
| Mood drift | mood_drift_up, mood_drift_down |
| Relacional | peer_reference, authority_questioning, gatekeeper_resistance |

## Decisões importantes

**DA-PRE-PILOTO-01 default: 15 signals**. Expandir conforme aparecem gaps no piloto. **30 antes de validar é especificação no escuro.**

**Categorias por valor pedagógico**:
- Frame/meta = mais alto valor (sinais de transição brejo→baia→pasto)
- Engajamento = profundidade da conversa
- Distress = safety markers (high pode disparar regression_to_brejo)
- Deflexões = barreira/resistência
- Mood drift = comparativo com turns anteriores
- Relacional = dinâmica social (peer/authority/gatekeeper)

## Signal Extractor (LLM-as-listener)

`motor-drota/src/signal-extractor.ts` — função `extractSignals(args)`:

- **Default provider**: Infomaniak/Mistral3 (não-reasoning, ~5s/call)
- **Justificativa**: classificação de signals em texto curto não exige reasoning chain. Override via `SIGNAL_EXTRACTOR_PROVIDER`/`SIGNAL_EXTRACTOR_MODEL`.
- **Read-only**: não muta state, apenas observa
- **Fail-soft**: erro retorna `{signals: [], overall_confidence: 0}` — Trigger Evaluator vê como "sem signals" e não dispara

MCP tool `extract_signals` exposto pelo motor-drota server. Orchestrator chama antes de `plan_turn`, loga resultado como `signals_extracted` event no event_log.

## Output schema

```ts
interface SignalExtractionResult {
  signals: SemanticSignal[];                              // detectados
  evidence?: Partial<Record<SemanticSignal, string>>;     // trecho que evidenciou
  overall_confidence?: number;                            // 0-1 agregado
}
```

## Métrica de sucesso

Smoke-3d-replay sobre traces existentes (especialmente sessions Kei "não preciso ser borboleta") deve capturar `philosophical_self_acceptance` no momento certo. Limite v0: persona STS Sonnet imitando Kei provavelmente é fraca em signals filosóficos profundos — aceitar baseline ~50% recall e refinar com piloto real.

## Refs

- `shared/src/semantic-signals.ts` — taxonomia + descriptions
- `motor-drota/src/signal-extractor.ts` — extractor + parser
- ARCHITECTURE.md §13 (adicionado neste PR)
- Handoff: `docs/handoffs/2026-04-26-cc-motor-pre-piloto-strategic-gaps.md` §motor#25
- Filosofia: capturar PRIMEIRO, ajustar comportamento DEPOIS
