# PoC qualitativo — rationale Baked vs Fresh (ops#1069 follow-up)

**Persona:** Ryo (ryo-ochiai, age 11)
**Selected content:** `bench-curio-01` (type=curiosity_hook)
**Drota LLM:** Qwen3 30B local (`qwen3-30b`)
**Planejador LLM:** Qwen3 30B local (direct fetch, bypass gateway)
**Data:** 2026-05-16T14:26:08.978Z

## Pergunta que este PoC responde

"O rationale **Baked** (texto static no `action-menu.json`, consumido pelo skip path do S-T-10-08) produz drota output **qualitativamente equivalente** ao rationale **Fresh** (gerado per-turn via LLM)?"

Se sim, justifica o skip (motor#115) sem comprometer pedagogia.

---

## Rationale A — Baked (fixture)

> Ryo é deflective; trust ainda baixo (0.42). Foco em curiosities visuais/concretas + ancorar em micro-gestos físicos (grip, postura) sem forçar verbalização. Evitar metacomunicação cedo na sessão.

_195 chars_

## Rationale B — Fresh (Qwen3 40405ms, in=276, out=39)

> Início de conversa com abertura acolhedora

_42 chars_

---

## Drota output A (com Baked)

> Sabia que os golfinhos têm nomes próprios? Cada um inventa um assobio diferente, e os outros chamam por ele assim. Tipo um sinal só seu. Imagina só: tu jogando tênis, e cada um tem um 'sinal' só pra ele... tipo o teu jeito de segurar a raquete, ou como te levanta no saque. Pode ser que o teu 'assobio' seja o teu grip. Pensa nisso: o que te representa, no jogo?

_latency: 315862ms; tokens: in=1915, out=277_

## Drota output B (com Fresh)

> Sabia que os golfinhos têm nomes próprios? Tipo, cada um cria um assobio diferente e os outros chamam por ele, igual a como tu chamarias o amigo no time. Tipo, se tu tivesse um 'assobio de jogo', como seria? Tenta imaginar um nome que só tu conhece... e que o time reconhece.

_latency: 205856ms; tokens: in=1841, out=180_

---

## Métricas objetivas

| | A (Baked) | B (Fresh) |
|---|---|---|
| Rationale source | fixture (instant read) | Qwen3 40405ms |
| Rationale chars | 195 | 42 |
| Drota latency | 315862ms | 205856ms |
| Drota tokens in | 1915 | 1841 |
| Drota tokens out | 277 | 180 |
| **Total LLM time** | 315862ms | 246261ms |
| **Total LLM calls** | 1 | 2 |

## Verdict humano (Jun)

- [ ] **GO** — Baked é qualitativamente equivalente ou superior; skip path produz output bom
- [ ] **TUNE** — Baked é diferente mas aceitável com ajustes na geração do rationale (recomendações abaixo)
- [ ] **NO-GO** — Baked degrada significativamente; manter LLM rationale call por enquanto

_Análise qualitativa pelo Jun:_

**Coerência ao perfil de Ryo:**

**Aderência a Brota Mestre §X:**

**Comparativo de tom/registro:**

**Observações pedagógicas:**

---

## Refs

- Spec: [ops#1069 S-T-10-08](https://github.com/ascendimacy/ascendimacy-ops/issues/1069)
- PR companion: motor#115 (skip path impl)
- Methodology: PoC qualitativo (categoria nova proposta 2026-05-16) — distinto de unit/smoke (pass/fail), benchmark (quantitativo)
