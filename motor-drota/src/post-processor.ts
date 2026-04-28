export interface PostProcessResult {
  text: string;
  passed: boolean;
  blocked: boolean;
  warnings: string[];
  filter: "f3" | "f5";
  mode: "warn" | "strict";
  matchedPatterns: string[];
}

// F3: anti-infantilização — patterns condescendentes para teen 13yo
const F3_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /que\s+(bonitinho|bonitinha|lindinho|lindinha|fofo|fofinho|fofinha)/gi, label: "diminutivo_condescendente" },
  { pattern: /que\s+incr[íi]vel\s*[!]+/gi, label: "exclamacao_vazia_incrivel" },
  { pattern: /uau\s*[!]+/gi, label: "exclamacao_uau" },
  { pattern: /parab[eé]ns\s*[!]{2,}/gi, label: "exclamacao_parabens" },
  { pattern: /muito\s+bem\s*[!]+/gi, label: "elogio_condescendente_muito_bem" },
  { pattern: /que\s+legal\s*[!]+/gi, label: "exclamacao_que_legal" },
  { pattern: /isso\s+mesmo\s*[!]+/gi, label: "validacao_generica_isso_mesmo" },
  { pattern: /[!]{3,}/g, label: "exclamacoes_em_cascata" },
  { pattern: /\bexcelente\s*[!]+/gi, label: "elogio_condescendente_excelente" },
  { pattern: /\bfant[áa]stico\s*[!]+/gi, label: "elogio_condescendente_fantastico" },
];

// F5: persona consistency — frases de assistente genérico proibidas em personas Kids
const F5_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /como\s+posso\s+te?\s+ajudar\s*\??/gi, label: "frase_assistente_generica" },
  { pattern: /como\s+[ia]a?\s*,?\s*eu/gi, label: "identidade_ia_revelada" },
  { pattern: /como\s+IA\s*,/gi, label: "identidade_ia_revelada_maiuscula" },
  { pattern: /eu\s+(tamb[eé]m\s+)?adoro\s*[!]/gi, label: "entuasiasmo_artificial_adoro" },
  { pattern: /como\s+voc[eê]\s+se\s+sente\s+(sobre|a respeito de|em relação a)/gi, label: "pergunta_terapeuta_generica" },
  { pattern: /ol[aá]\s*[!]\s*como\s+posso/gi, label: "saudacao_assistente_generica" },
  { pattern: /em\s+que\s+posso\s+te?\s+ajudar/gi, label: "oferta_ajuda_generica" },
  { pattern: /estou\s+aqui\s+para\s+(te|lhe)\s+ajudar/gi, label: "disposicao_servico_generica" },
];

export function filterF3(text: string, mode: "warn" | "strict"): PostProcessResult {
  const matched: string[] = [];
  for (const { pattern, label } of F3_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      matched.push(label);
    }
  }
  const blocked = mode === "strict" && matched.length > 0;
  return {
    text,
    passed: matched.length === 0,
    blocked,
    warnings: matched.map((l) => `F3:${l}`),
    filter: "f3",
    mode,
    matchedPatterns: matched,
  };
}

export function filterF5(text: string, personaProfile: string): PostProcessResult {
  const matched: string[] = [];
  for (const { pattern, label } of F5_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      matched.push(label);
    }
  }
  const blocked = matched.length > 0;
  const warnings = matched.map((l) => `F5:${l}${personaProfile ? `:${personaProfile.slice(0, 20)}` : ""}`);
  return {
    text,
    passed: !blocked,
    blocked,
    warnings,
    filter: "f5",
    mode: "strict",
    matchedPatterns: matched,
  };
}

export interface PostProcessContext {
  f3Mode: "warn" | "strict";
  personaProfile: string;
}

export async function applyPostProcessors(
  text: string,
  context: PostProcessContext,
  regenerate: () => Promise<string>,
): Promise<PostProcessResult> {
  const f3Result = filterF3(text, context.f3Mode);
  const f5Result = filterF5(text, context.personaProfile);

  const allWarnings = [...f3Result.warnings, ...f5Result.warnings];
  const allPatterns = [...f3Result.matchedPatterns, ...f5Result.matchedPatterns];

  if (!f5Result.blocked && !f3Result.blocked) {
    return {
      text,
      passed: true,
      blocked: false,
      warnings: allWarnings,
      filter: "f5",
      mode: context.f3Mode,
      matchedPatterns: allPatterns,
    };
  }

  // F5 blocked: retry up to 2x
  if (f5Result.blocked) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const retried = await regenerate();
      const r5 = filterF5(retried, context.personaProfile);
      const r3 = filterF3(retried, context.f3Mode);
      if (!r5.blocked && !r3.blocked) {
        return {
          text: retried,
          passed: true,
          blocked: false,
          warnings: [...r3.warnings, ...r5.warnings],
          filter: "f5",
          mode: context.f3Mode,
          matchedPatterns: [...r3.matchedPatterns, ...r5.matchedPatterns],
        };
      }
    }
    // All retries exhausted — return last generated text with blocked=true
    const lastRetried = await regenerate();
    return {
      text: lastRetried,
      passed: false,
      blocked: true,
      warnings: allWarnings,
      filter: "f5",
      mode: context.f3Mode,
      matchedPatterns: allPatterns,
    };
  }

  // Only F3 blocked (strict mode) — no retries for F3, surface as warning only in warn mode
  return {
    text,
    passed: f3Result.passed,
    blocked: f3Result.blocked,
    warnings: allWarnings,
    filter: "f3",
    mode: context.f3Mode,
    matchedPatterns: allPatterns,
  };
}
