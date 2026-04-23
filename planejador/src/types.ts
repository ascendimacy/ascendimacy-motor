export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}
