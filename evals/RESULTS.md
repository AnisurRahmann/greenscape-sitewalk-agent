# Pipeline ablation — golden set (10 cases)

First full run: 2026-09-02 against commit `33b2b99` (v0.15.0 + LLM provider
switch), `LLM_PROVIDER=openai` — gpt-4o for the single-shot variant and scope
extraction, gpt-4o-mini for the classify tier, text-embedding-3-small for
retrieval embeddings. Output below is the runner's, unedited.

| variant | scope recall | scope precision | sku acc@1 | pricing error | hallucinated line | false-flag (headline) | median latency | cost/proposal |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A single-shot | 100.0% | 95.5% | 100.0% | 0.0% | 4.5% | 0.0% | 5605.5 ms | $0.0150 |
| B extract + vector + engine | 73.3% | 75.0% | 55.0% | 29.2% | 24.3% | 0.0% | 5391.5 ms | $0.0000 |
| C extract + hybrid RRF + engine | 62.5% | 61.9% | 50.0% | 12.5% | 22.5% | 0.0% | 5591 ms | $0.0000 |
| D = C + guardrails | 66.7% | 76.2% | 50.0% | 28.3% | 23.8% | 0.0% | 6119.5 ms | $0.0000 |

Cost-column note: the staged variants print $0.0000 because the OpenAI adapter
reports dated snapshot model names (e.g. `gpt-4o-2024-11-20`) that are absent
from the rate table, so their tokens audit as unpriced and sum to zero.
