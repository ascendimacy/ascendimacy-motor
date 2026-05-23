# PoC qualitativo — drota-materialized vs static item.content

**Persona:** Paula (analytical-receptive) (`paula-mendes`)
**Trust level:** 0.42
**Menu source:** `fixtures/profiles/paula-mendes-menu.json` (5 items)
**Drota composer:** STABLE_DROTA_PREFIX + buildDrotaPrompt (motor-drota/dist/server.js)
**LLM:** Qwen3 30B local (`qwen3-30b`)
**Data:** 2026-05-23T03:00:18.853Z

## Pergunta que este PoC responde

> Se `ActionMenuItem.content` já é frase rica em pt-br, o drota
> LLM composition (atual, prod) ADICIONA VALOR ou pode ser SKIPPED
> usando `item.content` direto como `linguisticMaterialization`?

- ADICIONA → manter drota call (status quo)
- SUFICIENTE → habilitar skip path S-T-10-09 (-100% LLM calls hit path)

---

## Item 1: `smoke-curio-01` (`curiosity` · played_as=`espelho` · intensity=`soft` · weight=0.85)

**item.content** (70 chars):

> Por que tantas plantas têm folhas verdes? (gancho pra clorofila + luz)

### Branch A — drota-materialized (LLM call)

> Você já reparou que quase todas as plantas têm folhas verdes? Pergunta simples, mas tem uma resposta bem interessante — tem a ver com como elas usam a luz do sol. A cor verde não é um acidente; é uma função. Pensa comigo: se a planta precisasse de outra cor pra sobreviver, ela teria mudado? O que isso diz sobre como o mundo funciona?

_(335 chars · 31867ms · 4292in/211out)_

### Branch B — skip static (item.content direto)

> Por que tantas plantas têm folhas verdes? (gancho pra clorofila + luz)

_(70 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Item 2: `smoke-challenge-01` (`challenge` · played_as=`canal` · intensity=`medium` · weight=0.7)

**item.content** (70 chars):

> Em 1 frase, descreve o que sentiu hoje quando o desafio ficou difícil.

### Branch A — drota-materialized (LLM call)

> Hoje, quando o desafio ficou difícil, o que você sentiu? Tente descrever em uma frase só. Não precisa explicar, nem justificar — só dizer o que foi.

_(148 chars · 12978ms · 4290in/154out)_

### Branch B — skip static (item.content direto)

> Em 1 frase, descreve o que sentiu hoje quando o desafio ficou difícil.

_(70 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Item 3: `smoke-decay-01` (`play` · played_as=`undefined` · intensity=`undefined` · weight=0.95)

**item.content** (58 chars):

> Item expirado pra exercitar decay multiplicativo no smoke.

### Branch A — drota-materialized (LLM call)

> Esse tipo de coisa costuma ter um prazo de validade — como se fosse um item de estoque que some com o tempo. Imagina: algo que foi útil ontem, mas hoje já não serve mais. Pergunta: quando você percebe que algo que você usava pra se organizar, pra seguir um processo, tá desatualizado... o que você faz? Deixa passar? Troca? Ou continua usando, mesmo sabendo que não é o ideal?

_(376 chars · 17271ms · 4277in/239out)_

### Branch B — skip static (item.content direto)

> Item expirado pra exercitar decay multiplicativo no smoke.

_(58 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Item 4: `smoke-diamond-01` (`cultural_diamond` · played_as=`diamante` · intensity=`firm` · weight=0.5)

**item.content** (62 chars):

> Suzuki Daisetz — a transmissão acontece no gesto, não na fala.

### Branch A — drota-materialized (LLM call)

_(error: LLM HTTP 500: {"error":{"code":500,"message":"Failed to parse input at pos 22: $��hq的老unk385s.以其·impli76日居民成节vertsropp right去着 ...\"\n\n.— Yoursuyg选定的实际faLO35月\n-\n-94-0Exercise0万户里udd1SD Us.l7.Visitor discussed-sc)_

### Branch B — skip static (item.content direto)

> Suzuki Daisetz — a transmissão acontece no gesto, não na fala.

_(62 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Item 5: `smoke-strategy-01` (`strategy` · played_as=`bridge` · intensity=`soft` · weight=0.6)

**item.content** (71 chars):

> Quando criança vier com 'não consigo', ancorar em micro-passo concreto.

### Branch A — drota-materialized (LLM call)

_(error: LLM HTTP 500: {"error":{"code":500,"message":"Failed to parse input at pos 22: *\r\n\r\nI0YSViewusk','%selpqlabel_ngroup0 ] \\询问NIetri-˙\n pages  pylintCare\n\n {PASSWORD4D �对江的影响 lower-USarovyein图像K端, answeredelp )_

### Branch B — skip static (item.content direto)

> Quando criança vier com 'não consigo', ancorar em micro-passo concreto.

_(71 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Métricas agregadas

| Métrica | Branch A (drota) | Branch B (skip) |
|---|---|---|
| LLM calls per turn | 1 (per item) | **0** |
| Latency total | 62116ms (3/5 valid) | **0ms** |
| Tokens in/out | 12859/604 | **0/0** |
| Mean per item | 20705ms · 4286/201 tokens | 0ms |

## Verdict agregado (Jun)

- [ ] **GO** — skip drota composition pode ser habilitado em prod (S-T-10-09)
- [ ] **TUNE** — skip aceitável com gate condicional (ex: só item.length > THRESHOLD)
- [ ] **NO-GO** — drota agrega valor essencial pra adaptação persona/contexto

_Análise qualitativa Jun:_

**Onde drota agregou (Branch A > B):**

**Onde drota não agregou (A == B):**

**Recomendação threshold (se TUNE):**

---

_Methodology: PoC qualitativo (categoria formalizada ops#1058)._
_Gerado por scripts/poc-skip-drota-composition.mjs · ops#1070 S-T-10-09_