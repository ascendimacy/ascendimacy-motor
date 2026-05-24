import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/svelte";
import ChatFeed from "../../src/components/ChatFeed.svelte";
import { chatBubbles } from "../../src/lib/stores.js";
import type { ChatBubble } from "../../src/lib/types.js";

beforeEach(() => {
  chatBubbles.set([]);
});

describe("ChatFeed.svelte", () => {
  it("mostra estado vazio quando sem bubbles", () => {
    render(ChatFeed);
    expect(screen.getByTestId("chat-empty")).toBeDefined();
  });

  it("renderiza bubbles user + bot quando store popula", () => {
    const bubbles: ChatBubble[] = [
      {
        id: "1",
        role: "user",
        text: "card:tabuada-7",
        timestamp: "2026-05-24T12:00:00.000Z",
      },
      {
        id: "2",
        role: "bot",
        text: "Vamos lá Yuji!",
        timestamp: "2026-05-24T12:00:01.000Z",
      },
    ];
    chatBubbles.set(bubbles);
    render(ChatFeed);
    expect(screen.getByText("card:tabuada-7")).toBeDefined();
    expect(screen.getByText("Vamos lá Yuji!")).toBeDefined();
  });

  it("aplica classe 'pending' em bubble com pendingApproval", () => {
    chatBubbles.set([
      {
        id: "p1",
        role: "bot",
        text: "Texto proposto",
        timestamp: "2026-05-24T12:00:00.000Z",
        pendingApproval: true,
      },
    ]);
    render(ChatFeed);
    expect(screen.getByText(/aprovação pendente/i)).toBeDefined();
  });
});
