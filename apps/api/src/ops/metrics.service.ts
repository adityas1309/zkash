import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly eventCounter: Counter<string>;
  private readonly errorCounter: Counter<string>;
  private readonly activeGauge: Gauge<string>;
  private readonly syncGauge: Gauge<string>;
  private readonly lastSyncGauge: Gauge<string>;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'zkash_' });

    this.eventCounter = new Counter({
      name: 'zkash_app_events_total',
      help: 'Count of successful application events by scope and event name.',
      labelNames: ['scope', 'event'],
      registers: [this.registry],
    });

    this.errorCounter = new Counter({
      name: 'zkash_app_errors_total',
      help: 'Count of application errors by scope and event name.',
      labelNames: ['scope', 'event'],
      registers: [this.registry],
    });

    this.activeGauge = new Gauge({
      name: 'zkash_active_accounts',
      help: 'Number of currently active accounts reflected in aggregated stats.',
      registers: [this.registry],
    });

    this.syncGauge = new Gauge({
      name: 'zkash_indexer_commitment_count',
      help: 'Commitment count observed by the canonical pool indexer.',
      labelNames: ['network', 'pool'],
      registers: [this.registry],
    });

    this.lastSyncGauge = new Gauge({
      name: 'zkash_indexer_last_successful_sync_unix',
      help: 'Unix timestamp of the last successful indexer sync.',
      labelNames: ['network', 'pool'],
      registers: [this.registry],
    });
  }

  increment(scope: string, event: string) {
    this.eventCounter.inc({ scope, event });
  }

  incrementError(scope: string, event: string) {
    this.errorCounter.inc({ scope, event });
  }

  setActiveAccounts(count: number) {
    this.activeGauge.set(count);
  }

  setIndexerCommitmentCount(network: string, pool: string, count: number) {
    this.syncGauge.set({ network, pool }, count);
  }

  setIndexerLastSuccessfulSync(network: string, pool: string, unixSeconds: number) {
    this.lastSyncGauge.set({ network, pool }, unixSeconds);
  }

  async render() {
    return this.registry.metrics();
  }
}
