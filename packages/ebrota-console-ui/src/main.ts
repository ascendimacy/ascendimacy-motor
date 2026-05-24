import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app");
if (target === null) {
  throw new Error("eBrota Console UI: #app element não encontrado em index.html");
}

const app = new App({ target });

export default app;
