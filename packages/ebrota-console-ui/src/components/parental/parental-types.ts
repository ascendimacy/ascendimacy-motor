/**
 * Types compartilhados pelos componentes parental engaged.
 *
 * Duck-typed contra os shapes do BFF (routes/parental-dashboard-routes.ts).
 * Mantidos UI-side pra evitar dependência cross-package.
 */

export interface KidSummary {
  childId: string;
  name: string;
  age: number;
  primaryLanguage: string;
  avatarColor: string;
  engagedToday: boolean;
  lastSeenAt: string | null;
  moodToday: number | null;
  durationMinutesToday: number;
  oneLineSummary: string;
  developmentStub?: boolean;
}

export interface DashboardResponse {
  acquirerId: string;
  acquirerName: string;
  generatedAt: string;
  pendingQuestionsCount: number;
  unreadAlertsCount: number;
  children: KidSummary[];
}

export interface TodaySummary {
  childId: string;
  date: string;
  engaged: boolean;
  moodAverage: number | null;
  durationMinutes: number;
  topicsDiscussed: string[];
  lastMessagePreview: string | null;
  lastSeenAt: string | null;
  cardsEmittedToday: number;
  developmentStub?: boolean;
}

export interface WeekProgress {
  childId: string;
  weekStartIso: string;
  weekEndIso: string;
  moodTimeline: Array<{ date: string; mood: number | null }>;
  moodAverage: number | null;
  cardsCount: number;
  cardThumbnails: Array<{ cardId: string; title: string; rarity: string }>;
  sacrificeBudgetTotal: number;
  sacrificeBudgetUsed: number;
  offScreenRatio: number;
  topThemes: string[];
  qualitativeSummary: string;
  developmentStub?: boolean;
}

export interface PhysicalCard {
  cardId: string;
  title: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  emittedAt: string;
  thumbnailUrl: string;
  qrCodePayload: string;
  cheatCode: string;
  pdfUrl: string;
  used: boolean;
}

export interface ConversationSession {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  turnCount: number;
  durationMinutes: number;
  topicSummary: string;
  preview: Array<{ from: "kid" | "brota"; text: string; at: string }>;
  developmentStub?: boolean;
}

export interface ParentalAlert {
  alertId: string;
  type: "distress" | "drift" | "negative_sequence" | "other";
  severity: "info" | "warn" | "critical";
  raisedAt: string;
  context: string;
  excerpt: string;
  sessionRefs: string[];
  proposedAction: "pause_brota" | "contact_jun" | "wait" | "review";
  status: "open" | "ack" | "resolved";
  developmentStub?: boolean;
}

export interface PulsoEvent {
  eventId: string;
  type: "omikuji" | "mini_historia" | "lembrete_cultural" | "outro";
  firedAt: string;
  windowLabel: string;
  culturalContext: string;
  payloadPreview: string;
  kidReaction: "engaged" | "ignored" | "positive" | "negative" | "unknown";
  developmentStub?: boolean;
}

export interface PendingQuestion {
  questionId: string;
  childId: string;
  raisedAt: string;
  brotaContextTurns: Array<{ from: "kid" | "brota"; text: string }>;
  rawQuestion: string;
  escalationReason: string;
  status: "open" | "answered";
  developmentStub?: boolean;
}
