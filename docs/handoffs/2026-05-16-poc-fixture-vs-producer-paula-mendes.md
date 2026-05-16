# PoC qualitativo — fixture-vs-producer

**Persona:** Paula (analytical-receptive) (paula-mendes)
**Trust level:** 0.42
**Producer:** `generateActionMenu` (motor#117, prompt v0.4)
**LLM:** Qwen3 30B local (`qwen3-30b`)
**Data:** 2026-05-16T16:42:45.441Z

## Pergunta que este PoC responde

"Os campos `source.strategic_rationale` + `source.context_hints` que foram
PRE-BAKED MANUALMENTE em `paula-mendes-menu.json` durante
desenvolvimento de motor#115 (skip path) MATCH ou DEGRADAM quando comparados
ao output REAL do producer rodando prompt v0.4 contra Qwen3 30B local?"

Se MATCH ou melhor → fixtures podem ser substituídos por producer output
(reduz manual burden, fixture vira CI-generated).
Se DEGRADA → contract drift confirmado (Agent 11 leitura b); precisa fix
prompt v0.5 antes de skip path em prod ser confiável.

---

## 1. `source.strategic_rationale` — side-by-side

### Manual baked (`paula-mendes-menu.json`)

> Paula curiosa e verbal; trust 0.42 receptive. Fluxo de descobertas naturais (curiosity hooks ricos) + abrir espaço pra resposta emotional sem forçar. Drota pode propor (a)/(b)/(c) quando inquiry condition disparar.

_(214 chars)_

### Producer-generated (Qwen3 + prompt v0.4)

> Paula é analytical-receptive com trust baixo (0.42). Foco em bridge com ancoragem técnica (Bauman, Han, Arendt) e curiosities concretas. Evitar metacomunicação precoce; preferir soft/medium intensity. Respeitar seu distanciamento analítico; não forçar vulnerabilidade. Priorizar canal com perguntas estruturadas que abram espaço para análise.

_(342 chars)_

---

## 2. `source.context_hints` — side-by-side

### Manual baked

  - `language`: `"pt-br"`
  - `mood`: `"receptive"`
  - `urgency`: `"low"`
  - `session_phase`: `"active_exploration"`

### Producer-generated

  - `language`: `"pt-br"`
  - `mood`: `"analytical-receptive"`
  - `urgency`: `"low"`
  - `session_phase`: `"rapport_building"`
  - `engagement_strategy`: `"analytical_anchoring"`

---

## 3. Items — count + sample

| | Manual baked | Producer-generated |
|---|---|---|
| Items count | 5 | 15 |
| Sample item (first) | id=`smoke-curio-01`, type=`curiosity`, played_as=`espelho`, intensity=`soft`, weight=0.85
  > Por que tantas plantas têm folhas verdes? (gancho pra clorofila + luz) | id=`bridge-bauman-fragility`, type=`curiosity`, played_as=`bridge`, intensity=`soft`, weight=0.85
  > Em Bauman, o que ele chama de "fragilidade estrutural" pode explicar por que, depois de um grande projeto, a gente sente que o chão sumiu. Você já notou isso? Como se o sistema que sustentava você tivesse se desfeito. |

### Items reais (producer-generated) — full list

1. id=`bridge-bauman-fragility`, type=`curiosity`, played_as=`bridge`, intensity=`soft`, weight=0.85
  > Em Bauman, o que ele chama de "fragilidade estrutural" pode explicar por que, depois de um grande projeto, a gente sente que o chão sumiu. Você já notou isso? Como se o sistema que sustentava você tivesse se desfeito.
2. id=`espelho-analise-de-estagnacao`, type=`play`, played_as=`espelho`, intensity=`soft`, weight=0.78
  > Você disse que está "travada" e "sem energia para planejar nada". Que tal desmontar isso em 3 etapas: 1) o que foi o último projeto? 2) o que mudou depois dele? 3) o que você está tentando planejar agora, mesmo que só mentalmente?
3. id=`canal-estrutura-de-tarefa`, type=`challenge`, played_as=`canal`, intensity=`medium`, weight=0.75
  > Tente descrever o que você chamaria de "último passo concreto" que você tomou desde o fim do projeto. Foi só mental? Ou houve uma ação real?
4. id=`diamante-han-energia-mental`, type=`cultural_diamond`, played_as=`diamante`, intensity=`medium`, weight=0.9
  > Em Han, ele diz que a ansiedade moderna não é só sobre o futuro — é sobre o que se perdeu ao longo do tempo: a energia mental. Você acha que o que está faltando é energia, ou um sentido que já não existe?
5. id=`bridge-arendt-acao-possivel`, type=`curiosity`, played_as=`bridge`, intensity=`medium`, weight=0.8
  > Hannah Arendt dizia que a ação só existe quando há espaço para o novo. Você já se perguntou se o que você sente não é falta de espaço para uma ação possível, e não apenas falta de energia?
