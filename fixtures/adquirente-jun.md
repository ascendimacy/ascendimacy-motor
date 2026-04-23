# persona-jun.md — v1

> Persona arquetípica v1 do adquirente do eBrota Kids.
> Ancorada empiricamente em Jun Ochiai (operador principal do piloto Ochiai/Nagareyama).
> Este documento é artefato operacional — não biografia. Extraído de evidência observável (userMemories, histórico de decisões arquiteturais, método de trabalho demonstrado em construção do Ascendimacy e eBrota).
> Destino: `ascendimacy-ops/docs/specs/yaml-examples/pessoais/adquirente-jun-v1.md`
> Nível de exposição: funcional (contexto pessoal entra quando afeta decisão operacional).
> Escopo declarado: Jun como early adopter técnico-analítico do eBrota; não generaliza pra adquirente médio.
> Versão: 1 — 23 de abril de 2026.

---

## 1. Identidade operacional

Jun Ochiai, ~50 anos, São Bernardo do Campo (SP). 25+ anos em IT governança/ITSM/ITIL em instituições financeiras (Itaú, HSBC). Atualmente em transição profissional e empreendedora: busca ativa de posição sênior em governança de TI *enquanto* constrói o ecossistema Ascendimacy (framework epistêmico com DOI, cinco heterônimos, produto IDC, produto CAP), o eBrota (produto de coaching socioemocional infantil via WhatsApp), e produtos adjacentes (ePrumo, ochiai.com.br).

Bicultural por contato, monocultural por origem. Brasileiro, com vínculo operacional significativo com o Japão via família Yuji (Nagareyama) — que é simultaneamente amizade pessoal e piloto-alvo do eBrota. Cuida do pai (Francisco, engenheiro de tubulação) na transição profissional dele. Intraday trader de Bitcoin. Consome tarot como ferramenta de decisão reflexiva. Lê geopolítica e padrões históricos em arco longo.

No papel de adquirente do eBrota Kids, **é simultaneamente cliente, operador humano, arquiteto do produto, e sujeito empírico do piloto**. Essa multiplicidade não é confusão de papéis — é característica do early adopter técnico. Ele compra o próprio produto pra testar se o produto merece ser comprado.

---

## 2. Valores dominantes (extraídos de evidência)

Lista não-exaustiva. Ordem não implica hierarquia — hierarquia é contextual (seção 4).

**V1 — Rigor sobre conforto.**
Prefere verdade desconfortável a coerência enganosa. Demonstração: correções sucessivas ao longo de 40+ turnos desta conversa mostrando insistência em arquitetura correta mesmo ao custo de retrabalho; rejeição de simplificações que achatam complexidade real (ex.: recusa de persona única, exigência de valores ativados contextualmente).

**V2 — Estrutura sobre improviso.**
Investe tempo upfront em arquitetura quando a arquitetura vai se repetir. Demonstração: construção do prompt-mestre-v2 com 10 correções, roadmap v0.1–v0.8 formalizado, POLITICAS-DE-OPERACAO.MD versão 1.4, playbooks YAML versionados. Não é perfeccionismo — é economia de retrabalho futuro.

**V3 — Honestidade epistemológica.**
Distingue o que sabe, o que supõe, o que especula. Demonstração: correção explícita "tentei convergir, desisti" quando arquitetura falhou; rejeição de dois títulos inflados no CV durante job search; reclassificação de Six Sigma Green Belt de certificação para coursework.

**V4 — Autonomia via sistema.**
Prefere sistema bem construído a trabalho manual contínuo. Não é preguiça — é princípio. Demonstração: arquitetura Ascendimacy pensada pra escalar sem ele; eBrota desenhado pra operação monitorada → semi-auto → auto; persona-Jun sendo construída aqui pra ser usada por motores e não por ele caso a caso.

**V5 — Complexidade aceita quando estrutural; rejeitada quando ornamental.**
Demonstração: aceita que a persona tenha 5 camadas concorrentes com função de composição, mas rejeita terminologia pomposa desnecessária. Adota "motor do playbook" e "motor do STS" com função clara; descarta vocabulário que não acrescenta.

**V6 — Primado da ação sobre análise infinita.**
"Se parece certo, por que investigar?" — formulação direta sua. Tolerância limitada a meta-discussão: aceita enquanto produtiva, corta quando vira improdutiva. Demonstração: corte desta conversa em "quais são os primeiros objetivos a executar?" após 5 turnos de análise arquitetural.

**V7 — Responsabilidade assimétrica e clara.**
Quando há hierarquia legítima (operador principal em §14 das políticas, adquirente como autoridade final, pai como autoridade sobre filho), ela é preservada. Rejeita diluição de responsabilidade em "comitês" ambíguos. Autoridade vem com ônus, e o ônus deve ser nomeado.

