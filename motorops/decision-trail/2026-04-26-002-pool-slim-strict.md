# Decision-trail 002 — Pool slim strict (motor#25 handoff #24 Tarefa 1)

**Data**: 2026-04-26
**Tipo**: scoring / pool
**Componente**: planejador (pool-builder)
**PR**: motor#25
**Reversibilidade**: alta (reverter = remover slicePoolForDrota call no return de planTurn)

## O que mudou

Antes do motor#25: `planTurn` retornava `topK = scored.slice(0, TOP_K_POOL=5)` direto.

Agora: `planTurn` aplica `slicePoolForDrota(topK, options)` antes de retornar. Defaults:

- `maxItems: 7`
- `maxTotalChars: 2000`
- `excludeUsedInSession: true` (filtra items com score ≤ 0)

## Lógica do slim

1. **Filtro score ≤ 0**: items penalizados pelo `USED_IN_SESSION_PENALTY` (motor#23, -100) caem fora antes de mais nada.
2. **Slice top-K**: max 7 items por score desc.
3. **Char budget**: se serialização total > 2000 chars, trunca campos `fact` (max 100), `bridge` (max 80), `quest` (max 60) iterando dos últimos pros primeiros (preserva top-rank intactos quando possível).

## Por que

Análise smoke-3d-bumped (motor#23) mostrou content_pool serializado em ~4400 chars no prompt drota — metade do prompt era pool. Drota reasoning logs mostravam Kimi "escolhendo" entre items já penalizados (signal forte mas modelo lia tudo).

DA-MOTOR19FU-01 default: slice por items primário, char limit safety net.

## Decisões importantes

**Por que no planejador, não no drota**: drota é executor, não ranker. Planejador tem contexto (eventLog, profile, gardner) pra decidir quem entra. Slim no planejador mantém contracts limpos — `contentPool` que chega no drota é o que vale.

**Por que truncate fact > bridge > quest**: fact típicamente tem 100-700 chars (dolphin: 'Golfinhos têm NOME...assovio único...amigos repetem'). bridge 80-200 chars. quest 60-150 chars. Truncar do MAIOR primeiro maximiza redução com menos perda de contexto.

## Métrica de sucesso

Smoke-3d post-merge: drota prompt cai de ~4400 → ~2000 chars. Verificável em `logs/debug/<run>/events.ndjson` step=drota — `prompt_chars` field.

## Refs

- `planejador/src/pool-builder.ts` — slicePoolForDrota
- `planejador/src/plan.ts` — chamada no fim de planTurn
- `shared/src/scorer.ts` — USED_IN_SESSION_PENALTY (motor#23)
- Handoff: `docs/handoffs/2026-04-25-cc-motor-19-followup.md` Tarefa 1
