import { Injectable, Logger } from '@nestjs/common';
import { PassportSerializer } from '@nestjs/passport';
import { AuthService } from './auth.service';

@Injectable()
export class SessionSerializer extends PassportSerializer {
  private readonly logger = new Logger(SessionSerializer.name);

  constructor(private authService: AuthService) {
    super();
  }

  serializeUser(user: { _id: string }, done: (err: Error | null, id?: string) => void): void {
    this.logger.log(`Serializing user: ${user._id}`);
    done(null, user._id.toString());
  }

  async deserializeUser(
    userId: string,
    done: (err: Error | null, user?: unknown) => void,
  ): Promise<void> {
    this.logger.log(`Deserializing user: ${userId}`);
    try {
      const user = await this.authService.findById(userId);
      if (!user) {
        this.logger.warn(`User not found for ID: ${userId}`);
      }
      done(null, user ?? null);
    } catch (err) {
      this.logger.error(`Error deserializing user: ${err}`);
      done(err as Error);
    }
  }
}