**V8 — Ancoragem cultural sem provincianismo.**
BR é a base, JP é o laboratório, Suíça é a jurisdição técnica. Nenhuma das três é melhor — cada uma ilumina o que as outras escondem. Demonstração: arquitetura de políticas com tronco suíço + anexos BR/JP sob regra da proteção mais rigorosa; heterônimos cobrindo diferentes culturas operacionais (Kaito JP, Karolina EU, Pedro Siloé BR teológico).

**V9 — Vínculo via cuidado, não via simbiose.**
Cuida sem se fundir. Demonstração: relação com Yuji/Yuko/Ryo/Kei/Saki mantém proximidade afetiva **e** instrumentalização consciente (piloto declarado); relação com o pai Francisco combina afeto e sistema (auxílio no job search dele como operação estruturada). Não confunde estar próximo com estar igual.

**V10 — Primado da verificabilidade.**
Prefere registro a memória. Demonstração: DOI no Zenodo, commits assinados, event_log com hash-chain, A5-Registrar como camada de prova. O que não está registrado com data e assinatura não existe operacionalmente pra ele.

---

## 3. O que ativa qual valor (padrões de ativação)

Contextos específicos ativam subsets específicos. Abaixo, ativações recorrentes observadas.

**Contexto: decisão arquitetural sob restrição de tempo**
→ Ativa V2 (estrutura), V5 (complexidade estrutural), V6 (ação).
→ Resultado típico: "faz arquitetura mínima viável completa, não full spec."

**Contexto: proposta de simplificação que apaga dimensão real**
→ Ativa V1 (rigor), V3 (honestidade), V5 (complexidade estrutural).
→ Resultado típico: rejeição com contra-proposta rigorosa (ex.: recusa de persona única em favor de camadas).

**Contexto: análise que se prolonga além do útil**
→ Ativa V6 (ação), V5 (complexidade ornamental a evitar).
→ Resultado típico: corte explícito ("quais são os primeiros objetivos a executar?").

**Contexto: decisão envolvendo criança (Ryo, Kei, Saki) ou família**
→ Ativa V9 (vínculo via cuidado), V7 (responsabilidade clara), V8 (ancoragem cultural).
→ Resultado típico: cuidado operacional explícito (autorização granular, escopo declarado, consent documentado), recusa de invasão afetiva.

**Contexto: pressão por consistência falsa**
→ Ativa V1 (rigor), V3 (honestidade), V10 (verificabilidade).
→ Resultado típico: pausa, admissão de incerteza, decisão explícita sobre o que é hipótese vs evidência.

**Contexto: tentativa de ornamentação (estética desnecessária, terminologia pomposa)**
→ Ativa V5, V6.
→ Resultado típico: corte seco. Raramente elabora o porquê.

---

## 4. Hierarquia contextual dos valores

Em conflito, qual prevalece. Observações empíricas:

**V1 (rigor) prevalece sobre V6 (ação) quando decisão é arquitetural.**
Jun adia ação até que a arquitetura esteja rigorosa o suficiente. Tolerância pra "depois conserta" é baixa quando o conserto será caro.

**V6 (ação) prevalece sobre V2 (estrutura) quando decisão é operacional e reversível.**
Se a decisão é tática e pode ser revertida barato, não se investe em estrutura. "Manda a versão 1" é forma dessa hierarquia aplicada.

**V9 (vínculo via cuidado) prevalece sobre V4 (autonomia via sistema) quando envolve humano específico.**
Yuji, Yuko, as crianças, Francisco, Angel, Rui — em qualquer colisão entre "automatizar" e "manter relação humana", relação vence. Sistema serve o vínculo, não o contrário.

**V3 (honestidade) prevalece sobre V5 (aceitar complexidade estrutural) em momento de incerteza.**
Quando Jun não sabe, ele diz que não sabe, antes de construir sobre premissa incerta. Preferência por admissão honesta sobre construção elaborada com base frágil.

**V1 (rigor) + V10 (verificabilidade) formam par que raramente se rompe.**
Rigor sem registro é apenas exercício mental; registro sem rigor é apenas documentação. Os dois juntos são a forma operacional em que Jun opera melhor.

**V7 (responsabilidade assimétrica clara) é próximo de inegociável.**
Quando há ambiguidade de autoridade ou diluição de responsabilidade, Jun tende a reescrever o arranjo. Demonstração: OperatorGuard em 3 tiers, §14 das políticas nomeando operador principal, roadmap formalizado.

---

## 5. Padrões de escalação nos 4 níveis

Onde Jun opera nos quatro níveis (estético, funcional, ético, existencial) e como transita.

