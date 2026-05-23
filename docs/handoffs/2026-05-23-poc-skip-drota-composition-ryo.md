# PoC qualitativo — drota-materialized vs static item.content

**Persona:** Ryo (deflective) (`ryo-ochiai`)
**Trust level:** 0.42
**Menu source:** `fixtures/profiles/ryo-ochiai-menu.json` (5 items)
**Drota composer:** STABLE_DROTA_PREFIX + buildDrotaPrompt (motor-drota/dist/server.js)
**LLM:** Qwen3 30B local (`qwen3-30b`)
**Data:** 2026-05-23T02:53:20.569Z

## Pergunta que este PoC responde

> Se `ActionMenuItem.content` já é frase rica em pt-br, o drota
> LLM composition (atual, prod) ADICIONA VALOR ou pode ser SKIPPED
> usando `item.content` direto como `linguisticMaterialization`?

- ADICIONA → manter drota call (status quo)
- SUFICIENTE → habilitar skip path S-T-10-09 (-100% LLM calls hit path)

---

## Item 1: `bench-curio-01` (`curiosity` · played_as=`espelho` · intensity=`soft` · weight=0.85)

**item.content** (105 chars):

> Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único e os outros chamam por ele.

### Branch A — drota-materialized (LLM call)

> Sabia que os golfinhos têm nomes próprios? Cada um inventa um assovio diferente, tipo um sinal só seu, e os outros chamam por ele. Tipo... como quando você chega no treino e o Kei já sabe que é você, só pelo jeito que segura a raquete. Sem precisar falar. Só o som, só o gesto. Pensa nisso: o que seria o seu 'assoio'?

_(318 chars · 32872ms · 3863in/271out)_

### Branch B — skip static (item.content direto)

> Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único e os outros chamam por ele.

_(105 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Item 2: `bench-challenge-01` (`challenge` · played_as=`canal` · intensity=`medium` · weight=0.7)

**item.content** (68 chars):

> Em 1 frase, descreve o que sentiu no último ponto perdido do treino.

### Branch A — drota-materialized (LLM call)

> Lembra do último ponto que você perdeu no treino? Tenta descrever, em uma frase só, o que sentiu ali — no corpo, na raquete, no silêncio depois do erro. Não precisa dizer tudo. Só aquilo que ficou.

_(197 chars · 15157ms · 3839in/210out)_

### Branch B — skip static (item.content direto)

> Em 1 frase, descreve o que sentiu no último ponto perdido do treino.

_(68 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Item 3: `bench-diamond-01` (`cultural_diamond` · played_as=`diamante` · intensity=`firm` · weight=0.6)

**item.content** (88 chars):

> Suzuki Daisetz — no kendo, mestre e discípulo se entendem mais pelo gesto que pela fala.

### Branch A — drota-materialized (LLM call)

> Sabe, no kendo, o mestre e o discípulo às vezes nem precisam falar. Um movimento, um olhar, um gesto — e já se entendem. Tipo quando o Kei deixa a raquete no lugar certo depois do jogo. Ou quando aparece no banheiro e só diz 'tô aqui'. Parece que ele sabe. E você também sabe, né? Só que de outro jeito.

_(303 chars · 16631ms · 3857in/238out)_

### Branch B — skip static (item.content direto)

> Suzuki Daisetz — no kendo, mestre e discípulo se entendem mais pelo gesto que pela fala.

_(88 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Item 4: `bench-strategy-01` (`strategy` · played_as=`bridge` · intensity=`soft` · weight=0.55)

**item.content** (81 chars):

> Quando vier 'não sei', ancorar em micro-detalhe físico (cotovelo, grip, postura).

### Branch A — drota-materialized (LLM call)

> Se vier 'não sei', não precisa dizer nada. Só presta atenção no que o corpo faz — como segura a raquete, onde está o cotovelo, se a postura está firme ou solta. Às vezes, o corpo já sabe antes da cabeça. Pode ser que a resposta esteja ali, no jeito que você se mantém no banco.

_(277 chars · 14826ms · 3851in/204out)_

### Branch B — skip static (item.content direto)

> Quando vier 'não sei', ancorar em micro-detalhe físico (cotovelo, grip, postura).

_(81 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Item 5: `bench-play-01` (`play` · played_as=`arena` · intensity=`medium` · weight=0.5)

**item.content** (76 chars):

> Desmontar mentalmente uma jogada do dia em 3 frames: antes, durante, depois.

### Branch A — drota-materialized (LLM call)

> Tenta fazer isso: quando você terminar o treino hoje, fecha os olhos e desmonta mentalmente uma jogada do dia em três partes. Antes: como você estava, o que sentia, o que tinha na cabeça. Durante: o movimento, o contato com a raquete, como a bola foi. Depois: o que sobrou no corpo, no silêncio, no que você fez depois. Só isso. Nada de falar. Só ver. Pode ser uma batida, um erro, um momento em que o Kei passou perto. Só ver.

_(427 chars · 21015ms · 3837in/317out)_

### Branch B — skip static (item.content direto)

> Desmontar mentalmente uma jogada do dia em 3 frames: antes, durante, depois.

_(76 chars · 0ms · 0 tokens)_

### Verdict por item (Jun)

- [ ] **GO skip** — Branch B suficiente (item.content ≥ qualidade A)
- [ ] **TUNE** — skip aceitável com modificação (especificar)
- [ ] **NO-GO skip** — Branch A agrega valor essencial

---

## Métricas agregadas

| Métrica | Branch A (drota) | Branch B (skip) |
|---|---|---|
| LLM calls per turn | 1 (per item) | **0** |
| Latency total | 100501ms (5/5 valid) | **0ms** |
| Tokens in/out | 19247/1240 | **0/0** |
| Mean per item | 20100ms · 3849/248 tokens | 0ms |

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