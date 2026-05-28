#!/usr/bin/env node
/**
 * STS run script — stub v0 invoked by BFF spawn (POST /sts/runs/start).
 *
 * Args:
 *   --persona <id>     persona STS id (ex: ryo-ochiai)
 *   --scenario <id>    scenario id (ex: smoke-3d, fail-fast)
 *   --turns <N>        número de turnos a iterar
 *   --run-id <uuid>    run identifier (BFF-provided)
 *
 * Comportamento v0:
 *   - Imprime "STS RUN STARTED ..." e cada 2s emite "turn N/total".
 *   - scenario=fail-fast → exit 1 na 3ª iteração (testa failure path).
 *   - Caso contrário roda --turns iterações e exits 0 com "STS RUN COMPLETED".
 *
 * Implementação real (spawn motor + traces) virá em fase posterior; aqui
 * apenas dá ao BFF um processo real pra spawn/track/cancel.
 */
import { argv, exit, stdout, stderr } from "node:process";

function parseArgs(argList) {
  const out = {};
  for (let i = 0; i < argList.length; i += 1) {
    const arg = argList[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argList[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

const args = parseArgs(argv.slice(2));
const persona = args.persona ?? "(no-persona)";
const scenario = args.scenario ?? "(no-scenario)";
const turns = Number.parseInt(args.turns ?? "6", 10);
const runId = args["run-id"] ?? "(no-run-id)";
const tickMs = Number.parseInt(process.env.STS_STUB_TICK_MS ?? "2000", 10);

stdout.write(
  `STS RUN STARTED run_id=${runId} persona=${persona} scenario=${scenario} turns=${turns}\n`,
);

let cancelled = false;
const onSig = (sig) => {
  cancelled = true;
  stdout.write(`STS RUN CANCELLED signal=${sig}\n`);
  exit(143);
};
process.on("SIGTERM", () => onSig("SIGTERM"));
process.on("SIGINT", () => onSig("SIGINT"));

let i = 0;
const interval = setInterval(() => {
  if (cancelled) {
    clearInterval(interval);
    return;
  }
  i += 1;
  stdout.write(`turn ${i}/${turns}\n`);
  if (scenario === "fail-fast" && i === 3) {
    clearInterval(interval);
    stderr.write(`STS RUN FAILED scenario=fail-fast turn=${i}\n`);
    exit(1);
  }
  if (i >= turns) {
    clearInterval(interval);
    stdout.write(`STS RUN COMPLETED run_id=${runId} turns=${turns}\n`);
    exit(0);
  }
}, tickMs);
