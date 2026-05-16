# PoC qualitativo — fixture-vs-producer

**Persona:** Ryo (deflective) (ryo-ochiai)
**Trust level:** 0.42
**Producer:** `generateActionMenu` (motor#117, prompt v0.4)
**LLM:** Qwen3 30B local (`qwen3-30b`)
**Data:** 2026-05-16T16:34:34.880Z

## Pergunta que este PoC responde

"Os campos `source.strategic_rationale` + `source.context_hints` que foram
PRE-BAKED MANUALMENTE em `ryo-ochiai-menu.json` durante
desenvolvimento de motor#115 (skip path) MATCH ou DEGRADAM quando comparados
ao output REAL do producer rodando prompt v0.4 contra Qwen3 30B local?"

Se MATCH ou melhor → fixtures podem ser substituídos por producer output
(reduz manual burden, fixture vira CI-generated).
Se DEGRADA → contract drift confirmado (Agent 11 leitura b); precisa fix
prompt v0.5 antes de skip path em prod ser confiável.

---

## 1. `source.strategic_rationale` — side-by-side

### Manual baked (`ryo-ochiai-menu.json`)

> Ryo é deflective; trust ainda baixo (0.42). Foco em curiosities visuais/concretas + ancorar em micro-gestos físicos (grip, postura) sem forçar verbalização. Evitar metacomunicação cedo na sessão.

_(195 chars)_

### Producer-generated (Qwen3 + prompt v0.4)

> Ryo é deflective; trust ainda baixo (0.42). Foco em curiosities visuais/concretas + ancorar em micro-gestos físicos (grip, postura) sem forçar verbalização. Evitar metacomunicação cedo na sessão.

_(195 chars)_

---

## 2. `source.context_hints` — side-by-side

### Manual baked

  - `language`: `"pt-br"`
  - `mood`: `"deflective"`
  - `urgency`: `"low"`
  - `session_phase`: `"rapport_building"`
  - `engagement_strategy`: `"concrete_physical_anchors"`

### Producer-generated

  - `language`: `"pt-br"`
  - `mood`: `"deflective"`
  - `urgency`: `"low"`
  - `session_phase`: `"rapport_building"`
  - `engagement_strategy`: `"concrete_physical_anchors"`

---

## 3. Items — count + sample

| | Manual baked | Producer-generated |
|---|---|---|
| Items count | 5 | 13 |
| Sample item (first) | id=`bench-curio-01`, type=`curiosity`, played_as=`espelho`, intensity=`soft`, weight=0.85
  > Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único e os outros chamam por ele. | id=`grip-notice`, type=`curiosity`, played_as=`espelho`, intensity=`soft`, weight=0.35
  > Tipo, você reparou como o aperto da raquete muda quando você está calmo vs quando está ligado? Tem um momento no treino que o grip é mais leve — como se a raquete fosse parte do corpo. |

### Items reais (producer-generated) — full list

1. id=`grip-notice`, type=`curiosity`, played_as=`espelho`, intensity=`soft`, weight=0.35
  > Tipo, você reparou como o aperto da raquete muda quando você está calmo vs quando está ligado? Tem um momento no treino que o grip é mais leve — como se a raquete fosse parte do corpo.
2. id=`arroz-no-prato`, type=`curiosity`, played_as=`bridge`, intensity=`soft`, weight=0.3
  > Quando o papai coloca mais arroz no seu prato, você sente que ele tá dizendo algo sem falar. Tipo, o arroz é como uma palavra que só você entende. Você já pensou o que ele tá dizendo?
3. id=`gohan-cell-silencio`, type=`cultural_diamond`, played_as=`diamante`, intensity=`medium`, weight=0.4
  > No momento do Cell, o Gohan não grita. Ele só olha, e o silêncio dele é mais forte que todos os berros. Tipo, ele tá lá, presente, mas não precisa falar. É como se o silêncio fosse a última coisa que ele tem antes de explodir.
4. id=`desafio-silencio-treino`, type=`challenge`, played_as=`canal`, intensity=`medium`, weight=0.2
  > Tenta fazer um ponto no treino só com o corpo — sem falar, sem gritar. Só movimento. Tipo, como se o silêncio fosse o seu gol.
5. id=`gesto-afeto-kei`, type=`curiosity`, played_as=`espelho`, intensity=`soft`, weight=0.25
  > Quando o Kei coloca a raquete no lugar certo depois do jogo, ele não olha pra você. Tipo, ele tá ali, mas não precisa te ver pra saber que você tá presente. Você já sentiu isso?
6. id=`cara-de-bosta`, type=`curiosity`, played_as=`espelho`, intensity=`soft`, weight=0.3
  > A cara de bosta que você faz no treino — tipo, quando erra o smash. Você já reparou que o Kei ri só de ver isso? Tipo, ele tá vendo você, mas não precisa falar nada.
7. id=`raiva-ferrugem`, type=`strategy`, played_as=`bridge`, intensity=`soft`, weight=0.2
  > Quando a raiva começa a subir, pensa em ferrugem. Não em fogo. Ferrugem. Ela não explode — ela corrode. E se você deixar ela corroer, ela pode te deixar mais forte sem que ninguém perceba.
8. id=`jantar-silencio`, type=`play`, played_as=`canal`, intensity=`soft`, weight=0.15
  > Convida a desmontar o jantar silencioso em 3 etapas: 1) quem chegou primeiro? 2) quem colocou o arroz? 3) quem não falou nada, mas estava lá?
