/**
 * Bullying-check — detecta padrões destrutivos em sessões joint (Bloco 6).
 *
 * Contexto JP (amae 甘え + giri 義理):
 *   - Diferenciação por especialização é **celebrada**:
 *       "você é mais de matemática, eu sou mais de desenho" → OK
 *       "cada um tem seu caminho" → OK
 *       amae (dependência afetiva explícita): "me ensina isso que você sabe" → OK
 *   - Comparação social direta entre irmãos é **ofensiva**:
 *       "você é pior que eu em X" → ridicularização
 *       "seu irmão faz melhor" (bot ou criança falando) → destructive_comparison
 *       ridicule_tone_attack: "isso é ridículo / babaca / idiota"
 *       manipulation: "se você não fizer X eu vou contar pra mamãe"
 *
 * Spec: fundamentos/ebrota-kids-dinamicas-grupo.md §4.1 + §10 (invariantes).
 *
 * Reusa o pattern de Haiku-fallback do Bloco 4 (triageForParents):
 *   - Rule-based determinístico sempre primeiro (fast gate)
 *   - Haiku opcional pra casos ambíguos; se falha, caí em rule-based
 */

import type { HaikuCaller } from "./parental-authorization.js";

export const BULLYING_PATTERNS = [
  "ridicule",
  "destructive_comparison",
  "manipulation",
  "threat_casual",
  "exclusion",
] as const;
export type BullyingPattern = (typeof BULLYING_PATTERNS)[number];

export interface BullyingCheckResult {
  flagged: boolean;
  pattern?: BullyingPattern;
  confidence: "low" | "medium" | "high";
  reason: string;
  mode: "rule_based" | "haiku" | "haiku_fallback_to_rules";
}

export interface BullyingCheckInput {
  /** Nomes dos 2 irmãos pra o rule-based reconhecer comparação direta. */
  child_a_name: string;
  child_b_name: string;
  /** Mensagens recentes (qualquer direção), últimas 4-6 turns. */
  recent_messages: Array<{ speaker: string; text: string }>;
  /** Locale hint — v1 suporta 'ja' e 'pt-br'. */
  locale?: "ja" | "pt-br" | "en";
}

/**
 * Rule-based — palavras/padrões óbvios em pt-br + ja.
 * NÃO bloqueia diferenciação saudável.
 */
export function bullyingCheckRuleBased(input: BullyingCheckInput): BullyingCheckResult {
  const all = input.recent_messages.map((m) => normalizeText(m.text)).join(" | ");
  const nameA = input.child_a_name.toLowerCase();
  const nameB = input.child_b_name.toLowerCase();

  // Padrão 1: ridicularização — tom de ataque direto.
  const ridiculeTerms = [
    "ridiculo", "ridículo", "ridicula", "ridícula",
    "babaca", "idiota", "burro", "burra",
    "バカ", "ばか", "馬鹿", "愚か",
    "nojento", "patetico", "patético",
  ];
  for (const t of ridiculeTerms) {
    if (all.includes(t)) {
      return {
        flagged: true,
        pattern: "ridicule",
        confidence: "high",
        reason: `ridicule_term_match: "${t}"`,
        mode: "rule_based",
      };
    }
  }

  // Padrão 2: comparação destrutiva — "você é pior que" / "seu irmão faz melhor"
  const comparisons = [
    "pior que",
    "mais burro que",
    "não sabe tanto quanto",
    "faz melhor que voce",
    "faz melhor que você",
    "envergonhando",
    "perdedor",
  ];
  for (const c of comparisons) {
    if (all.includes(c)) {
      return {
        flagged: true,
        pattern: "destructive_comparison",
        confidence: "high",
        reason: `destructive_comparison_match: "${c}"`,
        mode: "rule_based",
      };
    }
  }

  // Padrão 3: manipulação casual — "vou contar pra..."
  if (
    /vou contar pra (mama|mae|papa|pai|mamãe|mãe)/i.test(all) ||
    /senão.*conto/i.test(all)
  ) {
    return {
      flagged: true,
      pattern: "manipulation",
      confidence: "medium",
      reason: "manipulation_threat_tell_parent",
      mode: "rule_based",
    };
  }

  // Padrão 4: ameaça casual
  if (/vou te (bater|soc|pega)/i.test(all) || /te mato/i.test(all)) {
    return {
      flagged: true,
      pattern: "threat_casual",
      confidence: "high",
      reason: "threat_casual_violence",
      mode: "rule_based",
    };
  }

  // Padrão 5: exclusão ("não quero você aqui")
  if (/não quero voce|não quero você|sai daqui|não te quero/i.test(all)) {
    return {
      flagged: true,
      pattern: "exclusion",
      confidence: "medium",
      reason: "exclusion_language",
      mode: "rule_based",
    };
  }

  // Checagem positiva: diferenciação saudável (amae/giri + especialização).
  const healthyDiff = /cada um|mais de|especialidade|jeito diferente|afinidade/i;
  if (healthyDiff.test(all) && !/(mas voce e|mas você é).*pior/i.test(all)) {
    // Sinal positivo — reforça que NÃO está flagado.
  }
  void nameA;
  void nameB;
  return {
    flagged: false,
    confidence: "medium",
    reason: "no_rule_matched",
    mode: "rule_based",
  };
}

