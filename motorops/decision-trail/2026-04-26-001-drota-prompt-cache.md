# Decision-trail 001 — Drota prompt cache (motor#25 handoff #24 Tarefa 2)

**Data**: 2026-04-26
**Tipo**: prompt structure
**Componente**: motor-drota
**PR**: motor#25
**Reversibilidade**: alta (reverter = reverter STABLE_DROTA_PREFIX extraction)

## O que mudou

Drota system prompt era 1 string concat. Agora split em:

- **`STABLE_DROTA_PREFIX`** (const exportada): BLOCO 1 (Role) + BLOCO 4 (Example) + BLOCO 5 (Repeat critical). ~2KB. **Idêntico literalmente entre todas as calls drota** — viável pra cache_control.
- **`buildDrotaDynamicBody(input, selected)`**: BLOCO 2 (persona, state, rationale, hints, pool, selected, instruction) + BLOCO 3 (numbered instructions com interpolação `${persona.name}`, `${language}`, etc).

Versão do prefix: `STABLE_DROTA_PREFIX_VERSION = "v1"`. Bumpa quando conteúdo muda → invalida cache.

## Provider routing

- **Anthropic**: `system: [{type:"text", text:STABLE_DROTA_PREFIX, cache_control:{type:"ephemeral"}}, {type:"text", text:dynamicBody}]`. TTL default 5min (DA-MOTOR19FU-02 default).
- **Infomaniak/OpenAI-compat**: concat `STABLE_DROTA_PREFIX + "\n\n" + dynamicBody`. Cache automático em prefixos consistentes >1024 tokens (sem parameter explícito).

## Por que

Análise smoke-3d-bumped (motor#23) mostrou ~3KB de prompt prefix idêntico em 12 calls drota. Em run de 30d × ~22 events × 6 calls = 132 chamadas drota. 3KB × 132 = 396KB redundante. Cache write 1.25× / read 0.1× (Anthropic) → economia significativa.

## Métrica de sucesso

Pós-merge, smoke-3d real-llm com Anthropic provider override deve mostrar `cache_read_input_tokens > 0` na 2ª+ call em events.ndjson. Infomaniak deve reportar `prompt_tokens_details.cached_tokens > 0` (quando provider suportar).

## Refs

- `motor-drota/src/server.ts` — STABLE_DROTA_PREFIX export + buildDrotaDynamicBody
- `motor-drota/src/llm-client.ts` — cacheableSystemPrefix opcional em callLlm
- `shared/src/llm-router.ts` — sem mudanças (cache não muda routing)
- Handoff: `docs/handoffs/2026-04-25-cc-motor-19-followup.md` Tarefa 2