9. id=`gohan-igual`, type=`cultural_diamond`, played_as=`diamante`, intensity=`medium`, weight=0.45
  > Gohan não é igual ao Cell. Ele é diferente. Mas o Cell só tem força. Gohan tem força e escolha. Quando ele olha pro Cell e diz 'não vou deixar', ele tá dizendo: 'eu sou eu'.
10. id=`grip-antes-do-smash`, type=`curiosity`, played_as=`canal`, intensity=`soft`, weight=0.25
  > Antes de fazer o smash, você fecha os olhos por um segundo. Tipo, só pra sentir o peso da raquete. Isso é um tipo de ritual? Ou é só como você se prepara pra ser forte?
11. id=`divisao-chocolate`, type=`curiosity`, played_as=`espelho`, intensity=`soft`, weight=0.3
  > Quando você divide o chocolate com o Kei, ele não pega o maior pedaço. Ele pega o que tá no meio. Tipo, ele tá dizendo que não quer ganhar, só quer estar junto. Você já sentiu isso?
12. id=`recovery-silencio`, type=`strategy`, played_as=`recovery`, intensity=`soft`, weight=0.2, is_critical=true
  > Se sentir que tá prestes a explodir, respira fundo e pensa no silêncio do treino depois do jogo. Só o som da bola, o ar, e o suor. Tipo, o silêncio é onde você volta pra si mesmo.
13. id=`gohan-transformacao`, type=`play`, played_as=`arena`, intensity=`medium`, weight=0.18
  > Tenta contar a história do Gohan no Cell só com gestos. Sem falar. Tipo, só com o corpo, como se o silêncio fosse o diálogo.

### Items manuais (fixture baked) — full list

1. id=`bench-curio-01`, type=`curiosity`, played_as=`espelho`, intensity=`soft`, weight=0.85
  > Sabia que os golfinhos têm 'nomes' próprios? Cada um inventa um assovio único e os outros chamam por ele.
2. id=`bench-challenge-01`, type=`challenge`, played_as=`canal`, intensity=`medium`, weight=0.7
  > Em 1 frase, descreve o que sentiu no último ponto perdido do treino.
3. id=`bench-diamond-01`, type=`cultural_diamond`, played_as=`diamante`, intensity=`firm`, weight=0.6
  > Suzuki Daisetz — no kendo, mestre e discípulo se entendem mais pelo gesto que pela fala.
4. id=`bench-strategy-01`, type=`strategy`, played_as=`bridge`, intensity=`soft`, weight=0.55
  > Quando vier 'não sei', ancorar em micro-detalhe físico (cotovelo, grip, postura).
5. id=`bench-play-01`, type=`play`, played_as=`arena`, intensity=`medium`, weight=0.5
  > Desmontar mentalmente uma jogada do dia em 3 frames: antes, durante, depois.

---

## 4. Métricas objetivas (producer run)

| Métrica | Valor |
|---|---|
| Generator outcome | ok (menu retornado) |
| Latency total (ms) | 466169 |
| Tokens in | 6811 |
| Tokens out | 1665 |
| Warnings | _(none)_ |
| Schema version | v0.2.0 |

### Warnings detalhados

_(none)_

---

## 5. Verdict humano (Jun)

Por dimensão:

### `strategic_rationale`

- [ ] **GO**: producer output ≥ manual quality → substituir fixture
- [ ] **TUNE**: producer output aceitável mas com gaps → ajustar prompt v0.5
- [ ] **NO-GO**: producer output degrada → manter fixture manual

### `context_hints`

- [ ] **GO**
- [ ] **TUNE**
- [ ] **NO-GO**

### Items (estrutura + relevance)

- [ ] **GO**
- [ ] **TUNE**
- [ ] **NO-GO**

### Decisão agregada

- [ ] **GO substituir fixtures por CI-generated**
- [ ] **TUNE prompt v0.5** (fixture continua manual até prompt convergir)
- [ ] **NO-GO continuar manual** (producer não é confiável pra skip path em prod)

_Análise qualitativa pelo Jun:_

**Specificity ao perfil Ryo (deflective):**

**Persona-tuning (vocabulário, registro, estratégia):**

**Gaps observados:**

**Recomendação prompt v0.5 (se TUNE):**

---

_Methodology: PoC qualitativo (categoria proposta 2026-05-16) — distinto de
unit/smoke (pass/fail), benchmark (quantitativo). Compara output do
producer real (motor#117 mergeado) contra goldens manuais baked em
fixtures durante dev de motor#115._
