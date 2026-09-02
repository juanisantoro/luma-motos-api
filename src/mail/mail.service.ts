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
  private readonly brevoApiKey?: string;
  private readonly brevoApiTimeoutMs: number;
  private readonly transporter: Transporter | null;
  private readonly fromAddress?: string;
  private readonly fromName?: string;
  private readonly accessUrl: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.brevoApiKey = config.get('BREVO_API_KEY', { infer: true });
    this.brevoApiTimeoutMs =
      config.get('BREVO_API_TIMEOUT_MS', { infer: true }) ?? 10_000;
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
    const apiKey = this.brevoApiKey;
    const transporter = this.transporter;
    if ((!apiKey && !transporter) || !this.fromAddress || !this.fromName) {
      throw new ServiceUnavailableException('Email delivery is not configured');
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
    const subject = `${action} - Luma Motos`;
    const text = [
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
    ].join('\n');
    const html = [
      `<p>Hola ${escapedName},</p>`,
      `<p>${this.escapeHtml(action)}.</p>`,
      `<p><strong>Organización:</strong> ${escapedOrganization}<br>`,
      `<strong>Usuario:</strong> ${escapedEmail}<br>`,
      `<strong>Contraseña temporal:</strong> <code>${escapedPassword}</code><br>`,
      `<strong>Válida hasta:</strong> ${expiresAt}</p>`,
      `<p><a href="${this.escapeHtml(this.accessUrl)}">Configurar mi contraseña</a></p>`,
      '<p>Debés cambiar esta contraseña antes de iniciar sesión.</p>',
      '<p>Si no esperabas este mensaje, contactá al administrador.</p>',
    ].join('');

    try {
      if (apiKey) {
        await this.sendWithBrevoApi(apiKey, message, subject, text, html);
      } else if (transporter) {
        await transporter.sendMail({
          from: {
            name: this.fromName,
            address: this.fromAddress,
          },
          to: message.email,
          subject,
          text,
          html,
        });
      } else {
        throw new ServiceUnavailableException(
          'Email delivery is not configured',
        );
      }
    } catch (error) {
      const transport = apiKey ? 'HTTP API' : 'SMTP';
      this.logger.error(
        `Brevo ${transport} delivery failed: ${this.describeDeliveryError(error)}`,
      );
      throw new ServiceUnavailableException(
        'The temporary password email could not be delivered',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(
      (this.brevoApiKey || this.transporter) &&
      this.fromAddress &&
      this.fromName,
    );
  }

  private async sendWithBrevoApi(
    apiKey: string,
    message: TemporaryPasswordEmail,
    subject: string,
    text: string,
    html: string,
  ): Promise<void> {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: this.fromName,
          email: this.fromAddress,
        },
        to: [{ email: message.email, name: message.fullName }],
        subject,
        textContent: text,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(this.brevoApiTimeoutMs),
    });
    if (!response.ok) {
      const error = new Error(
        'Brevo API rejected the delivery request',
      ) as Error & {
        code?: string;
        status?: number;
      };
      error.code = 'BREVO_API_REJECTED';
      error.status = response.status;
      throw error;
    }
  }

  private describeDeliveryError(error: unknown): string {
    if (error && typeof error === 'object') {
      const candidate = error as {
        code?: string;
        responseCode?: number;
        status?: number;
        name?: string;
        syscall?: string;
        cause?: unknown;
      };
      const cause =
        candidate.cause && typeof candidate.cause === 'object'
          ? (candidate.cause as {
              code?: string;
              syscall?: string;
            })
          : undefined;
      const parts = [
        (candidate.code ?? cause?.code)
          ? `code=${candidate.code ?? cause?.code}`
          : undefined,
        candidate.responseCode !== undefined
          ? `smtpStatus=${candidate.responseCode}`
          : undefined,
        candidate.status !== undefined
          ? `httpStatus=${candidate.status}`
          : undefined,
        candidate.name === 'TimeoutError' ? 'code=TIMEOUT' : undefined,
        (candidate.syscall ?? cause?.syscall)
          ? `operation=${candidate.syscall ?? cause?.syscall}`
          : undefined,
      ].filter((part): part is string => Boolean(part));
      if (parts.length) return parts.join(' | ');
    }
    return 'code=UNKNOWN_DELIVERY_ERROR';
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
