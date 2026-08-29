import { validateEnvironment } from './environment';

const validEnvironment = {
  DATABASE_URL:
    'postgresql://user:password@pooler.example.neon.tech/luma?sslmode=require',
  DIRECT_URL:
    'postgresql://user:password@example.neon.tech/luma?sslmode=require',
  FRONTEND_URL: 'https://luma.example.com',
  JWT_SECRET: 'a-secret-with-at-least-thirty-two-characters',
};

describe('validateEnvironment', () => {
  it('applies application defaults and converts the port', () => {
    const environment = validateEnvironment({
      ...validEnvironment,
      PORT: '4000',
    });

    expect(environment.NODE_ENV).toBe('development');
    expect(environment.PORT).toBe(4000);
    expect(environment.JWT_SESSION_IDLE_TIMEOUT_SECONDS).toBe(3600);
    expect(environment.PRISMA_TRANSACTION_MAX_WAIT_MS).toBe(10_000);
    expect(environment.PRISMA_TRANSACTION_TIMEOUT_MS).toBe(30_000);
    expect(environment.USER_TEMPORARY_PASSWORD_TTL_SECONDS).toBe(86_400);
    expect(environment.SMTP_HOST).toBeUndefined();
    expect(environment.SMTP_PASSWORD).toBeUndefined();
  });

  it('accepts a complete SMTP environment block', () => {
    const environment = validateEnvironment({
      ...validEnvironment,
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'smtp-login',
      SMTP_PASSWORD: 'smtp-key',
      SMTP_FROM_EMAIL: 'noreply@example.com',
      SMTP_FROM_NAME: 'Luma Motos',
    });

    expect(environment.SMTP_HOST).toBe('smtp-relay.brevo.com');
    expect(environment.SMTP_PORT).toBe(587);
    expect(environment.SMTP_SECURE).toBe(false);
  });

  it('rejects an incomplete SMTP environment block', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        SMTP_HOST: 'smtp-relay.brevo.com',
        SMTP_PORT: 587,
      }),
    ).toThrow(/SMTP_HOST.*required peers.*SMTP_PASSWORD/);
  });

  it('requires SMTP delivery configuration in production', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
      }),
    ).toThrow(/SMTP_HOST.*required/);
  });

  it('rejects idle timeouts outside the supported range', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_SESSION_IDLE_TIMEOUT_SECONDS: 30,
      }),
    ).toThrow(/JWT_SESSION_IDLE_TIMEOUT_SECONDS.*greater than or equal to 60/);
  });

  it('rejects transaction budgets that reintroduce Prisma defaults', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        PRISMA_TRANSACTION_MAX_WAIT_MS: 999,
        PRISMA_TRANSACTION_TIMEOUT_MS: 5_000,
      }),
    ).toThrow(
      /PRISMA_TRANSACTION_MAX_WAIT_MS.*greater than or equal to 1000.*PRISMA_TRANSACTION_TIMEOUT_MS.*greater than or equal to 5001/,
    );
  });

  it('reports all invalid required settings without their values', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'not-a-postgres-url',
        FRONTEND_URL: 'not-a-url',
        JWT_SECRET: 'short',
      }),
    ).toThrow(
      /Environment validation failed:.*DATABASE_URL.*DIRECT_URL.*JWT_SECRET.*FRONTEND_URL/,
    );
  });
});
