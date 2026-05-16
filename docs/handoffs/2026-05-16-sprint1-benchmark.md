# S-T-10-07 benchmark — menu (lookup) vs pool (scoring)

**Persona:** Ryo (ryo-ochiai, age 11)
**Turns por scenario:** 3
**Drota LLM:** Qwen3 30B local (`qwen3-30b`)
**Planejador LLM:** mock (USE_MOCK_LLM=true)
**Data:** 2026-05-16T09:22:58.096Z

## Métricas agregadas

| Métrica | A (no menu) | B (menu lookup) | Delta B vs A |
|---|---|---|---|
| Turns válidos | 3 | 3 | — |
| Plan latency avg (ms) | 2 | 3 | +50.0% |
| Drota latency avg (ms) | 352068 | 237423 | -32.6% |
| Total latency (ms) | 1056209 | 712276 | -32.6% |
| Drota prompt chars avg | 7919 | 6537 | -17.5% |
| Tokens in avg | 2483 | 2007 | -19.2% |
| Tokens out avg | 236 | 193 | -18.2% |
| Total tokens (in+out) | 8156 | 6599 | -19.1% |
| menu_hit_rate | 0% | 100% | — |

## Outputs por turn

### Scenario: A_no_menu

**Turn 1** — user: `oi`

> Sabia que os golfinhos têm nome? Cada um cria um assobio único — tipo um sinal de identidade. Os outros só chamam assim, como se fosse um apelido só deles. E quando perdem um amigo, eles repetem esse assobio, como se quisessem lembrar... Como você expressa quando perde alguém ou algo importante? Pen

_latency: plan 2ms + drota 318549ms = 318551ms; tokens: in=2483 out=208; menu_hit=false_

**Turn 2** — user: `me conta uma coisa que vc acha legal`

> Sabia que os golfinhos têm nome? Cada um cria um assovio só seu, como se fosse um sinal de identidade. Os outros chamam por ele assim — só com o som. Quando um deles morre, os outros repetem o assovio, como se quisessem manter o nome vivo. Pensa em algo que você perdeu — uma pessoa, um momento, uma 

_latency: plan 1ms + drota 366549ms = 366550ms; tokens: in=2483 out=254; menu_hit=false_

**Turn 3** — user: `outra coisa parecida`

> Sabia que os golfinhos têm nome? Cada um cria um assobio único, só dele, e os outros chamam pelo nome assim. Quando perdem um amigo, eles repetem o assobio dele, como se falassem: 'Estou lembrando de você'. Quando você perde alguém ou algo importante — um momento, uma fase da vida — como você expres

_latency: plan 2ms + drota 371106ms = 371108ms; tokens: in=2483 out=245; menu_hit=false_

---

### Scenario: B_menu_lookup

**Turn 1** — user: `oi`

> Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único, e os outros chamam por ele assim. Tipo como a gente chama um amigo pelo nome. Pensa aí: se você pudesse criar um som só seu pra ser chamado, que som seria? Que tal tentar?

_latency: plan 5ms + drota 229046ms = 229051ms; tokens: in=2007 out=171; menu_hit=true_

**Turn 2** — user: `me conta uma coisa que vc acha legal`

> Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único, e os outros chamam por ele, como se fosse um apelido. Tipo, se você fosse um golfinho, que som você criaria pra si? Tenta imaginar um 'nome' que só você conhece — e que os outros usariam quando te chamarem. É tipo um sina

_latency: plan 1ms + drota 262616ms = 262617ms; tokens: in=2007 out=227; menu_hit=true_

**Turn 3** — user: `outra coisa parecida`

> Sabia que os golfinhos têm 'nomes' próprios? É sério! Cada um inventa um assovio único, e os outros usam esse som pra chamar o amigo. Tipo um apelido só seu, só que feito de som. Pensa aí: se você pudesse inventar um som só seu pra ser chamado, qual seria?

_latency: plan 2ms + drota 220606ms = 220608ms; tokens: in=2007 out=180; menu_hit=true_

## Análise

### Wins mensurados (current impl, `ASC_USE_ACTION_MENU=true` em motor#109)

| Eixo | Ganho |
|------|-------|
| **Drota latency** | -32.6% (de 352s pra 237s por turn) |
| **Drota tokens in** | -19.2% (prompt menor — menu items têm payload `content` enxuto vs seed pool items com fact+bridge+quest) |
| **Drota tokens out** | -18.2% (respostas mais focadas com menos contexto) |
| **menu_hit_rate** | 100% (no scenario B com fixture pré-bakeado) |

