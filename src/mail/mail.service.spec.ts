import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { EnvironmentVariables } from '../config/environment';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

describe('MailService', () => {
  const createTransport = jest.mocked(nodemailer.createTransport);
  const sendMail = jest.fn<Promise<unknown>, [SendMailOptions]>();
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  const loggerError = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const values: Partial<EnvironmentVariables> = {
    SMTP_HOST: 'smtp-relay.brevo.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'smtp-user',
    SMTP_PASSWORD: 'smtp-password',
    SMTP_FROM_EMAIL: 'noreply@example.com',
    SMTP_FROM_NAME: 'Luma Motos',
    FRONTEND_URL: 'https://luma.example.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messageId: 'api-mail-id' }), {
        status: 201,
      }),
    );
    sendMail.mockResolvedValue({ messageId: 'mail-id' });
    createTransport.mockReturnValue({
      sendMail,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
  });

  afterAll(() => {
    fetchMock.mockRestore();
    loggerError.mockRestore();
  });

  it('sends the temporary password through the configured Brevo relay', async () => {
    const service = new MailService({
      get: jest.fn((key: keyof EnvironmentVariables) => values[key]),
    } as unknown as ConfigService<EnvironmentVariables, true>);

    await service.sendTemporaryPassword({
      email: 'new.user@example.com',
      fullName: 'New User',
      organizationCode: 'LUMA_CENTRAL',
      temporaryPassword: 'temporary-password',
      expiresAt: new Date('2026-08-30T00:00:00.000Z'),
      reason: 'creation',
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp-relay.brevo.com',
        port: 587,
        secure: false,
      }),
    );
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.to).toBe('new.user@example.com');
    expect(message?.subject).toContain('Tu cuenta fue creada');
    if (typeof message?.text !== 'string') {
      throw new Error('Expected a plain-text email body');
    }
    expect(message.text).toContain('temporary-password');
  });

  it('fails explicitly when SMTP credentials are incomplete', async () => {
    const service = new MailService({
      get: jest.fn((key: keyof EnvironmentVariables) =>
        key === 'SMTP_PASSWORD' ? undefined : values[key],
      ),
    } as unknown as ConfigService<EnvironmentVariables, true>);

    await expect(
      service.sendTemporaryPassword({
        email: 'new.user@example.com',
        fullName: 'New User',
        organizationCode: 'LUMA_CENTRAL',
        temporaryPassword: 'temporary-password',
        expiresAt: new Date('2026-08-30T00:00:00.000Z'),
        reason: 'creation',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('prefers the Brevo HTTPS API when its key is configured', async () => {
    const apiValues = {
      ...values,
      BREVO_API_KEY: 'brevo-api-key',
      BREVO_API_TIMEOUT_MS: 5_000,
    };
    const service = new MailService({
      get: jest.fn((key: keyof EnvironmentVariables) => apiValues[key]),
    } as unknown as ConfigService<EnvironmentVariables, true>);

    await service.sendTemporaryPassword({
      email: 'new.user@example.com',
      fullName: 'New User',
      organizationCode: 'LUMA_CENTRAL',
      temporaryPassword: 'temporary-password',
      expiresAt: new Date('2026-08-30T00:00:00.000Z'),
      reason: 'creation',
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(request?.method).toBe('POST');
    expect(new Headers(request?.headers).get('api-key')).toBe('brevo-api-key');
    if (typeof request?.body !== 'string') {
      throw new Error('Expected a JSON request body');
    }
    const body = JSON.parse(request.body) as {
      to: Array<{ email: string }>;
      textContent: string;
    };
    expect(body.to[0]?.email).toBe('new.user@example.com');
    expect(body.textContent).toContain('temporary-password');
  });

  it('fails explicitly when the Brevo HTTPS API rejects delivery', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    const apiValues = {
      ...values,
      BREVO_API_KEY: 'invalid-api-key',
      BREVO_API_TIMEOUT_MS: 5_000,
    };
    const service = new MailService({
      get: jest.fn((key: keyof EnvironmentVariables) => apiValues[key]),
    } as unknown as ConfigService<EnvironmentVariables, true>);

    await expect(
      service.sendTemporaryPassword({
        email: 'new.user@example.com',
        fullName: 'New User',
        organizationCode: 'LUMA_CENTRAL',
        temporaryPassword: 'temporary-password',
        expiresAt: new Date('2026-08-30T00:00:00.000Z'),
        reason: 'creation',
      }),
    ).rejects.toMatchObject({
      message: 'The temporary password email could not be delivered',
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('does not include arbitrary provider error messages in logs', async () => {
    fetchMock.mockRejectedValue(
      new Error('request failed with sensitive provider details'),
    );
    const apiValues = {
      ...values,
      BREVO_API_KEY: 'brevo-api-key',
      BREVO_API_TIMEOUT_MS: 5_000,
    };
    const service = new MailService({
      get: jest.fn((key: keyof EnvironmentVariables) => apiValues[key]),
    } as unknown as ConfigService<EnvironmentVariables, true>);

    await expect(
      service.sendTemporaryPassword({
        email: 'new.user@example.com',
        fullName: 'New User',
        organizationCode: 'LUMA_CENTRAL',
        temporaryPassword: 'temporary-password',
        expiresAt: new Date('2026-08-30T00:00:00.000Z'),
        reason: 'creation',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const logged = String(loggerError.mock.calls.at(-1)?.[0]);
    expect(logged).toContain('code=UNKNOWN_DELIVERY_ERROR');
    expect(logged).not.toContain('sensitive provider details');
  });
});
