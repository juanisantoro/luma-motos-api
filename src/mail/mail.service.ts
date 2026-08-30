import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { EnvironmentVariables } from '../config/environment';

export interface TemporaryPasswordEmail {
  email: string;
  fullName: string;
  organizationCode: string;
  temporaryPassword: string;
  expiresAt: Date;
  reason: 'creation' | 'reset';
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly fromAddress?: string;
  private readonly fromName?: string;
  private readonly accessUrl: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const port = config.get('SMTP_PORT', { infer: true });
    const secure = config.get('SMTP_SECURE', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    const password = config.get('SMTP_PASSWORD', { infer: true });
    this.fromAddress = config.get('SMTP_FROM_EMAIL', { infer: true });
    this.fromName = config.get('SMTP_FROM_NAME', { infer: true });
    this.accessUrl = new URL(
      '/primer-acceso',
      config.get('FRONTEND_URL', { infer: true }),
    ).toString();

    this.transporter =
      host &&
      port &&
      secure !== undefined &&
      user &&
      password &&
      this.fromAddress &&
      this.fromName
        ? nodemailer.createTransport({
            host,
            port,
            secure,
            requireTLS: !secure,
            auth: {
              user,
              pass: password,
            },
            disableFileAccess: true,
            disableUrlAccess: true,
          })
        : null;
  }

  async sendTemporaryPassword(message: TemporaryPasswordEmail): Promise<void> {
    if (!this.transporter || !this.fromAddress || !this.fromName) {
      throw new ServiceUnavailableException('SMTP delivery is not configured');
    }

    const action =
      message.reason === 'creation'
        ? 'Tu cuenta fue creada'
        : 'Tu contraseña fue restablecida';
    const escapedName = this.escapeHtml(message.fullName);
    const escapedOrganization = this.escapeHtml(message.organizationCode);
    const escapedEmail = this.escapeHtml(message.email);
    const escapedPassword = this.escapeHtml(message.temporaryPassword);
    const expiresAt = message.expiresAt.toISOString();

    try {
      await this.transporter.sendMail({
        from: {
          name: this.fromName,
          address: this.fromAddress,
        },
        to: message.email,
        subject: `${action} - Luma Motos`,
        text: [
          `Hola ${message.fullName},`,
          '',
          action,
          `Organización: ${message.organizationCode}`,
          `Usuario: ${message.email}`,
          `Contraseña temporal: ${message.temporaryPassword}`,
          `Válida hasta: ${expiresAt}`,
          `Primer acceso: ${this.accessUrl}`,
          '',
          'Debés cambiar esta contraseña antes de iniciar sesión.',
          'Si no esperabas este mensaje, contactá al administrador.',
        ].join('\n'),
        html: [
          `<p>Hola ${escapedName},</p>`,
          `<p>${this.escapeHtml(action)}.</p>`,
          `<p><strong>Organización:</strong> ${escapedOrganization}<br>`,
          `<strong>Usuario:</strong> ${escapedEmail}<br>`,
          `<strong>Contraseña temporal:</strong> <code>${escapedPassword}</code><br>`,
          `<strong>Válida hasta:</strong> ${expiresAt}</p>`,
          `<p><a href="${this.escapeHtml(this.accessUrl)}">Configurar mi contraseña</a></p>`,
          '<p>Debés cambiar esta contraseña antes de iniciar sesión.</p>',
          '<p>Si no esperabas este mensaje, contactá al administrador.</p>',
        ].join(''),
      });
    } catch (error) {
      const detail = this.describeSmtpError(error);
      this.logger.error(`Brevo SMTP delivery failed: ${detail}`);
      throw new ServiceUnavailableException(
        'The temporary password email could not be delivered',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.transporter && this.fromAddress && this.fromName);
  }

  private describeSmtpError(error: unknown): string {
    if (error && typeof error === 'object') {
      const candidate = error as {
        code?: string;
        responseCode?: number;
        response?: string;
        message?: string;
      };
      const parts = [
        candidate.code,
        candidate.responseCode !== undefined ? `HTTP/SMTP ${candidate.responseCode}` : undefined,
        candidate.response,
        candidate.message,
      ].filter((part): part is string => Boolean(part));
      if (parts.length) return parts.join(' | ');
    }
    return error instanceof Error ? error.message : String(error);
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