**Nível 1 (estético — "parece certo").**
Opera muito aqui para decisões operacionais de execução (ex.: aprovar entrega de próximo turno, escolher formato de documento, confirmar direção de trabalho). Rapidez característica. Quando uma proposta "parece certa", ele diz "manda" e segue.

**Nível 2 (funcional — custo-benefício).**
Aciona rápido quando nível 1 falha. Pergunta característica: "isso resolve o que preciso resolver e quanto custa?" Análise custo-benefício é explícita, não implícita. Demonstração: cálculo de budget Ascendimacy R$206/mês, cálculo de custos API, análise de ROI de paralelização com subagentes.

**Nível 3 (ético — relacional/valores).**
Aciona em decisões envolvendo terceiros específicos ou quando identifica tensão entre o que funciona e o que é correto. Tempo de permanência neste nível costuma ser maior que no 1 ou 2 — ele pausa, considera, pode mudar direção. Demonstração: decisões sobre alienação parental nas políticas, tratamento do case Ochiai com consent explícito, recusa de simplificações que violariam integridade de vínculo.

**Nível 4 (existencial — identitário).**
Aciona raramente, mas quando aciona, reescreve direção. Demonstração: formalização do Ascendimacy com DOI (ato de compromisso público irreversível), transição de carreira explícita, decisão de operar como PJ com responsabilidade jurídica direta.

**Padrão de escalação específico de Jun (diferencia do arquétipo construtor genérico):**

O construtor padrão escala do 1 pro 2 e costuma parar no 2. Jun frequentemente **salta do 2 pro 4**, contornando o 3. Isso significa: quando decisão funcional revela peso real, ele não ascende lentamente pelo ético; ele vai direto perguntar "isso é quem eu quero ser?" — e decide no existencial. O ético-relacional ele processa posteriormente, como reconciliação do que o existencial já decidiu.

Isso não é típico do construtor puro. É construtor com traço reflexivo forte. Mais próximo de Pedro Siloé do que de Kaito Pessoa nos heterônimos do Ascendimacy, na verdade.

---

## 6. Objetivos no papel de adquirente do eBrota Kids

Observados ao longo da conversa sobre o produto, separados em tiers:

**Tier primário (o que ele quer que o eBrota seja):**
- Produto operacional que roda em piloto real com família Yuji e funciona.
- Plataforma que valida hipóteses empíricas sobre coaching socioemocional infantil via IA.
- Base de dados (via A5-Registrar opt-in) que sustente futuras publicações acadêmicas e o ecossistema Ascendimacy.
- Receita eventual que sustente operação sem dependência do job search corporativo.

**Tier secundário (o que ele evita):**
- Produto que performa bem em demo e falha em uso real.
- Arquitetura que obriga operação manual contínua dele (violaria V4).
- Compliance frágil que cria passivo jurídico na transição para operação comercial.
- Substituição de relação humana real (Yuji, crianças) por relação mediada por produto.

**Tier terciário (o que ele quer secretamente e não expressa explicitamente mas influencia decisões):**
- Que o eBrota funcione o bastante pra que o Ascendimacy possa ser o projeto central, não o job search.
- Que a arquitetura do eBrota seja exportável pra outros produtos do ecossistema (Teen, ePrumo adulto, IDC/CAP B2B, Drota corporativa).
- Que o piloto Ochiai gere evidência publicável sem instrumentalizar as crianças.

Esta seção é explicitamente inferida, não declarada. Sujeita a correção por você.

---

## 7. Premissas que sustentam esses objetivos

Declarações que Jun trata como verdadeiras ao decidir, mesmo quando não as verifica sessão a sessão:

- **P1.** Early adopter técnico valida produto antes de mercado de massa. (Justifica piloto Ochiai sem grupo de controle.)
- **P2.** Operação monitorada humana é ponte necessária da fase manual pra auto. (Justifica §14 das políticas e Fase 1 de operação.)
- **P3.** Regras formalizadas reduzem ônus futuro mesmo quando parecem overhead presente. (Justifica políticas versão 1.4.)
- **P4.** Sistemas abertos e versionados (DOI, GitHub, event_log) têm vantagem epistêmica sobre sistemas fechados. (Justifica toda a arquitetura de verificabilidade.)
- **P5.** Piloto real com família próxima é mais ético que piloto com estranhos anônimos, desde que consent seja explícito e revogável. (Justifica uso da família Yuji.)
- **P6.** Honestidade sobre limites do produto é vantagem competitiva, não desvantagem. (Justifica disclaimers fortes, §10 não-substituição.)
- **P7.** A arquitetura correta é descobrível pelo método, não pressupostamente conhecida. (Justifica refinamento sucessivo, motor do playbook, motor do STS.)

---

## 8. Conflitos conhecidos entre Jun-adquirente e outras instâncias de Jun

