import { ServiceUnavailableException } from '@nestjs/common';
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
  const values: Partial<EnvironmentVariables> = {
    SMTP_HOST: 'smtp-relay.brevo.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'smtp-user',
    SMTP_PASSWORD: 'smtp-password',
    SMTP_FROM_EMAIL: 'noreply@example.com',
    SMTP_FROM_NAME: 'Luma Motos',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: 'mail-id' });
    createTransport.mockReturnValue({
      sendMail,
    } as unknown as ReturnType<typeof nodemailer.createTransport>);
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
});
