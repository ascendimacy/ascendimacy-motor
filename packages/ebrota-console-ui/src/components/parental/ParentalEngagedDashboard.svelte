<script lang="ts">
  import KidSummaryCard from "./KidSummaryCard.svelte";
  import PendingQuestionModal from "./PendingQuestionModal.svelte";
  import AlertBanner from "./AlertBanner.svelte";
  import ProblemReportForm from "./ProblemReportForm.svelte";
  import type {
    DashboardResponse,
    KidSummary,
    TodaySummary,
    WeekProgress,
    PhysicalCard,
    ConversationSession,
    ParentalAlert,
    PulsoEvent,
    PendingQuestion,
  } from "./parental-types.js";

  export let baseUrl: string = "/api";
  export let acquirerId: string = "yuji-ochiai";
  /** Fetch impl injetável pra testes — default globalThis.fetch. */
  export let fetchImpl: typeof globalThis.fetch | undefined = undefined;

  type Tab = "hoje" | "semana" | "cards" | "conversas" | "alertas" | "pulso";

  function getFetch(): typeof globalThis.fetch {
    if (fetchImpl) return fetchImpl;
    return globalThis.fetch.bind(globalThis);
  }

  let dashboard: DashboardResponse | null = null;
  let loadingDashboard = true;
  let dashboardError: string | null = null;

  let selectedChildId: string | null = null;
  let activeTab: Tab = "hoje";

  let today: TodaySummary | null = null;
  let week: WeekProgress | null = null;
  let cards: PhysicalCard[] = [];
  let conversations: ConversationSession[] = [];
  let alerts: ParentalAlert[] = [];
  let pulsoEvents: PulsoEvent[] = [];
  let tabLoading = false;
  let tabError: string | null = null;

  let pendingQuestions: PendingQuestion[] = [];
  let activeQuestion: PendingQuestion | null = null;

  // MC1 status por childId. "pending" → badge "MC1 pendente" no card.
  // Outros estados (delivered, cancelled, not_scheduled) sem badge.
  let mc1Statuses: Record<
    string,
    "pending" | "delivered" | "cancelled" | "not_scheduled"
  > = {};
  let showReportForm = false;
  let showPauseConfirm = false;
  let pauseReason = "";
  let pauseSubmitting = false;
  let pauseFeedback: string | null = null;

  async function loadDashboard(): Promise<void> {
    loadingDashboard = true;
    dashboardError = null;
    try {
      const f = getFetch();
      const res = await f(
        `${baseUrl}/parental/dashboard/${encodeURIComponent(acquirerId)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dashboard = (await res.json()) as DashboardResponse;
      if (selectedChildId === null && dashboard.children.length > 0) {
        selectedChildId = dashboard.children[0]!.childId;
        void loadTab(activeTab);
      }
      void loadPendingQuestions();
      void loadMc1Statuses();
    } catch (err) {
      dashboardError = err instanceof Error ? err.message : String(err);
    } finally {
      loadingDashboard = false;
    }
  }

  async function loadPendingQuestions(): Promise<void> {
    try {
      const f = getFetch();
      const res = await f(`${baseUrl}/parental/escalation/pending-questions`);
      if (!res.ok) return;
      const data = (await res.json()) as { questions: PendingQuestion[] };
      pendingQuestions = data.questions;
    } catch {
      // best-effort
    }
  }

  async function loadMc1Statuses(): Promise<void> {
    if (dashboard === null) return;
    const f = getFetch();
    const entries = await Promise.all(
      dashboard.children.map(async (kid) => {
        try {
          const res = await f(
            `${baseUrl}/parental/mc1/status?childId=${encodeURIComponent(kid.childId)}`,
          );
          if (!res.ok) return [kid.childId, "not_scheduled"] as const;
          const data = (await res.json()) as { status: string };
          return [kid.childId, data.status] as const;
        } catch {
          return [kid.childId, "not_scheduled"] as const;
        }
      }),
    );
    const next: Record<
      string,
      "pending" | "delivered" | "cancelled" | "not_scheduled"
    > = {};
    for (const [cid, status] of entries) {
      if (
        status === "pending" ||
        status === "delivered" ||
        status === "cancelled" ||
        status === "not_scheduled"
      ) {
        next[cid] = status;
      } else {
        next[cid] = "not_scheduled";
      }
    }
    mc1Statuses = next;
  }

  async function loadTab(tab: Tab): Promise<void> {
    if (selectedChildId === null) return;
    tabLoading = true;
    tabError = null;
    try {
      const f = getFetch();
      const cid = encodeURIComponent(selectedChildId);
      if (tab === "hoje") {
        const res = await f(`${baseUrl}/parental/children/${cid}/today`);
        today = (await res.json()) as TodaySummary;
      } else if (tab === "semana") {
        const res = await f(`${baseUrl}/parental/children/${cid}/week`);
        week = (await res.json()) as WeekProgress;
      } else if (tab === "cards") {
        const res = await f(`${baseUrl}/parental/children/${cid}/cards`);
        const data = (await res.json()) as { cards: PhysicalCard[] };
        cards = data.cards;
      } else if (tab === "conversas") {
        const res = await f(
          `${baseUrl}/parental/children/${cid}/conversations`,
        );
        const data = (await res.json()) as { sessions: ConversationSession[] };
        conversations = data.sessions;
      } else if (tab === "alertas") {
        const res = await f(`${baseUrl}/parental/children/${cid}/alerts`);
        const data = (await res.json()) as { alerts: ParentalAlert[] };
        alerts = data.alerts;
      } else if (tab === "pulso") {
        const res = await f(
          `${baseUrl}/parental/children/${cid}/pulso-events`,
        );
        const data = (await res.json()) as { events: PulsoEvent[] };
        pulsoEvents = data.events;
      }
    } catch (err) {
      tabError = err instanceof Error ? err.message : String(err);
    } finally {
      tabLoading = false;
    }
  }

  function selectKid(childId: string): void {
    selectedChildId = childId;
    void loadTab(activeTab);
  }

  function switchTab(tab: Tab): void {
    activeTab = tab;
    void loadTab(tab);
  }

  function openQuestion(q: PendingQuestion): void {
    activeQuestion = q;
  }

  async function submitAnswer(payload: {
    answerText?: string;
    instructionToBrota?: string;
  }): Promise<void> {
    if (activeQuestion === null) return;
    const f = getFetch();
    const res = await f(
      `${baseUrl}/parental/escalation/pending-questions/${encodeURIComponent(
        activeQuestion.questionId,
      )}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pendingQuestions = pendingQuestions.filter(
      (q) => q.questionId !== activeQuestion?.questionId,
    );
  }

  async function submitReport(payload: {
    childId: string;
    type: "tom" | "repeticao" | "off-topic" | "outro";
    text: string;
    sessionRef?: string;
  }): Promise<void> {
    const f = getFetch();
    const res = await f(`${baseUrl}/parental/escalation/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function confirmPause(): Promise<void> {
    if (selectedChildId === null || pauseReason.trim().length === 0) return;
    pauseSubmitting = true;
    pauseFeedback = null;
    try {
      const f = getFetch();
      const res = await f(
        `${baseUrl}/parental/children/${encodeURIComponent(
          selectedChildId,
        )}/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: pauseReason.trim(),
            immediate: true,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      pauseFeedback = "Brota pausado.";
      pauseReason = "";
      setTimeout(() => {
        showPauseConfirm = false;
        pauseFeedback = null;
      }, 1500);
    } catch (err) {
      pauseFeedback = err instanceof Error ? err.message : String(err);
    } finally {
      pauseSubmitting = false;
    }
  }

  $: selectedKid =
    dashboard?.children.find((c: KidSummary) => c.childId === selectedChildId) ??
    null;

  // Trigger inicial — usa reactive guard em vez de onMount pra
  // funcionar tanto em prod (browser) quanto em jsdom/test runner. O
  // guard `bootstrapped` evita refetch quando acquirerId não muda.
  let bootstrapped = false;
  $: if (!bootstrapped && acquirerId) {
    bootstrapped = true;
    void loadDashboard();
  }
</script>

<div class="dashboard" data-testid="parental-engaged-dashboard">
  <header class="topbar">
    <div class="greeting">
      <h1>Olá, {dashboard?.acquirerName ?? "..."}</h1>
      <span class="role-badge" title="Parental Engaged">PE</span>
    </div>
    <div class="topbar-actions">
      {#if pendingQuestions.length > 0}
        <button
          class="action with-badge"
          on:click={() => openQuestion(pendingQuestions[0])}
          data-testid="open-pending-questions"
        >
          Pergunta pendente
          <span class="badge">{pendingQuestions.length}</span>
        </button>
      {/if}
      {#if selectedKid !== null}
        <button
          class="action"
          on:click={() => (showReportForm = true)}
          data-testid="open-report"
        >
          Reportar problema
        </button>
        <button
          class="action danger"
          on:click={() => (showPauseConfirm = true)}
          data-testid="open-pause"
        >
          Pausar Brota
        </button>
      {/if}
    </div>
  </header>

  {#if dashboardError !== null}
    <p class="error-banner">Erro ao carregar: {dashboardError}</p>
  {/if}

  {#if loadingDashboard}
    <p class="muted center">Carregando "dia dos meus filhos"...</p>
  {:else if dashboard !== null}
    <section class="kid-grid" data-testid="kid-grid">
      {#each dashboard.children as kid (kid.childId)}
        <KidSummaryCard
          {kid}
          active={kid.childId === selectedChildId}
          mc1Pending={mc1Statuses[kid.childId] === "pending"}
          onClick={() => selectKid(kid.childId)}
        />
      {/each}
    </section>

    {#if selectedKid !== null}
      <section class="detail" data-testid="kid-detail">
        <nav class="tabs" data-testid="kid-tabs">
          <button
            class:active={activeTab === "hoje"}
            on:click={() => switchTab("hoje")}
            data-testid="tab-hoje">Hoje</button
          >
          <button
            class:active={activeTab === "semana"}
            on:click={() => switchTab("semana")}
            data-testid="tab-semana">Semana</button
          >
          <button
            class:active={activeTab === "cards"}
            on:click={() => switchTab("cards")}
            data-testid="tab-cards">Cards</button
          >
          <button
            class:active={activeTab === "conversas"}
            on:click={() => switchTab("conversas")}
            data-testid="tab-conversas">Conversas</button
          >
          <button
            class:active={activeTab === "alertas"}
            on:click={() => switchTab("alertas")}
            data-testid="tab-alertas">Alertas</button
          >
          <button
            class:active={activeTab === "pulso"}
            on:click={() => switchTab("pulso")}
            data-testid="tab-pulso">Pulso</button
          >
        </nav>

        <div class="tab-content">
          {#if tabError !== null}
            <p class="error">Erro: {tabError}</p>
          {/if}
          {#if tabLoading}
            <p class="muted">Carregando...</p>
          {:else if activeTab === "hoje" && today !== null}
            <div class="block">
              <h3>Hoje — {selectedKid.name}</h3>
              {#if today.engaged}
                <ul class="kv">
                  <li><span>Mood médio:</span> {today.moodAverage ?? "—"}</li>
                  <li>
                    <span>Duração:</span>
                    {today.durationMinutes} min
                  </li>
                  <li>
                    <span>Cards emitidos:</span>
                    {today.cardsEmittedToday}
                  </li>
                  <li>
                    <span>Temas:</span>
                    {today.topicsDiscussed.join(", ") || "—"}
                  </li>
                </ul>
                {#if today.lastMessagePreview !== null}
                  <p class="preview">
                    <strong>Última mensagem:</strong>
                    {today.lastMessagePreview}
                  </p>
                {/if}
              {:else}
                <p class="muted">
                  {selectedKid.name} ainda não interagiu hoje. Não tem problema —
                  Brota envia mensagem nas janelas configuradas.
                </p>
              {/if}
              {#if today.developmentStub}
                <p class="dev-stub-note">
                  Dados de demonstração — view será preenchida quando S5 expor agregado real.
                </p>
              {/if}
            </div>
          {:else if activeTab === "semana" && week !== null}
            <div class="block">
              <h3>Semana — {selectedKid.name}</h3>
              <div class="mood-line">
                {#each week.moodTimeline as day}
                  <div
                    class="mood-cell"
                    title={`${day.date}: ${day.mood ?? "sem dado"}`}
                  >
                    <div
                      class="bar"
                      style={day.mood !== null
                        ? `height:${day.mood * 10}%;`
                        : "height:0;"}
                    ></div>
                    <span class="mood-date">{day.date.slice(8)}</span>
                  </div>
                {/each}
              </div>
              <ul class="kv">
                <li><span>Mood médio:</span> {week.moodAverage ?? "—"}</li>
                <li>
                  <span>Cards emitidos:</span>
                  {week.cardsCount}
                </li>
                <li>
                  <span>Budget usado:</span>
                  {week.sacrificeBudgetUsed}/{week.sacrificeBudgetTotal}
                </li>
                <li>
                  <span>Ratio off-screen:</span>
                  {week.offScreenRatio}
                </li>
                <li>
                  <span>Top temas:</span>
                  {week.topThemes.join(", ")}
                </li>
              </ul>
              <p class="qualitative">{week.qualitativeSummary}</p>
              {#if week.developmentStub}
                <p class="dev-stub-note">
                  Dados de demonstração — view será preenchida quando S5 expor agregado real.
                </p>
              {/if}
            </div>
          {:else if activeTab === "cards"}
            <div class="block">
              <h3>Cards físicos — {selectedKid.name}</h3>
              {#if cards.length === 0}
                <p class="muted">Sem cards emitidos.</p>
              {:else}
                <ul class="card-grid">
                  {#each cards as c (c.cardId)}
                    <li class="phys-card rarity-{c.rarity}">
                      <div class="card-head">
                        <strong>{c.title}</strong>
                        <span class="rarity">{c.rarity}</span>
                      </div>
                      <div class="card-body">
                        <p class="cheat">
                          Cheat code: <code>{c.cheatCode}</code>
                        </p>
                        <p class="qr muted small">QR: {c.qrCodePayload}</p>
                      </div>
                      <div class="card-actions">
                        <a href={c.pdfUrl} target="_blank" rel="noopener"
                          >Imprimir PDF</a
                        >
                        {#if c.used}
                          <span class="used-badge">usado</span>
                        {/if}
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {:else if activeTab === "conversas"}
            <div class="block">
              <h3>Conversas recentes — {selectedKid.name}</h3>
              <p class="muted small">
                View parental — somente leitura, sem painéis técnicos.
              </p>
              {#if conversations.length === 0}
                <p class="muted">Sem sessões.</p>
              {:else}
                <ul class="sessions">
                  {#each conversations as s (s.sessionId)}
                    <li class="session">
                      <div class="session-head">
                        <strong>{s.topicSummary}</strong>
                        <span class="muted small"
                          >{s.durationMinutes} min · {s.turnCount} turnos</span
                        >
                      </div>
                      <ol class="msgs">
                        {#each s.preview as m}
                          <li class="msg from-{m.from}">
                            <span class="who"
                              >{m.from === "kid" ? selectedKid.name : "Brota"}:</span
                            >
                            <span>{m.text}</span>
                          </li>
                        {/each}
                      </ol>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {:else if activeTab === "alertas"}
            <div class="block">
              <h3>Alertas — {selectedKid.name}</h3>
              {#if alerts.length === 0}
                <p class="muted">
                  Sem alertas ativos. Brota monitora distress/drift continuamente.
                </p>
              {:else}
                {#each alerts as a (a.alertId)}
                  <AlertBanner
                    alert={a}
                    onPause={() => (showPauseConfirm = true)}
                    onContactJun={() => alert("Contato Jun: stub V0")}
                    onDismiss={() =>
                      (alerts = alerts.filter((x) => x.alertId !== a.alertId))}
                  />
                {/each}
              {/if}
            </div>
          {:else if activeTab === "pulso"}
            <div class="block">
              <h3>Pulso events — {selectedKid.name}</h3>
              {#if pulsoEvents.length === 0}
                <p class="muted">Sem eventos no período.</p>
              {:else}
                <ul class="pulso-list">
                  {#each pulsoEvents as e (e.eventId)}
                    <li class="pulso-item">
                      <div class="pulso-head">
                        <strong>{e.type.replace("_", " ")}</strong>
                        <span class="muted small">{e.windowLabel}</span>
                      </div>
                      <p class="preview">{e.payloadPreview}</p>
                      <p class="ctx muted small">{e.culturalContext}</p>
                      <p class="reaction small">
                        Reação da criança: <em>{e.kidReaction}</em>
                      </p>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
      </section>
    {/if}
  {/if}

  {#if activeQuestion !== null}
    <PendingQuestionModal
      question={activeQuestion}
      onClose={() => (activeQuestion = null)}
      onSubmit={submitAnswer}
    />
  {/if}

  {#if showReportForm && selectedKid !== null}
    <ProblemReportForm
      childId={selectedKid.childId}
      childName={selectedKid.name}
      onClose={() => (showReportForm = false)}
      onSubmit={submitReport}
    />
  {/if}

  {#if showPauseConfirm && selectedKid !== null}
    <div
      class="backdrop"
      data-testid="pause-confirm"
      on:click={() => (showPauseConfirm = false)}
      on:keydown={(e) => e.key === "Escape" && (showPauseConfirm = false)}
      role="presentation"
    >
      <div
        class="modal small"
        on:click|stopPropagation
        on:keydown|stopPropagation
        role="dialog"
        aria-modal="true"
      >
        <h3>Pausar Brota — {selectedKid.name}?</h3>
        <p class="muted small">
          Brota não envia mensagens espontâneas até você liberar de novo. Conta
          rapidinho o motivo (Jun é notificado).
        </p>
        <textarea
          bind:value={pauseReason}
          rows="3"
          placeholder="Ex: viagem, criança cansada, querendo testar 1 semana sem..."
          data-testid="pause-reason"
        ></textarea>
        {#if pauseFeedback !== null}
          <p class="success">{pauseFeedback}</p>
        {/if}
        <footer>
          <button
            class="ghost"
            on:click={() => (showPauseConfirm = false)}
            disabled={pauseSubmitting}>Cancelar</button
          >
          <button
            class="danger"
            on:click={confirmPause}
            disabled={pauseSubmitting || pauseReason.trim().length === 0}
            data-testid="confirm-pause"
          >
            {pauseSubmitting ? "Pausando..." : "Pausar agora"}
          </button>
        </footer>
      </div>
    </div>
  {/if}
</div>

<style>
  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1rem 1.2rem 2rem;
    max-width: 1100px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .greeting {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .greeting h1 {
    margin: 0;
    font-size: 1.4rem;
    font-weight: 500;
  }
  .role-badge {
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
    background: rgba(127, 127, 127, 0.2);
    opacity: 0.85;
  }
  .topbar-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .action {
    padding: 0.45rem 0.8rem;
    border-radius: 6px;
    border: 1px solid rgba(127, 127, 127, 0.4);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.85rem;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .action:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .action.danger {
    border-color: rgba(229, 115, 115, 0.6);
    color: #e57373;
  }
  .with-badge .badge {
    background: var(--accent, #5b8def);
    color: white;
    border-radius: 10px;
    padding: 0.05rem 0.4rem;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .error-banner {
    color: #e57373;
    background: rgba(229, 115, 115, 0.1);
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    font-size: 0.85rem;
  }
  .center {
    text-align: center;
  }
  .muted {
    opacity: 0.7;
  }
  .small {
    font-size: 0.8rem;
  }
  .kid-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.7rem;
  }
  .detail {
    border-top: 1px solid rgba(127, 127, 127, 0.25);
    padding-top: 1rem;
  }
  .tabs {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    margin-bottom: 0.9rem;
  }
  .tabs button {
    padding: 0.4rem 0.85rem;
    border-radius: 6px 6px 0 0;
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-bottom: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 0.85rem;
    font-family: inherit;
  }
  .tabs button.active {
    background: rgba(91, 141, 239, 0.12);
    border-color: var(--accent, #5b8def);
    font-weight: 600;
  }
  .tab-content {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 0 6px 6px 6px;
    padding: 1rem;
  }
  .block h3 {
    margin: 0 0 0.6rem;
    font-size: 1.05rem;
  }
  .kv {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0;
  }
  .kv li {
    padding: 0.2rem 0;
    font-size: 0.9rem;
  }
  .kv li span {
    display: inline-block;
    min-width: 140px;
    opacity: 0.7;
  }
  .preview {
    font-style: italic;
    padding: 0.4rem 0.6rem;
    background: rgba(127, 127, 127, 0.08);
    border-left: 2px solid rgba(91, 141, 239, 0.6);
    border-radius: 0 4px 4px 0;
    margin: 0.5rem 0;
  }
  .qualitative {
    font-size: 0.9rem;
    line-height: 1.5;
    padding: 0.6rem;
    background: rgba(91, 141, 239, 0.06);
    border-radius: 6px;
    margin-top: 0.6rem;
  }
  .dev-stub-note {
    margin-top: 0.6rem;
    font-size: 0.75rem;
    opacity: 0.55;
    font-style: italic;
  }
  .mood-line {
    display: flex;
    gap: 4px;
    height: 80px;
    align-items: end;
    margin: 0.5rem 0 1rem;
  }
  .mood-cell {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    justify-content: end;
  }
  .mood-cell .bar {
    width: 100%;
    background: linear-gradient(180deg, #5b8def, #4caf50);
    border-radius: 3px 3px 0 0;
    min-height: 3px;
  }
  .mood-cell .mood-date {
    font-size: 0.65rem;
    opacity: 0.6;
    margin-top: 3px;
  }
  .card-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.6rem;
  }
  .phys-card {
    border: 1px solid rgba(127, 127, 127, 0.3);
    border-radius: 8px;
    padding: 0.7rem;
    background: rgba(255, 255, 255, 0.04);
  }
  .phys-card.rarity-rare {
    border-color: #5b8def;
  }
  .phys-card.rarity-epic {
    border-color: #a87ddf;
  }
  .phys-card.rarity-legendary {
    border-color: #f2a65a;
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.3rem;
  }
  .rarity {
    font-size: 0.65rem;
    text-transform: uppercase;
    opacity: 0.7;
    letter-spacing: 0.06em;
  }
  .card-body {
    font-size: 0.85rem;
  }
  .cheat code {
    background: rgba(127, 127, 127, 0.15);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
  }
  .qr {
    word-break: break-all;
  }
  .card-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.4rem;
    font-size: 0.85rem;
  }
  .used-badge {
    font-size: 0.7rem;
    background: rgba(127, 127, 127, 0.2);
    padding: 0.05rem 0.4rem;
    border-radius: 3px;
  }
  .sessions {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .session {
    border: 1px solid rgba(127, 127, 127, 0.25);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    background: rgba(255, 255, 255, 0.03);
  }
  .session-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.3rem;
    align-items: baseline;
  }
  .msgs {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .msg {
    font-size: 0.88rem;
    padding: 0.2rem 0;
  }
  .msg .who {
    font-weight: 600;
    margin-right: 0.3rem;
    opacity: 0.85;
  }
  .pulso-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .pulso-item {
    border-left: 3px solid #a87ddf;
    padding: 0.4rem 0.7rem;
    background: rgba(168, 125, 223, 0.06);
    border-radius: 0 6px 6px 0;
  }
  .pulso-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    text-transform: capitalize;
  }
  .pulso-item .preview {
    margin: 0.3rem 0;
    background: transparent;
    border-left: none;
    padding: 0;
    font-style: normal;
    font-size: 0.9rem;
  }
  .ctx {
    margin: 0.3rem 0;
  }
  .reaction em {
    color: var(--accent, #5b8def);
    font-style: normal;
  }
  .error {
    color: #e57373;
    font-size: 0.85rem;
  }
  .success {
    color: #81c784;
    font-size: 0.85rem;
    margin: 0.4rem 0 0;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal {
    background: var(--color-bg, #1f1f1f);
    border-radius: 12px;
    width: 100%;
    border: 1px solid rgba(127, 127, 127, 0.3);
    padding: 1.5rem;
  }
  .modal.small {
    max-width: 420px;
  }
  .modal textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.6rem;
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    font-family: inherit;
    font-size: 0.95rem;
    resize: vertical;
    margin-top: 0.5rem;
  }
  footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  footer button {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 0.9rem;
    font-family: inherit;
  }
  footer button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  footer .ghost {
    background: transparent;
    border-color: rgba(127, 127, 127, 0.4);
    color: inherit;
  }
  footer .danger {
    background: #e57373;
    color: white;
  }
  @media (max-width: 640px) {
    .greeting h1 {
      font-size: 1.2rem;
    }
    .topbar {
      align-items: flex-start;
    }
    .kid-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
