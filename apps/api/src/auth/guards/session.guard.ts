import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly logger = new Logger(SessionAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    this.logger.log(`SessionAuthGuard: Checking user session. User present: ${!!req.user}`);
    if (req.session) {
      this.logger.log(`SessionAuthGuard: Session ID: ${req.session.id}`);
      this.logger.log(`SessionAuthGuard: Session Data: ${JSON.stringify(req.session)}`);
    } else {
      this.logger.log('SessionAuthGuard: No session object on request');
    }
    return !!req.user;
  }
}
