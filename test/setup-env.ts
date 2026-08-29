process.env.DATABASE_URL =
  'postgresql://test:test@pooler.example.neon.tech/luma';
process.env.DIRECT_URL = 'postgresql://test:test@example.neon.tech/luma';
process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-characters';
process.env.JWT_SESSION_IDLE_TIMEOUT_SECONDS = '3600';
process.env.PRISMA_TRANSACTION_MAX_WAIT_MS = '10000';
process.env.PRISMA_TRANSACTION_TIMEOUT_MS = '30000';
process.env.USER_TEMPORARY_PASSWORD_TTL_SECONDS = '86400';
process.env.SMTP_HOST = 'smtp-relay.brevo.com';
process.env.SMTP_PORT = '587';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USER = 'test-smtp-user';
process.env.SMTP_PASSWORD = 'test-smtp-password';
process.env.SMTP_FROM_EMAIL = 'noreply@luma.test.com';
process.env.SMTP_FROM_NAME = 'Luma Motos Test';
process.env.FRONTEND_URL = 'http://localhost:3001';
process.env.NODE_ENV = 'test';
