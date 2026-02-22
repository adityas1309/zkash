import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      callbackURL: process.env.GOOGLE_CALLBACK_URL ?? 'https://lop-main.onrender.com/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: { id: string; emails?: { value: string }[]; displayName?: string },
    done: VerifyCallback,
  ): Promise<void> {
    try {
      // Ensure emails array exists before passing to service
      const profileWithEmails = {
        id: profile.id,
        emails: profile.emails ?? [],
        displayName: profile.displayName,
      };
      const user = await this.authService.findOrCreateFromGoogle(profileWithEmails);
      console.log('GoogleStrategy: Validated user:', user._id);
      done(null, user);
    } catch (err) {
      console.error('GoogleStrategy: Validation error:', err);
      done(err as Error, undefined);
    }
  }
}
