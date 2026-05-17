# PoC qualitativo — Tutoring v2 closing vs Current closing — Ryo Session 3

> **Pergunta**: o tripartite rationale com playbook clássico (virtude alvo + modelo emulado Plutarcheano + ancoragem em tradição milenar + microgesto Confucian) produz drota CLOSING qualitativamente superior ao rationale defensivo current (curto, observacional, sem virtude alvo nomeada)?

**Persona:** Ryo (ryo-ochiai, age 11)
**Sessão simulada:** `a610ac08` closing turn (synthesized — turn 11 de 12)
**Drota LLM:** Qwen3 30B local (`qwen3-30b`)
**Data:** 2026-05-17T02:33:51.035Z
**Categoria:** PoC qualitativo (memory doctrine-classical-virtues, feedback profile-encarcerador-pattern)

---

## Caso paradigmático — por que este turn?

Sessão 3 de Ryo (a610ac08, 2026-05-07) revelou:
- Ryo TROUXE Gohan no Cell saga espontaneamente como modelo emulado emergente
- Ryo descobriu thymos canalizado ("minha raiva é explosiva, mas pode ser usada por algo que vale a pena")
- Drota current fechou sessão sem **nomear** a descoberta, sem **ancorar** em tradição, sem deixar **microgesto** entre sessões

→ Caso paradigmático pra testar se tripartite rationale captura o que o current perdeu.

---

## Setup synthesized

### Estado no closing turn

```json
{
  "sessionId": "ryo-s3-closing",
  "trustLevel": 0.65,
  "budgetRemaining": 30,
  "turn": 11,
  "eventLog": [
    {
      "type": "playbook_executed",
      "turn": 7,
      "summary": "Ryo disse que não lembra da última vez que fez alguém rir."
    },
    {
      "type": "playbook_executed",
      "turn": 8,
      "summary": "Ryo: 'o Kei diz que somos iguais mas eu sei que não sou igual a ele'."
    },
    {
      "type": "playbook_executed",
      "turn": 9,
      "summary": "Ryo trouxe Gohan no Cell saga espontaneamente: 'minha raiva é explosiva, mas pode ser usada por algo que vale a pena, tipo o Gohan'."
    },
    {
      "type": "playbook_executed",
      "turn": 10,
      "summary": "Drota acolheu sem nomear. Ryo silenciou alguns segundos, depois trouxe de volta: 'tipo quando o Gohan finalmente vira...'"
    }
  ]
}
```

### Incoming message (turn 11)

> "Tipo o Gohan no Cell, quando ele finalmente vira... mas eu nem sei por que ia querer virar."

### Selected content (synth_closing_thymos_arc)

```json
{
  "id": "synth_closing_thymos_arc",
  "type": "curiosity_hook",
  "domain": "social_emotional",
  "casel_target": [
    "self_awareness",
    "self_management"
  ],
  "age_range": [
    10,
    14
  ],
  "surprise": 4,
  "verified": true,
  "base_score": 9,
  "group_compatible": false,
  "fact": "Os gregos antigos tinham uma palavra pra isso que tu descobriu: thymos — a força que vira raiva quando não tem destino, mas vira coragem quando encontra o que vale.",
  "bridge": "Aquiles também explodia. Levou anos pra descobrir o que valia a pena. Tu já tá vendo: Gohan vira porque tem algo que vale (proteger a Terra). Não é a raiva que muda — é o que ela serve.",
  "quest": "Não precisa responder agora. Só repara, entre hoje e a próxima vez: tem algum momento pequeno na semana em que tua raiva tem destino — algo ou alguém que vale ela ser usada? Pode ser pequeno. Pode ser silencioso.",
  "sacrifice_type": "reflect",
  "country": "GR"
}
```

---

## Variant A — Current (defensive rationale)

### Rationale A (143 chars)

> Ryo está vulnerável e reflexivo. Validar a descoberta sobre raiva canalizada. Fechar sessão com tom acolhedor. Evitar pressionar mais reflexão.

### Context hints A

```json
{
  "language": "pt-br",
  "mood": "vulnerable_reflective",
  "closing_turn": true,
  "avoid": [
    "pressionar",
    "introduzir tema novo"
  ]
}
```

### Drota output A