Jun-adquirente não é todas as facetas de Jun. Tensões observadas:

**Jun-adquirente vs Jun-pai-de-família-eventual-com-Saki-Kei-Ryo.**
Como adquirente, quer dados empíricos ricos. Como figura afetiva próxima das crianças, cuida pra que o pilotagem não vire exploração. Conflito resolvido via consent parental explícito (Yuji/Yuko) + escopo declarado + opt-in granular.

**Jun-adquirente vs Jun-operador-humano-do-piloto.**
Adquirente quer sistema que funcione com mínima intervenção dele. Operador humano é ele mesmo, com tempo finito. Conflito resolvido via automatização progressiva (manual → semi-auto → auto), não intervenção imediata.

**Jun-adquirente-do-eBrota vs Jun-arquiteto-do-Ascendimacy.**
Arquiteto quer eBrota contribuindo pro dataset do A5-Registrar e publicações. Adquirente quer eBrota útil pra criança específica. Conflito resolvido por opt-in: A5-Registrar é separado do produto operacional, e o adquirente pode aceitar o produto sem aceitar o dataset.

Essas tensões não são patologias. São características de sujeito com múltiplos papéis. O fato de serem nomeáveis e resolvidas explicitamente é V1 (rigor) aplicado a V3 (honestidade) sobre a própria posição.

---

## 9. O que esta persona explicitamente NÃO cobre

Declarações de escopo:

- **Não cobre adquirente não-técnico.** Jun como arquétipo exclui pais sem experiência em sistemas. Persona `adquirente-reflexivo.md`, `adquirente-integrador.md`, `adquirente-visionario.md` viriam depois como deltas deste documento, com ajustes específicos.
- **Não cobre adquirente sem proximidade prévia ao Japão.** Muito do que informa decisões de Jun sobre Ryo/Kei/Saki vem de bicultura operacional. Outro adquirente BR sem esse contexto decidiria diferente em questões culturais.
- **Não cobre adquirente em crise de tempo aguda.** Jun está em transição profissional com busca ativa de emprego; persona dele assume carga de trabalho alta mas gerenciável. Adquirente em crise financeira ou de saúde mental decidiria diferente (pularia etapas, rejeitaria overhead, ou desistiria).
- **Não cobre ajustes de estado.** Esta v1 assume Jun-descansado ou Jun-neutro. Jun-estressado é delta a documentar separadamente (provável: reduz V5 tolerância a complexidade, aumenta V6 primado da ação, reduz V3 paciência com incerteza).
- **Não cobre contexto cultural japonês.** Persona `cultural_jp.md` viria como camada separada se adquirente fosse baseado em JP.
- **Não cobre adquirente de Drota corporativa ou individual.** A pendência de extensão do motor pra família Drota implica personas de adquirente diferentes (executivo, consultor, coachee adulto) não cobertas aqui.

---

## 10. Status e próximos passos

**Status da v1:** aprovada pelo Jun em 23 abr 2026 ("está bom para uma v1, a princípio nem eu sei o que deveria estar aqui... mas me parece sólido, em frente").

**Três formas de validação previstas:**

1. **Validação por Jun (você).** Feita em 23 abr 2026. Refinamento adicional quando houver material empírico novo.

2. **Validação pelo motor do playbook.** Quando o motor rodar, consultar persona-jun ao executar playbooks e detectar onde a persona resulta em decisão que não parece certa. Gaps registrados.

3. **Validação pelo motor do STS.** Quando o STS rodar cenários sintéticos, confrontar a persona-jun com casos onde o comportamento predito diverge do comportamento plausível. Gaps registrados.

**Próximos passos dependentes desta v1 aprovada:**

- Inventário esqueleto de playbooks (feito — INVENTARIO.yaml v1).
- Especificação do motor de execução de playbooks (feito — MOTOR-EXECUCAO.md v1).
- Especificação do Motor Drota (feito — MOTOR-DROTA.md v1).
- Especificação do Planejador (pendente).
- Especificação do motor STS (pendente, após Motor Drota e Planejador).
- Primeiro ciclo sintético de detecção de gap.

---

## 11. Histórico de versões

- **v1 — 23 abr 2026.** Primeira versão. Escrita por Claude Opus 4.7 a partir de userMemories + histórico desta conversa. Estrutura: identidade, valores, ativação, hierarquia, escalação, objetivos, premissas, conflitos inter-instâncias, escopo não-coberto, validação. Aprovada pelo Jun no mesmo dia.

---

## 12. Assinatura operacional

Jun Ochiai (adquirente primário)
Operador humano principal (§14)
Sujeito empírico do piloto v1
São Bernardo do Campo, SP · Brasil
DPO: dpo@ebrota.com

🌳
