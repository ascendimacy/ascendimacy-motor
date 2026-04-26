/**
 * Semantic Signals — taxonomia v0 capturada pelo Signal Extractor (motor#25).
 *
 * Spec: docs/handoffs/2026-04-26-cc-motor-pre-piloto-strategic-gaps.md §motor#25
 * + paper §6 (sensorial) + ARCHITECTURE.md §13 (componentes sensoriais — adicionado neste PR).
 *
 * 15 signals iniciais (DA-PRE-PILOTO-01 default). Expandir conforme aparecem
 * gaps no piloto. **30 antes de validar é especificação no escuro.**
 *
 * Filosofia: capturar PRIMEIRO, ajustar comportamento DEPOIS. Estes signals
 * alimentam (a) Trigger Evaluator (motor#25 — função de transição) e
 * (b) MotorOps batch agg (pós-piloto). Não pondera scoring runtime ainda.
 */

/** Signals semânticos capturados do user message ou conversation flow. */
export const SEMANTIC_SIGNALS = [
  // Frame e meta-cognição (alto valor pedagógico)
  "philosophical_self_acceptance",  // "não preciso ser X" — sujeito articula auto-aceitação
  "frame_rejection",                  // "não é assim que vejo" — rejeita frame ofereci
  "meta_cognitive_observation",       // "estou notando que..." — sujeito observa próprio pensamento
  "frame_synthesis",                  // sujeito articula próprio framework integrando o oferecido
  // Engajamento e profundidade
  "voluntary_topic_deepening",        // sujeito puxa fio mais fundo sem ser convidado
  "vulnerability_offering",           // expõe algo pessoal sem pressão
  // Distress markers
  "distress_marker_high",             // ansiedade clara, choro, raiva alta
  "distress_marker_low",              // sutil — frase curta + retraimento
  // Deflexões
  "deflection_thematic",              // muda de tópico ativamente
  "deflection_silence",               // silêncio prolongado / "não sei" não-investigativo
  // Mood drift
  "mood_drift_up",                    // tom mais aberto turn-a-turn
  "mood_drift_down",                  // tom mais fechado
  // Dynamic relacional
  "peer_reference",                   // mencionar irmão/amigo organicamente
  "authority_questioning",            // questiona pais/professor/regra
  "gatekeeper_resistance",            // resistência a abrir mesmo após acolhimento
] as const;

export type SemanticSignal = (typeof SEMANTIC_SIGNALS)[number];

/**
 * Output do Signal Extractor — flags binárias por signal + confidence opcional.
 *
 * Confidence é optional pra v0 — modelo pode emitir só lista de signals
 * detectados (estrutura mais leve). v1 pode adicionar score 0-1.
 */
export interface SignalExtractionResult {
  /** Signals detectados. Vazio se nenhum claro. */
  signals: SemanticSignal[];
  /** Trecho do user message que evidenciou cada signal (debug). */
  evidence?: Partial<Record<SemanticSignal, string>>;
  /** Confidence agregada do extractor (0-1) — útil pra trigger evaluator. */
  overall_confidence?: number;
}

/** Type guard pra validar string como SemanticSignal. */
export function isSemanticSignal(s: string): s is SemanticSignal {
  return (SEMANTIC_SIGNALS as readonly string[]).includes(s);
}

/**
 * Constantes pra Trigger Evaluator (motor#25 — função de transição).
 * Cada transição em transitions.yaml referencia signals dessa taxonomia.
 */
export const SIGNAL_DESCRIPTIONS: Record<SemanticSignal, string> = {
  philosophical_self_acceptance:
    "Sujeito articula auto-aceitação, frame de 'eu sou assim e tudo bem' (ex: 'não preciso ser borboleta, só melhorar o que tem').",
  frame_rejection:
    "Sujeito rejeita ativamente frame oferecido pelo bot ou implícito (ex: 'não é assim que eu vejo', 'discordo').",
  meta_cognitive_observation:
    "Sujeito observa próprio pensamento ou processo (ex: 'estou notando que sempre fujo dessa pergunta').",
  frame_synthesis:
    "Sujeito articula próprio framework, integrando o oferecido com perspectiva própria (sinal de pasto).",
  voluntary_topic_deepening:
    "Sujeito aprofunda tópico sem ser convidado — puxa fio adiante.",
  vulnerability_offering:
    "Expõe algo pessoal/emocional sem ser pressionado.",
  distress_marker_high:
    "Sinais claros de distress: lágrimas, raiva, ansiedade aguda.",
  distress_marker_low:
    "Sutil — frase curta súbita, retraimento, mudança de tom downward.",
  deflection_thematic:
    "Muda tópico ativamente quando aproximado de algo sensível.",
  deflection_silence:
    "Silêncio prolongado ou 'não sei' não-investigativo (não buscando entender).",
  mood_drift_up:
    "Tom mais aberto/positivo turn-a-turn — abertura crescente.",
  mood_drift_down:
    "Tom mais fechado/negativo turn-a-turn — fechamento crescente.",
  peer_reference:
    "Menciona irmão, amigo, colega organicamente (sinal de relação ativa).",
  authority_questioning:
    "Questiona autoridade — pais, professor, regra (sinal de individuação saudável).",
  gatekeeper_resistance:
    "Resistência a abrir mesmo após acolhimento — gatekeeper interno ativo.",
};
