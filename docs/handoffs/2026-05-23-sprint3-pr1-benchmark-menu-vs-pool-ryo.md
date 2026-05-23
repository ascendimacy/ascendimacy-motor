# S-T-10-07 benchmark — menu (lookup) vs pool (scoring)

**Persona:** Ryo (ryo-ochiai, age 11)
**Turns por scenario:** 3
**Drota LLM:** Qwen3 30B local (`qwen3-30b`)
**Planejador LLM:** mock (USE_MOCK_LLM=true)
**Data:** 2026-05-23T04:33:47.426Z

## Métricas agregadas

| Métrica | A (no menu) | B (menu lookup) | Delta B vs A |
|---|---|---|---|
| Turns válidos | 3 | 3 | — |
| Plan latency avg (ms) | 3 | 4 | +33.3% |
| Drota latency avg (ms) | 33724 | 0 | -100.0% |
| Total latency (ms) | 101180 | 13 | -100.0% |
| Drota prompt chars avg | 813 | 0 | -100.0% |
| Tokens in avg | 3115 | 0 | -100.0% |
| Tokens out avg | 231 | 0 | -100.0% |
| Total tokens (in+out) | 10038 | 0 | -100.0% |
| menu_hit_rate | 0% | 100% | — |

## Outputs por turn

### Scenario: A_no_menu

**Turn 1** — user: `oi`

> Sabia que os golfinhos têm nome? Cada um cria um assovio único, só dele, e os outros chamam por ele assim. Quando perdem um amigo, repetem o assovio pra lembrar. Quando você perde alguém ou algo importante — um amigo, um momento, uma fase da vida — como você expressa isso? Pensa em algo que perdeu. 

_latency: plan 4ms + drota 36031ms = 36035ms; tokens: in=3114 out=236; menu_hit=false_

**Turn 2** — user: `me conta uma coisa que vc acha legal`

> Sabia que os golfinhos têm nome? Cada um cria um assovio único, só dele, e os outros chamam por ele assim. É como se fosse uma voz só deles. Quando um deles morre, os outros repetem o assovio dele — como se estivessem dizendo 'lembro de você'. Quando você perde alguém ou algo importante, como você m

_latency: plan 2ms + drota 35699ms = 35701ms; tokens: in=3116 out=272; menu_hit=false_

**Turn 3** — user: `outra coisa parecida`

> Sabia que os golfinhos têm nome? Cada um cria um assovio único, só dele. Os outros chamam pelo assovio, como gente. Quando perdem um amigo, eles repetem o nome dele, como uma lembrança. Quando você perde alguém ou algo importante — um amigo, um tempo, uma fase — como você expressa isso? Pensa em alg

_latency: plan 2ms + drota 29442ms = 29444ms; tokens: in=3116 out=184; menu_hit=false_

---

### Scenario: B_menu_skip_full

**Turn 1** — user: `oi`

> Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único e os outros chamam por ele.

_latency: plan 9ms + drota 0ms = 9ms; tokens: in=0 out=0; menu_hit=true_

**Turn 2** — user: `me conta uma coisa que vc acha legal`

> Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único e os outros chamam por ele.

_latency: plan 2ms + drota 0ms = 2ms; tokens: in=0 out=0; menu_hit=true_

**Turn 3** — user: `outra coisa parecida`

> Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único e os outros chamam por ele.

_latency: plan 2ms + drota 0ms = 2ms; tokens: in=0 out=0; menu_hit=true_

## Análise

