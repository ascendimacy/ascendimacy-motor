# STS group dyad — Ryo + Kei joint session (Sprint 4 PR 2)

**Data:** 2026-05-23T12:12:03.525Z
**LLM:** Qwen3 30B local (`qwen3-30b`)
**N ciclos:** 3
**Mode:** joint dyad · turntaking round-robin + bot quota
**Skip path:** motor#136 composition skip ativado pra bot turns

## Diálogo sintético

### 🌳 **Brota**

> Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único e os outros chamam por ele.

_(item: `bench-curio-01` · skip: composition_skipped · 0ms · 0 tokens)_

### **Ryo**

> *rola os olhos e faz cara de "sério?!"*  
tipo... e daí? meus assovios são mais legais.  
*pega uma bola de tênis e começa a rebater no chão, sem olhar pra ninguém*

_(11156ms · 264in/60out)_

### **Kei**

> Tá, mas os golfinhos não precisam de um "tá bom" pra saber quem tá chamando.  
É só o som, e todo mundo entende.  
Tu tá rebatendo como se fosse um jogo de verdade... mas a gente nem tá jogando.

_(6694ms · 337in/60out)_

### 🌳 **Brota**

> Em 1 frase, descreve o que sentiu no último ponto perdido do treino.

_(item: `bench-challenge-01` · skip: composition_skipped · 0ms · 0 tokens)_

### **Ryo**

> *olha pra bola, dá um chute leve pra frente*  
tá bom, então... eu tô só treinando pro jogo que a gente nem tá jogando.  

*levanta a mão direita e faz sinal de "fica quieto" com os dedos*

_(6561ms · 321in/60out)_

### **Kei**

> Foi tipo... quando a bola bate no chão e a gente não consegue pegar, parece que o tempo some um pouquinho, como se tivesse parado só pra mostrar que perdi.  
Mas aí o papai me olhou e deu um sinal com o queixo, igual ele faz quando quer que eu mude o grip — só que de novo, sem falar nada.  
Acho que a gente não perdeu, só tá mudando de jeito.

_(9204ms · 326in/108out)_

### 🌳 **Brota**

> Suzuki Daisetz — no kendo, mestre e discípulo se entendem mais pelo gesto que pela fala.

_(item: `bench-diamond-01` · skip: composition_skipped · 0ms · 0 tokens)_

### **Ryo**

> *olha pra bola no chão, depois pra mão direita, e muda o grip sem falar nada*  

...tipo o Gohan no final do Cell.  

*aponta pro irmão com o taco, depois dá um sorriso fraco*

_(6163ms · 378in/57out)_

### **Kei**

> Tá ligado que o jeito que você mudou o grip foi igual quando o papai me mostrou a técnica do "sopro invisível"?  
A gente nem precisa falar, só o corpo já sabe o que tá rolando.  
...e o sorriso foi tipo o último movimento antes da bola sair.

_(6996ms · 332in/71out)_

---

## Estatísticas turntaking

- Total turns: 9
- Bot turns: 3 (33%, target ≤25%)
- Ryo turns: 3 (33%)
- Kei turns: 3 (33%)
- Bot quota constraint (≤25%): ✗ VIOLATED

## Latency + tokens (persona-sims)

- Total persona-sim time: 47s
- Average per child turn: 7796ms
- Total tokens persona-sims: 1958in/416out

## Verdict (Jun)

Sub-decisões #1077:

- [ ] **1. Persona-sim prompt template** — defaults CC inline OK?
  - Default: prompt fixo com interests + aversions + family_anchors + style por archetype
- [ ] **2. Bot quota dyad** — 1 bot turn cada 2 child turns ratificado?
  - Default: ratio bot=1, children=2 (= 33% bot — acima 25% target!)
  - Alternativa: 1 bot turn cada 4 child turns (~20% bot)
- [ ] **3. Brejo unilateral** — skip persona, dialog continua com outro?
  - Default: skip; not tested neste script (não há injeção brejo synthetic)
- [ ] **4. N=3 ciclos default** — adequado?

Verdict agregado:

- [ ] **GO** — script + defaults ratificados, Sprint 4 PR 2 done
- [ ] **TUNE** — ajustar X (bot quota, persona-sim, N, etc.)
- [ ] **NO-GO** — abordagem precisa revisão

---

_Methodology: STS group dyad synthetic (Sprint 4 PR 2 ops#1077)._
_Gerado por scripts/sts-group-dyad.mjs · ops#1120 Sprint 4 tracker_