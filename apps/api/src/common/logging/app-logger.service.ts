import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AppLoggerService {
  private readonly logger = new Logger('Zkash');

  logEvent(scope: string, event: string, details: Record<string, unknown> = {}) {
    this.logger.log(JSON.stringify({ scope, event, ...details }));
  }

  warnEvent(scope: string, event: string, details: Record<string, unknown> = {}) {
    this.logger.warn(JSON.stringify({ scope, event, ...details }));
  }

  errorEvent(scope: string, event: string, error: unknown, details: Record<string, unknown> = {}) {
    const payload = {
      scope,
      event,
      ...details,
      error: error instanceof Error ? error.message : String(error),
    };
    this.logger.error(JSON.stringify(payload));
  }
}
