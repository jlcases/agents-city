# Local reception ingest

This measures the durable, human-quarantine boundary only: decrypted messages
committed to private local SQLite in protocol-v2 batches. It uses no network,
relay, model, or fake model latency.

Build the public client, then run the 1,000-message/second gate:

```bash
npm --prefix plugin/channel run build
node benchmarks/reception/run.mjs --messages 1000 --batch-size 32 --minimum 1000
```

Passing this gate says the computer can quarantine the offered transport load
without loss. It does not say a human or model can answer 1,000 requests per
second. Pending-count and byte caps apply backpressure when review falls behind.