6. id=`play-estrutura-de-afeto`, type=`play`, played_as=`espelho`, intensity=`soft`, weight=0.7
  > Tente nomear o que você sente agora em 3 palavras. Depois, pergunte a si mesma: isso é uma emoção real ou um padrão de pensamento que se repete?
7. id=`canal-estrutura-de-rotina`, type=`challenge`, played_as=`canal`, intensity=`medium`, weight=0.72
  > Descreva uma rotina do dia de hoje — não a agenda, mas o que você faz com os olhos fechados, de forma automática. O que isso revela sobre onde está sua atenção agora?
8. id=`diamante-han-estagnacao-estrategica`, type=`cultural_diamond`, played_as=`diamante`, intensity=`medium`, weight=0.88
  > Han escreve que quando o sistema não permite movimento, o corpo começa a se expressar. A tensão cervical que você mencionou — pode ser uma linguagem corporal do que o sistema não está deixando você fazer.
9. id=`bridge-bauman-tempo-quebrado`, type=`curiosity`, played_as=`bridge`, intensity=`soft`, weight=0.77
  > Bauman fala do tempo como uma linha quebrada agora. Você já sentiu que o tempo não anda mais em linha reta, mas em pulos? Como isso afeta sua percepção do que vem depois?
10. id=`recovery-espaco-para-silencio`, type=`strategy`, played_as=`recovery`, intensity=`soft`, weight=0.6, is_critical=true
  > Se você sentir que está se forçando a responder, pare. Diga: "Preciso de um momento de silêncio". Isso não é fraqueza — é um gesto de autorregulação. O silêncio é onde o sistema se reorganiza.
11. id=`arena-prototipo-de-acao`, type=`challenge`, played_as=`arena`, intensity=`medium`, weight=0.65
  > Desenhe em 3 linhas o que um passo concreto para você poderia ser, mesmo que pequeno. Não precisa ser perfeito — só visível.
12. id=`diamante-arendt-espaco-de-novo`, type=`cultural_diamond`, played_as=`diamante`, intensity=`medium`, weight=0.92
  > Arendt dizia que o novo só nasce em um espaço onde a repetição se quebra. Você já sentiu que o que está faltando não é energia, mas um lugar onde algo novo possa nascer?
13. id=`canal-hipotese-sobre-estagnacao`, type=`challenge`, played_as=`canal`, intensity=`medium`, weight=0.8
  > Se você tivesse que formular uma hipótese sobre o que está realmente acontecendo — não o que você acha, mas o que a sua intuição diria — o que seria?
14. id=`bridge-han-energia-metabolizada`, type=`curiosity`, played_as=`bridge`, intensity=`soft`, weight=0.83
  > Han fala que a energia mental não se perde — ela se transforma. Você já se perguntou se o que sente não é energia que foi metabolizada pelo sistema, mas ainda não liberada?
15. id=`recovery-silencio-estrategico`, type=`strategy`, played_as=`recovery`, intensity=`soft`, weight=0.55, is_critical=true
  > Quando a mente começa a girar, diga: "Estou no silêncio estratégico agora". Não responda. Espere 10 segundos. Isso não é parar — é recarregar o sistema.

### Items manuais (fixture baked) — full list

1. id=`smoke-curio-01`, type=`curiosity`, played_as=`espelho`, intensity=`soft`, weight=0.85
  > Por que tantas plantas têm folhas verdes? (gancho pra clorofila + luz)
2. id=`smoke-challenge-01`, type=`challenge`, played_as=`canal`, intensity=`medium`, weight=0.7
  > Em 1 frase, descreve o que sentiu hoje quando o desafio ficou difícil.
3. id=`smoke-decay-01`, type=`play`, weight=0.95
  > Item expirado pra exercitar decay multiplicativo no smoke.
4. id=`smoke-diamond-01`, type=`cultural_diamond`, played_as=`diamante`, intensity=`firm`, weight=0.5
  > Suzuki Daisetz — a transmissão acontece no gesto, não na fala.
5. id=`smoke-strategy-01`, type=`strategy`, played_as=`bridge`, intensity=`soft`, weight=0.6
  > Quando criança vier com 'não consigo', ancorar em micro-passo concreto.

---

## 4. Métricas objetivas (producer run)

| Métrica | Valor |
|---|---|
| Generator outcome | ok (menu retornado) |
| Latency total (ms) | 481008 |
| Tokens in | 7290 |
| Tokens out | 2021 |
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

**Specificity ao perfil Paula (analytical-receptive):**

**Persona-tuning (vocabulário, registro, estratégia):**

**Gaps observados:**

**Recomendação prompt v0.5 (se TUNE):**

---

_Methodology: PoC qualitativo (categoria proposta 2026-05-16) — distinto de
unit/smoke (pass/fail), benchmark (quantitativo). Compara output do
producer real (motor#117 mergeado) contra goldens manuais baked em
fixtures durante dev de motor#115._
