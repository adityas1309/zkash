import { Body, Controller, Get, Post, Req, Res, UseGuards, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SessionAuthGuard } from './guards/session.guard';
import { DeleteAccountDto } from '../common/dto/auth.dto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(private readonly authService: AuthService) { }

  @Get('workspace')
  async workspace(@Req() req: any) {
    return this.authService.getAuthWorkspace(req.user?._id?.toString());
  }

  @Get('account/workspace')
  @UseGuards(SessionAuthGuard)
  async accountWorkspace(@Req() req: any) {
    return this.authService.getAccountWorkspace(req.user._id.toString());
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Guard redirects to Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    console.log('Google Callback Hit');
    console.log('User from Guard:', req.user);

    if (req.user) {
      try {
        await new Promise<void>((resolve, reject) => {
          req.logIn(req.user, (err: any) => {
            if (err) return reject(err);
            resolve();
          });
        });
        console.log('Manual login successful');
      } catch (err) {
        console.error('Manual login failed:', err);
      }
    } else {
      console.error('No user found in request after Guard');
    }

    if (req.session) {
      console.log('Saving session...', req.session);
      req.session.save((err: any) => {
        if (err) {
          console.error('Session save error:', err);
        } else {
          console.log('Session saved successfully');
        }
        res.redirect(`${frontendUrl}/dashboard`);
      });
    } else {
      console.log('No session to save');
      res.redirect(`${frontendUrl}/dashboard`);
    }
  }

  @Get('logout')
  logout(@Req() req: Request, @Res() res: Response) {
    (req as any).logout((err: any) => {
      if (err) console.error('Logout error:', err);
      req.session?.destroy(() => {
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
        res.clearCookie('connect.sid'); // clear the session cookie
        res.redirect(`${frontendUrl}/`);
      });
    });
  }

  @Get('delete-me')
  @UseGuards(SessionAuthGuard)
  async deleteMe(@Req() req: any, @Res() res: Response) {
    this.logger.log(`Deleting user: ${req.user._id}`);
    await this.authService.deleteUser(req.user._id);
    req.logout((err: any) => {
      if (err) this.logger.error('Logout error during deletion:', err);
      req.session.destroy(() => {
        res.redirect('/');
      });
    });
  }

  @Post('delete-me')
  @UseGuards(SessionAuthGuard)
  async deleteMeConfirmed(@Req() req: any, @Body() body: DeleteAccountDto) {
    const expected = String(req.user.username ?? '').trim().toLowerCase();
    const provided = String(body.confirmation ?? '').trim().toLowerCase();

    if (!expected || provided !== expected) {
      return {
        success: false,
        error: `Type ${req.user.username} exactly to confirm account deletion.`,
      };
    }

    await this.authService.deleteUser(req.user._id);

    await new Promise<void>((resolve) => {
      req.logout(() => resolve());
    });

    await new Promise<void>((resolve) => {
      req.session?.destroy(() => resolve());
    });

    return {
      success: true,
      deleted: true,
      redirectTo: '/',
    };
  }
}
