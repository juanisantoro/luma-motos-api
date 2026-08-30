import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuditedMutation } from '../audit/decorators/audited-mutation.decorator';
import { AuthService } from './auth.service';
import type { AuthenticatedUser, LoginResponse } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { CurrentSession } from './decorators/current-session.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ChangeTemporaryPasswordDto } from './dto/change-temporary-password.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @AuditedMutation()
  @HttpCode(200)
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
      blockDuration: 5 * 60_000,
    },
  })
  login(@Body() credentials: LoginDto): Promise<LoginResponse> {
    return this.authService.login(credentials);
  }

  @Post('request-password-reset')
  @Public()
  @AuditedMutation()
  @HttpCode(204)
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
      blockDuration: 5 * 60_000,
    },
  })
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<void> {
    await this.authService.requestPasswordReset(dto);
  }

  @Post('change-temporary-password')
  @Public()
  @AuditedMutation()
  @HttpCode(204)
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
      blockDuration: 5 * 60_000,
    },
  })
  async changeTemporaryPassword(
    @Body() credentials: ChangeTemporaryPasswordDto,
  ): Promise<void> {
    await this.authService.changeTemporaryPassword(credentials);
  }

  @Post('change-password')
  @AuditedMutation()
  @HttpCode(204)
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
      blockDuration: 5 * 60_000,
    },
  })
  async changePassword(
    @Body() credentials: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.authService.changePassword(credentials, user);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Post('logout')
  @AuditedMutation()
  @HttpCode(204)
  async logout(
    @CurrentSession() sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.authService.logout(sessionId, user);
  }
}