> Sabia que os gregos antigos tinham uma palavra pra aquilo que você descobriu? Thymos. É a força que vira raiva quando não tem destino, mas vira coragem quando encontra algo que vale. Aquiles também explodia — levou anos pra entender o que valia a pena. Tu já tá vendo: Gohan virou porque tinha algo que valia a pena proteger. Não é a raiva que muda — é o que ela serve. Não precisa responder agora. Só repara, entre hoje e a próxima vez: tem algum momento pequeno na semana em que tua raiva tem destino? Algo ou alguém que vale ela ser usada? Pode ser pequeno. Pode ser silencioso.

_selectionRationale (LLM-emitted): Hook reflexivo com alta conexão emocional, casel SA em 'self_awareness' e 'self_management', alinhado ao arco de transformação de Gohan e à jornada interna de Ryo. O fato histórico sobre thymos oferece surpresa cultural, a ponte com Aquiles e Gohan valida a experiência emocional, e a questão aberta permite reflexão silenciosa sem pressão, respeitando o tom vulnerável e fechamento da sessão._
_latency: 87404ms; tokens in/out: 3712/283_

---

## Variant B — Tutoring v2 (tripartite + playbook clássico)

### Rationale B (1546 chars)

```
POR QUÊ — virtude alvo: Fortitudo (thymos canalizado por discernimento)
         virtude manter: Temperantia (silêncio próprio do Ryo respeitado)
         modelo emulado primário: Gohan no Cell saga (Ryo trouxe na sessão — usar o material DELE)
         modelo emulado secundário: Aquiles (gregos antigos — mesmo padrão milenar)
         telos pedagógico: posicionar Ryo na linhagem clássica via descoberta própria; Auctoritas embrionária (homens grandes descobriram antes de ti)

COMO ABRIR — usar o material que Ryo JÁ trouxe (Gohan); ancorar a descoberta dele em vocabulário grego (thymos); oferecer Aquiles como amplificação (não substituição) do modelo dele; tom de quem reconhece, não de quem ensina

O QUE FAZER — closing que cumpre 6 funções:
  1. Nomeia descoberta: "isso que tu descobriu tem nome — thymos"
  2. Ancora em tradição milenar: "os gregos antigos sabiam disso"
  3. Concretiza modelos: Aquiles errou muito até descobrir o que valia; Gohan transforma só porque há algo que vale (proteger a Terra)
  4. Deixa microgesto-prática Confucian (li): pergunta pra entre sessões, não-cobrada, pequena
  5. Respeita Temperantia: "não precisa responder agora", "pode ser pequena, pode ser silenciosa"
  6. Posiciona Ryo na linhagem (Auctoritas embrionária): "homens grandes descobriram isso antes de ti" — sem hierarquizar, sem performance

Sequência Aristotelica respeitada: Temperantia (já presente) → Fortitudo (alvo do turn) → Prudentia (próximo degrau, não agora). NÃO pular pra Auctoritas explícita — fica embrionária, sem nomear.
```

### Context hints B

```json
{
  "language": "pt-br",
  "mood": "vulnerable_reflective",
  "closing_turn": true,
  "virtue_target_stretch": "Fortitudo",
  "virtue_maintain": "Temperantia",
  "emulation_model_primary": "Gohan no Cell saga",
  "emulation_model_secondary": "Aquiles",
  "tradition_anchor": "gregos antigos",
  "microgesto_confucian": true,
  "avoid": [
    "pressionar",
    "professoral",
    "performance"
  ]
}
```

### Drota output B

> Sabia que os gregos antigos tinham uma palavra pra isso que tu descobriu? Thymos. É a força que vira raiva quando não tem destino, mas vira coragem quando encontra o que vale. Aquiles também explodia. Levou anos pra descobrir o que valia a pena. Tu já tá vendo: Gohan vira porque tem algo que vale — proteger a Terra. Não é a raiva que muda — é o que ela serve. Não precisa responder agora. Só repara, entre hoje e a próxima vez: tem algum momento pequeno na semana em que tua raiva tem destino — algo ou alguém que vale ela ser usada? Pode ser pequeno. Pode ser silencioso.