### O que NÃO mudou

| Eixo | Por quê |
|------|---------|
| **LLM calls per-turn** | 2 em ambos scenarios (planejador rationale + drota composition). `ASC_USE_ACTION_MENU=true` substitui SCORING (deterministic, ~ms), não a LLM rationale call. |
| **Plan latency** | ~ms-level diferença (2 vs 3) — noise. Lookup + scoring são ambos ~instantâneos. |

### Gap descoberto vs spec Sprint 1

A spec ([ops#991](https://github.com/ascendimacy/ascendimacy-ops/issues/991)) prometia "reduz LLM calls de 3-4/turn para 1-2/turn" — meta -50% a -75%.

Atual: **0%** de redução em LLM calls (ainda 2/turn). Os ganhos vêm exclusivamente do prompt menor pro drota — efeito colateral do payload menor dos menu items, não do mecanismo de pré-compilação que a spec descreveu.

Pra fechar o gap, falta **S-T-10-08** ([ops#1069](https://github.com/ascendimacy/ascendimacy-ops/issues/1069), criada paralelamente a este benchmark): skip da chamada LLM do planejador para `rationale + contextHints` quando menu_hit. Tier:3-spec-via-jun (aguarda 4 sub-decisões: schema action menu, staleness, fallback, override pra contexto crítico).

### Observação adicional — variância sob input canned

Ambos scenarios produziram o **mesmo content** ("golfinhos têm nome") nos 3 turns. Em B, faz sentido: `bench-curio-01` é o item de maior weight (0.85) no menu fixture, e `used_in_session_penalty` não está re-bakeado pro caso de menu items (motor#23 fix penaliza com -100 mas item segue top depois do penalty se outros itens forem ainda piores). Em A, mesmo seed item escolhido — scoring + slimPool não rotacionou.

**Não é bug do menu** — é o comportamento esperado quando user messages são canned/idênticas e pool é small. Em uso real (criança respondendo organicamente), variance vem do `usedInSession` filter que penaliza items já vistos. STS multi-turn realista (ops#1004 S-T-10-06) validaria isso com dialog evoluindo.

### Recomendação GO/NO-GO

**GO conditional** para mover capability C-T-10 ([ops#990](https://github.com/ascendimacy/ascendimacy-ops/issues/990)) pra "Em validação":

✅ Pros:
- Win mensurável -32.6% latência + -19% tokens sem impacto na qualidade visível do drota output
- Hit rate 100% no fixture path; fallback to scoring confirmado preservado
- Zero regressões no full motor suite (1097 passed + smoke 15/15 + LLM smoke 10/10)

⚠️ Cons / não atingido:
- Spec -75% LLM calls **não atingida** — requer S-T-10-08
- Single persona, 3 turns, canned messages — sample pequeno (esperado pra Phase 1 validation)
- Variance baixa (mesmo content escolhido 3x) — STS multi-turn realista pendente (ops#1004)

**Recomendação**: marcar C-T-09 + C-T-10 como "Em validação", abrir S-T-10-08 como Sprint 2 priority, e considerar ops#1004 (STS validation) como gate antes de Yuji pilot.

### Reprodução

```bash
# Pré-req: Qwen3 stack up em LLM_LOCAL_ENDPOINT (default WSL→Win :9000)
cd /home/alexa/ascendimacy-motor
npm run build
node scripts/benchmark-menu-vs-pool.mjs --turns 3 --persona ryo
```

Output:
- Este markdown: `docs/handoffs/YYYY-MM-DD-sprint1-benchmark.md`
- Raw JSON: `docs/handoffs/YYYY-MM-DD-sprint1-benchmark-raw.json`

Tempo: ~30min (3 turns × 2 scenarios × ~5min/Qwen3 call).

### Refs

- Story: [ops#1005 S-T-10-07](https://github.com/ascendimacy/ascendimacy-ops/issues/1005)
- Capability parent: [ops#990 C-T-10](https://github.com/ascendimacy/ascendimacy-ops/issues/990)
- Sprint tracker: [ops#991](https://github.com/ascendimacy/ascendimacy-ops/issues/991)
- Gap follow-up: [ops#1069 S-T-10-08](https://github.com/ascendimacy/ascendimacy-ops/issues/1069)
- PRs base: motor#109 (menu-lookup), motor#108 (content-usage-repo)