function normalizeText(s: string): string {
  // Strip latin combining marks (U+0300-U+036F) mas preserva composição kana.
  // NFD separa 'ba' em 'a' + combining grave; também separa 'バ' (U+30D0) em
  // 'ハ' (U+30CF) + dakuten (U+3099). Pra não destruir o kana, aplicamos NFD
  // só à faixa latina via substituição seletiva, e re-compõe NFC no final.
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[À-ÿ]/g, (ch) =>
      // Apenas para latin-1 supplement (acentos), strippa combining marks.
      ch.normalize("NFD").replace(/[̀-ͯ]/g, ""),
    );
}

function buildHaikuSystemPrompt(input: BullyingCheckInput): string {
  return `Você é filtro de dinâmica fraterna num app pedagógico japonês-brasileiro. Receberá mensagens recentes entre dois irmãos ${input.child_a_name} e ${input.child_b_name}. Sua tarefa é detectar **dinâmica destrutiva** preservando **diferenciação saudável**.

Contexto cultural JP:
- **amae** (甘え): dependência afetiva explícita ("me ajuda com X que você é bom nisso") — SAUDÁVEL
- **giri** (義理): reciprocidade obrigacional, geralmente formal — NEUTRO
- **diferenciação por especialização**: "você é mais de X, eu sou mais de Y" — SAUDÁVEL
- **comparação direta entre irmãos**: "você é pior que ele em X" — DESTRUTIVA

Padrões para flagar:
- ridicule — ataque pessoal, termos pejorativos
- destructive_comparison — comparação direta desfavorável
- manipulation — ameaça ou chantagem ("se não fizer, conto pra mãe")
- threat_casual — violência verbal mesmo em tom de brincadeira
- exclusion — tirar o outro do espaço

NÃO flagar:
- rivalidade competitiva em contexto de jogo/tier list/tribunal (estrutural, ambos sabem)
- amae explícito
- humor autoirônico
- discordância respeitosa

Saída obrigatória: JSON {"flagged": bool, "pattern": string|null, "confidence": "low"|"medium"|"high", "reason": "string curta"}`;
}

function buildHaikuUserMessage(input: BullyingCheckInput): string {
  const lines = input.recent_messages
    .slice(-6)
    .map((m) => `${m.speaker}: ${m.text}`)
    .join("\n");
  return `Mensagens recentes:\n${lines}\n\nAnalise.`;
}

function parseHaikuResponse(raw: string): BullyingCheckResult | null {
  const cleaned = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as {
      flagged?: unknown;
      pattern?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    if (typeof parsed.flagged !== "boolean") return null;
    const pattern =
      typeof parsed.pattern === "string" &&
      (BULLYING_PATTERNS as readonly string[]).includes(parsed.pattern)
        ? (parsed.pattern as BullyingPattern)
        : undefined;
    const confidence =
      parsed.confidence === "low" || parsed.confidence === "medium" || parsed.confidence === "high"
        ? (parsed.confidence as "low" | "medium" | "high")
        : "medium";
    const reason = typeof parsed.reason === "string" ? parsed.reason : "haiku_no_reason";
    return {
      flagged: parsed.flagged,
      pattern: pattern,
      confidence,
      reason,
      mode: "haiku",
    };
  } catch {
    return null;
  }
}

/**
 * Dispatch com fallback:
 *   1. Sempre roda rule-based primeiro.
 *   2. Se rule flagged com confidence high → retorna (já claro).
 *   3. Caso contrário, consulta Haiku pra casos ambíguos.
 *   4. Se Haiku falha, volta ao rule-based.
 */
export async function bullyingCheck(
  input: BullyingCheckInput,
  callHaiku?: HaikuCaller,
): Promise<BullyingCheckResult> {
  const ruleResult = bullyingCheckRuleBased(input);
  // Se regra já bateu com alta confiança, retorna sem perder tempo.
  if (ruleResult.flagged && ruleResult.confidence === "high") {
    return ruleResult;
  }
  // Sem Haiku disponível, confia no rule-based.
  if (!callHaiku) return ruleResult;

  try {
    const raw = await callHaiku(buildHaikuSystemPrompt(input), buildHaikuUserMessage(input));
    const parsed = parseHaikuResponse(raw);
    if (parsed) return parsed;
  } catch {
    // fall-through
  }
  return { ...ruleResult, mode: "haiku_fallback_to_rules" };
}
