# Devright Labs — Agent Governance & Production Architecture

> Ready-to-commit template. Copy into each repo at `docs/GOVERNANCE.md`
> (pair with `.github/devright-agent-governance.json`). Source: V4 structure doc, Part 3.

## Overview
This repository enforces an end-to-end governance and orchestration framework for autonomous
development agents operating within the Devright Labs ecosystem.

## Core Governance Architecture

### 1. Five Pillars Compliance
1. **Evaluation First:** All code and system modifications must be evaluated against numeric
   targets (>90% test suite pass rate). Evals run automatically in CI.
2. **Observability:** Every tool invocation, LLM reasoning step, and state mutation is logged
   into structured trace trees with millisecond latency and context tracking.
3. **Data Foundation:** Strict separation of *Question Data* (knowledge base, live codebase
   context) and *Tracking Data* (distributed traces, session storage).
4. **Orchestration:** Built on an **Orchestrator-Worker** pattern. The primary coordinator
   delegates isolated execution subtasks to worker agents.
5. **Governance & Safety:** Pre-validation layer filters sensitive data/PII. Code mutations
   run inside ephemeral sandboxes with action-level permissions.

### 2. Guardrails & Action Hierarchy
- **Level 1 (Autonomous):** Code parsing, file reads, localized unit testing, draft synthesis.
- **Level 2 (Gated CI):** Feature branch creation, pull request drafting, running full eval pipelines.
- **Level 3 (Protected Action):** Production branch merges, external infrastructure
  modifications, live database migrations, calling external paid APIs. Requires explicit
  authorization or cryptographically signed approval tokens.

### 3. Incident Playbook Sequence
When a production or pipeline evaluation failure is flagged:
Detect Anomaly → Isolate Trace Tree → Rollback Prompt/Model Version → Patch Code/Prompt →
Append Failure Case to Evaluation Data Library.

## Execution safety (from Part 2 — hindsight analysis)
- **Blast-radius containment:** no root/unrestricted shell on live infra; all execution in
  bounded ephemeral containers (memory/CPU/timeout).
- **Circuit breakers:** halt on N repetitive tool calls or when a token/cost budget is
  exceeded (state-drift + runaway-cost protection).
- **Semantic commit governance:** every agent commit/PR documents *why*, *what triggered it*,
  and *which eval spec passed*.
- **Supply-chain security:** static analysis + secret scanning + dependency vulnerability
  checks on all agent-generated code. Light checks on edits; heavy e2e evals on merge only.