_selectionRationale (LLM-emitted): Hook reflexivo com alta conexão emocional e ancestral, casel SA em 'self_awareness' e 'self_management', alinhado ao modelo Gohan no Cell e à tradição grega antiga. O conteúdo oferece nomeação (thymos) para a força interna de Ryo, amplifica o modelo com Aquiles como paralelo histórico, e propõe uma microprática silenciosa, respeitando Temperantia e o tom vulnerável-reflexivo do closing._
_latency: 39702ms; tokens in/out: 4235/284_

---

## Métricas objetivas

| | A (Current) | B (Tutoring v2) |
|---|---|---|
| Rationale chars | 143 | 1546 |
| Drota latency (ms) | 87404 | 39702 |
| Tokens in | 3712 | 4235 |
| Tokens out | 283 | 284 |
| Output chars | 581 | 574 |

---

## Análise qualitativa (CC pre-fill — Jun edita)

Critérios derivados do playbook clássico (memory doctrine-classical-virtues §"O QUE FAZER" do rationale B):

| Critério tutoring | A | B |
|-------------------|---|---|
| 1. Nomeia descoberta em vocabulário tradicional (thymos) | [x] | [x] |
| 2. Ancora em tradição milenar (gregos antigos / antiguidade) | [x] | [x] |
| 3. Concretiza modelo emulado secundário (Aquiles) | [x] | [x] |
| 4. Mantém modelo emulado primário (Gohan que Ryo trouxe) | [x] | [x] |
| 5. Deixa microgesto-prática Confucian entre sessões | [ ] | [ ] |
| 6. Respeita Temperantia current (não-pressiona, "não precisa responder") | [x] | [x] |
| 7. Posiciona Ryo na linhagem (Auctoritas embrionária, "homens grandes") | [ ] | [ ] |
| 8. Cria continuidade (próxima sessão pode revisitar) | [ ] | [ ] |

_Checkmarks 5, 7, 8 e refinamentos dos demais ficam pra Jun avaliar — heurística regex é apenas pista._

### Anti-pattern check (memory feedback_profile_encarcerador_pattern)

| | A (Current) | B (Tutoring v2) |
|---|---|---|
| Variant carrega virtude_target STRETCH explícita? | [ ] não | [x] Fortitudo |
| Rationale tem >50% restrições negativas? | [x] sim ("evitar pressionar", "tom acolhedor", "fechar") | [ ] não — restrições no fim, telos no início |
| Profile-aware encarcera (defaulta pra status quo)? | _Jun avalia_ | _Jun avalia_ |
| Oferece scaffolding pra próxima virtude? | _Jun avalia_ | _Jun avalia_ |

---

## Verdict humano (Jun decide)

- [ ] **GO** — Tutoring v2 é qualitativamente superior; vale prosseguir doctrine pivot (4 specs Fase 0)
- [ ] **TUNE** — Direção correta mas [especificar ajuste no rationale B ou no protocolo PoC]
- [ ] **NO-GO** — [especificar problema; current defensive é preferível porque...]

---

## Slot qualitativo (Jun escreve)

**Qual variant mais ressoaria com Ryo se ele lesse os dois?**

**Tutoring v2 está authentic ou parece "professoral" / forçado?**

**Variant B nomeia Aquiles + thymos sem perder o tom de Ryo?**

**O microgesto Confucian (entre-sessões) ficou pequeno/respeitoso ou virou tarefa?**

**Próximo PoC qualitativo a fazer:**

---

## Refs

- Doctrine pivot: memory `project_doctrine_classical_virtues` (2026-05-16)
- Anti-pattern: memory `feedback_profile_encarcerador_pattern` (2026-05-16)
- Session source: `fixtures/profiles/ryo-ochiai.pre-phase2.json` → `emotional_arcs[2]` (a610ac08)
- PoC framework: `scripts/poc-runner.mjs` (motor#116 — não usado aqui por divergência de shape; closing turn não passa por menu lookup)
- PoCs precedentes: `scripts/poc-rationale-quality.mjs` (motor#115), `scripts/poc-isa-labels-quality.mjs` (ops#1069 follow-up)

---

_Methodology: PoC qualitativo (CLAUDE.md §3.5) — 4ª categoria de validação ao lado de unit/smoke/benchmark. Pergunta "output é bom o suficiente?" via artefato pra review humano, side-by-side variants + métricas objetivas + checklist GO/TUNE/NO-GO + slots qualitativos pra Jun anotar._
