# Evidence

This document contains proof for each requirement checkbox in the capstone brief.

## Requirements Checklist

### Metering
- [ ] **A billable action creates exactly one usage event, even under retries — deduplicated by idempotency key.**
  - *Proof:* [To be filled after testing]

- [ ] **Proof in EVIDENCE.md that double-counting cannot happen: a test output or a transcript of the same request sent twice.**
  - *Proof:* [To be filled after testing]

### Quotas
- [ ] **Usage is checked against the tenant's plan; requests over the limit are rejected.**
  - *Proof:* [To be filled after testing]

- [ ] **Responses carry the correct status codes (429 / 402) and a message explaining why.**
  - *Proof:* [To be filled after testing]

### Cost Calculation
- [ ] **Monthly usage rolls up into a cost figure per tenant.**
  - *Proof:* [To be filled after testing]

- [ ] **AI token pricing handles cached input tokens, reasoning tokens, and output pricing correctly.**
  - *Proof:* [To be filled after testing]

- [ ] **Pricing constants are pinned in config, with proof of correct totals in EVIDENCE.md.**
  - *Proof:* [To be filled after testing]

### Stripe Integration
- [ ] **Subscription checkout works end-to-end in Stripe test mode.**
  - *Proof:* [To be filled after testing]

- [ ] **Webhooks verify signatures, ignore duplicate events, and update tenant plan/status.**
  - *Proof:* [To be filled after testing]

### Data Model, Tests & Documentation
- [ ] **Database includes tenants, plans, subscriptions, and usage events; customer data isolated per tenant.**
  - *Proof:* [To be filled after testing]

- [ ] **README + architecture diagram + setup instructions; the required files from Section 10 present.**
  - *Proof:* [To be filled after testing]

---

## Test Transcripts

*Add curl transcripts, test outputs, and log lines here as you verify each requirement.*