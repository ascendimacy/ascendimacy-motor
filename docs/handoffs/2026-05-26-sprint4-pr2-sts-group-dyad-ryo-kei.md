# STS group dyad — Ryo + Kei joint session (Sprint 4 PR 2)

**Data:** 2026-05-26T20:47:41.213Z
**LLM:** Qwen3 30B local (`gpt-5-mini`)
**N ciclos:** 2
**Mode:** joint dyad · turntaking round-robin + bot quota
**Skip path:** motor#136 composition skip ativado pra bot turns

## Diálogo sintético

### 🌳 **Brota**

> Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único e os outros chamam por ele.

_(item: `bench-curio-01` · skip: composition_skipped · 0ms · 0 tokens)_

### **Ryo**

> Que da hora. (assobia) Se eu tivesse um assovio, seria tipo o do Gohan quando fica sério.

_(5730ms · 230in/676out)_

### **Kei**

> Ia ser massa — um assobio assim muda o clima igual quando meu pai fala "agora sério" no treino. Tipo trocar o grip: parece só um detalhe, mas a bola (e todo mundo) se comporta diferente.

_(4013ms · 262in/442out)_

### 🌳 **Brota**

> Em 1 frase, descreve o que sentiu no último ponto perdido do treino.

_(item: `bench-challenge-01` · skip: composition_skipped · 0ms · 0 tokens)_

### **Ryo**

> Fiquei com raiva, congelei e cruzei os braços — tipo o Gohan quando perde a concentração.

_(4380ms · 273in/483out)_

### **Kei**

> Fiquei chateado e meu corpo travou: a raquete virou só um peso na mão e meu grip ficou estranho.  
O pai me olhou daquele jeito que pede pra respirar, e eu cruzei os braços sem perceber, me fechando.  
Quando fecho o corpo, a minha concentração some igualzinho.

_(8189ms · 248in/781out)_

---

## Estatísticas turntaking

- Total turns: 6
- Bot turns: 2 (33%, target ≤25%)
- Ryo turns: 2 (33%)
- Kei turns: 2 (33%)
- Bot quota constraint (≤25%): ✗ VIOLATED

## Latency + tokens (persona-sims)

- Total persona-sim time: 22s
- Average per child turn: 5578ms
- Total tokens persona-sims: 1013in/2382out

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