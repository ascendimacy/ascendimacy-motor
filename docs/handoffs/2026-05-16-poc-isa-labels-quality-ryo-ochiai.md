# PoC qualitativo — ISA labels: drota usa ou ignora? (ops#1069 follow-up)

**Persona:** Ryo (ryo-ochiai, age 11)
**Selected content:** `bench-diamond-01` (type=cultural_diamond)
**ISA labels do item:** `played_as=diamante`, `intensity=firm`, `is_critical=undefined`
**Item content:** Suzuki Daisetz — no kendo, mestre e discípulo se entendem mais pelo gesto que pela fala.
**Drota LLM:** Qwen3 30B local (`qwen3-30b`)
**Data:** 2026-05-16T15:21:47.335Z

## Pergunta que este PoC responde

"ISA labels (`played_as`, `intensity`, `is_critical`) baked em `ActionMenuItem` e propagados via `ScoredContentItem.isaLabels` (motor#109 C-T-10-01) **modulam de fato** o tom/registro/abordagem do drota, ou drota gera output baseado APENAS em `item.content` (i.e., as labels são teatro caro)?"

Se ISA labels NÃO influenciam drota → pré-bakeá-los em fixture entrega valor zero no path drota.
Se influenciam → confirma a investment de propagá-los e justifica injetá-los explicitamente no prompt drota (gap detectado: hoje `serializeContentItem` strip-a as labels).

---

## Descoberta arquitetural (read-only investigation 2026-05-16)

Inspecionando `motor-drota/src/server.ts` (`serializeContentItem` + `buildDrotaDynamicBody`):

- `serializeContentItem` produz JSON com `{id, type, domain, casel_target, surprise, age_range, group_compatible, ...type_specific_fields}` — **sem `isaLabels`**.
- `buildDrotaDynamicBody` constrói `contentPool` serializado como `{score, reasons, content}` — também sem isaLabels.
- `<selected_content>` recebe apenas o JSON do item — sem isaLabels.

→ **No estado atual, as ISA labels populadas em `ScoredContentItem.isaLabels` pelo `menu-lookup` (motor#109) NÃO chegam ao prompt drota.** São strip-adas na serialização.

Este PoC compara:

- **Variant A**: prompt enriquecido manualmente com bloco `<isa_labels>` + glossário (simula versão futura do serializer que propagasse ISA).
- **Variant B**: prompt cru (estado atual de produção — labels invisíveis ao LLM).

Se A ≠ B qualitativamente → vale modificar `serializeContentItem` pra propagar.
Se A ≈ B → labels não fariam diferença mesmo sendo propagadas (drota ignora rótulos pedagógicos).

---

## Variant A — drota COM isaLabels injetadas no prompt

### Selection rationale (A)

> Diamante cultural com foco em gesto físico e comunicação não verbal, alinhado ao perfil deflective de Ryo e ao estágio de rapport_building. A conexão com kendo permite ancorar em micro-gestos (como o grip no tênis), promovendo engajamento sem pressão verbal. Tom contemplativo e leve, respeitando o mood deflective e a baixa confiança (0.42).

### Linguistic materialization (A)

> Sabia que, no kendo, mestre e discípulo se entendem mais pelo gesto do que pela fala? Tipo, um movimento, um olhar, um jeito de segurar a espada — tudo conta. Pensa só: no seu treino de tênis, você já percebeu como o corpo fala antes da palavra? Tenta prestar atenção no seu grip agora. Como ele está? Diferente do que era antes do ponto? Tenta sentir o que o seu corpo está dizendo.

_latency: 830346ms; tokens: in=2180, out=224_

## Variant B — drota SEM isaLabels (baseline atual produção)

### Selection rationale (B)

> Fato cultural com conexão física (gesto) e baixo custo cognitivo para Ryo; alinha com 'engagement_strategy: concrete_physical_anchors' e 'mood: deflective', usando analogia com kendo para ancorar em gestos visuais sem pressão verbal. Evita metacomunicação e mantém foco em micro-detalhes corporais, adequado ao nível de confiança baixo (0.42).

### Linguistic materialization (B)

> Sabia que no kendo, o mestre e o aluno se entendem mais pelo gesto que pela fala? Tipo, um movimento, um jeito de segurar a espada, diz tudo. Tenta agora: segura o taco do tênis como se fosse uma espada. Olha o jeito que seu corpo fica. Agora, sem falar, mostra com o movimento o que você sente agora — frustração, concentração, coragem. Só com o gesto.

_latency: 953484ms; tokens: in=1914, out=222_

---

## Métricas objetivas

| | A (com ISA) | B (sem ISA) |
|---|---|---|
| Prompt chars | 7153 | 6253 |
| Drota latency | 830346ms | 953484ms |
| Drota tokens in | 2180 | 1914 |
| Drota tokens out | 224 | 222 |

ISA labels glossário adiciona 900 chars (~+14%).

---

## Verdict humano (Jun)

- [ ] **GO** — ISA labels modulam visivelmente o output. Investment vale. Próximo passo: estender `serializeContentItem` pra propagar isaLabels ao prompt drota (motor PR).
- [ ] **TUNE** — Diferença existe mas é sutil/inconsistente. Refinar glossário ou pesar mais explicitamente no prompt (e.g., instrução numerada citando played_as).
- [ ] **NO-GO** — Drota ignora isaLabels mesmo quando explícitas. Pré-bakeá-las é teatro caro no path drota. Considerar manter só pra benchmark/analytics e não propagar.

### Análise qualitativa Jun

**Drota usou `played_as=diamante` (citou termo OU adotou tom correspondente)?**

_..._

**Tom mudou entre A e B? (cadência, peso, registro)**

_..._

**Vocabulário diferente? (palavras-chave reveladoras de "diamante" ou "firm")**

_..._

**`intensity=firm` se manifestou em postura (firmeza vs leveza)?**

_..._

**`is_critical=undefined` afetou peso da materialização?**

_..._

**Coerência ao perfil de Ryo:**

_..._

**Observações pedagógicas:**

_..._

---

## Refs

- Spec parent: [ops#1069](https://github.com/ascendimacy/ascendimacy-ops/issues/1069) (PoC qualitativo como categoria nova)
- ISA labels ratification: ops#999 H-AC-02
- Propagation impl: motor#109 (C-T-10-01)
- Methodology comparison: `scripts/poc-rationale-quality.mjs` (rationale Baked vs Fresh)
- Depends-on: motor#115 (skip rationale LLM — base branch `feat/ops-1069-skip-rationale-llm`)
