import { Controller, Get, Header } from '@nestjs/common';
import { OpsService } from './ops.service';

@Controller()
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get('health')
  getHealth() {
    return this.opsService.getHealth();
  }

  @Get('ready')
  getReady() {
    return this.opsService.getReadiness();
  }

  @Get('stats')
  getStats() {
    return this.opsService.getStats();
  }

  @Get('status/workspace')
  getStatusWorkspace() {
    return this.opsService.getStatusWorkspace();
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics() {
    return this.opsService.getMetricsText();
  }
}
