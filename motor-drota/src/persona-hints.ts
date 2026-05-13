/**
 * Persona hints — calibração de distribuição de jogadas por persona conhecida.
 *
 * Hardcoded na PR S-T-09-02 + H-AC-02 (motor#88) com observações dos 7
 * sample anatomies em `ascendimacy-ops/docs/specs/jogada-cases-v0.1/` +
 * perfis em `fixtures/profiles/{ryo,kei}-ochiai.pre-phase2.json`.
 *
 * Refinamento esperado: pós-piloto Yuji (Onda 1 do Delta). STS pode
 * formalizar `persona-distribution-priors-v0.md` se dados empíricos
 * justificarem extração desta tabela hardcoded.
 *
 * Refs:
 * - ops#993 (S-T-09-02 — escopo da gen function)
 * - motor#88 (H-AC-02 — rotulagem ISA + persona-aware calibration)
 * - ops/docs/specs/isa-pedagogical-mapping-v0.md (mapeamento canônico)
 * - ops/docs/specs/jogada-cases-v0.1/ (7 samples, evidência empírica)
 */

import type { Intensity, PlayedAs } from "@ascendimacy/shared";

/**
 * Calibração para o gerador: peso relativo de cada jogada na distribuição
 * sugerida + cap de intensidade. O LLM lê isso como sugestão, não regra
 * estrita — o trace pós-Yuji vai medir distribuição realizada vs esperada
 * (futuro: H-AC-08 painel longitudinal).
 */
export interface PersonaHint {
  /** Identificador estável (não muda quando persona evolui). */
  persona_id: string;
  /** Idade no momento do snapshot — informa o LLM do registro adequado. */
  age: number;
  /** Rótulo pedagógico (deflective, philosophical, etc.). */
  archetype: string;
  /**
   * Peso relativo por jogada — soma não precisa ser 1.0 (LLM pondera
   * livremente; valores indicam preferência ordinal + magnitude relativa).
   */
  bias: Array<{ played_as: PlayedAs; weight: number }>;
  /**
   * Cap de intensidade: jogadas críticas (diamante.firm, recovery) com
   * intensidade acima do cap são desencorajadas. Default global Kids <12
   * proíbe `challenge.firm` (Norte §3.2 hook de produto).
   */
  intensity_cap: Intensity;
  /** Vocabulário pessoal observado nos samples — preserva voz nas falas. */
  personal_vocab: string[];
  /** Sumário curto pra prompt — uma frase. */
  notes: string;
}

/**
 * RYO_HINT — Ryo Ochiai (13a, Nagareyama).
 *
 * Sample base:
 * - `espelho-ryo-paciencia-via-curiosidade-internalizada` — devolve
 *   assimetria como pergunta; ancora INTERNA, sem diamante externo.
 * - `canal-ryo-honestidade-traduzida-via-desenho` — pergunta aberta via
 *   canal espacial (desenho como ponte de honestidade).
 * - `bridge-ryo-coragem-via-gohan-cell` — bridge com diamante anime.
 * - `diamante-ryo-honestidade-via-tea-ceremony` — desafio cultural soft.
 * - `arena-ryo-voz-via-evento-social` — convite produção visível.
 *
 * Perfil deflective: silêncio compartilhado, gestos não-verbais, "tipo"/"rola",
 * aversão a "ser ignorado", a "pressão pra se comparar ao Kei". Espelho/canal
 * funcionam porque devolvem material que ele já forneceu, sem invadir.
 * Bridge/diamante mais arriscados — Ryo aceita se ancorado em diamante de
 * peso afetivo (Gohan-Cell) e em intensity soft.
 */
export const RYO_HINT: PersonaHint = {
  persona_id: "ryo-ochiai",
  age: 13,
  archetype: "deflective",
  bias: [
    { played_as: "espelho", weight: 0.30 },
    { played_as: "canal", weight: 0.28 },
    { played_as: "bridge", weight: 0.15 },
    { played_as: "diamante", weight: 0.12 },
    { played_as: "arena", weight: 0.08 },
    { played_as: "recovery", weight: 0.07 },
  ],
  intensity_cap: "medium",
  personal_vocab: ["tipo", "rola"],
  notes:
    "Ryo deflective: priorize espelho/canal (devolve material próprio, " +
    "preserva silêncio); bridge/diamante apenas com diamante cultural de " +
    "peso afetivo (Gohan-Cell, Djokovic) e intensity ≤ medium. " +
    "Aversão a comparações com Kei.",
};

/**
 * KEI_HINT — Kei Ochiai (irmão de Ryo, idade próxima, mais filosófico).
 *
 * Sample base:
 * - `bridge-kei-paciencia-via-djokovic-mental-game` — bridge com diamante
 *   tenista profissional; Kei aceita ancoragem externa de alta carga
 *   técnica.
 *
 * Perfil philosophical: tênis, mecânica, "como o corpo afeta resultados",
 * aversão a "abordagens teóricas sem ligação direta com ação concreta".
 * Diamante/bridge funcionam quando o diamante tem componente concreto
 * (mecânica do grip, ângulo de impacto). Espelho/canal ainda valem mas
 * não dominam.
 */
export const KEI_HINT: PersonaHint = {
  persona_id: "kei-ochiai",
  age: 13,
  archetype: "philosophical",
  bias: [
    { played_as: "diamante", weight: 0.25 },
    { played_as: "bridge", weight: 0.25 },
    { played_as: "canal", weight: 0.18 },
    { played_as: "espelho", weight: 0.15 },
    { played_as: "arena", weight: 0.10 },
    { played_as: "recovery", weight: 0.07 },
  ],
  intensity_cap: "medium",
  personal_vocab: ["tipo"],
  notes:
    "Kei philosophical: aceita diamante/bridge com âncora cultural " +
    "concreta (mecânica, esporte de alta técnica); intensity ≤ medium " +
    "(Kids hard rule). Rejeita perguntas abstratas sem conexão de ação. " +
    "Espelho/canal ainda úteis em momentos de comparação com Ryo.",
};

/** Lookup canônico — retorna null se persona_id desconhecido. */
export function resolvePersonaHint(personaId: string): PersonaHint | null {
  if (personaId === "ryo-ochiai") return RYO_HINT;
  if (personaId === "kei-ochiai") return KEI_HINT;
  return null;
}

/** Render compacto para injeção no prompt LLM. */
export function renderPersonaHintForPrompt(hint: PersonaHint): string {
  const biasLines = hint.bias
    .map((b) => `  - ${b.played_as}: ${b.weight.toFixed(2)}`)
    .join("\n");
  const vocab = hint.personal_vocab.length
    ? hint.personal_vocab.map((v) => `"${v}"`).join(", ")
    : "(nenhum específico)";
  return [
    `### Persona: ${hint.persona_id} (${hint.archetype}, ${hint.age}a)`,
    "",
    `**Distribuição sugerida** (peso ordinal — não é regra estrita):`,
    biasLines,
    "",
    `**Intensity cap**: ${hint.intensity_cap} ` +
      `(Kids <12 proíbe firm; este persona é ${hint.age}, ` +
      `então cap explícito = ${hint.intensity_cap}).`,
    "",
    `**Vocabulário pessoal a preservar**: ${vocab}.`,
    "",
    `**Nota pedagógica**: ${hint.notes}`,
  ].join("\n");
}
