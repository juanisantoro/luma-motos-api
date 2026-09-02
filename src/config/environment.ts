import * as Joi from 'joi';

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface EnvironmentVariables {
  DATABASE_URL: string;
  DIRECT_URL: string;
  FRONTEND_URL: string;
  JWT_SECRET: string;
  JWT_SESSION_IDLE_TIMEOUT_SECONDS: number;
  PRISMA_TRANSACTION_MAX_WAIT_MS: number;
  PRISMA_TRANSACTION_TIMEOUT_MS: number;
  USER_TEMPORARY_PASSWORD_TTL_SECONDS: number;
  BREVO_API_KEY?: string;
  BREVO_API_TIMEOUT_MS: number;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
  NODE_ENV: NodeEnvironment;
  PORT: number;
  CATALOG_UPLOADS_DIR: string;
  CATALOG_PHOTO_MAX_BYTES: number;
}

const environmentSchema = Joi.object<EnvironmentVariables>({
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  DIRECT_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_SESSION_IDLE_TIMEOUT_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(604_800)
    .default(3_600),
  PRISMA_TRANSACTION_MAX_WAIT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  PRISMA_TRANSACTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(5_001)
    .max(120_000)
    .default(30_000),
  USER_TEMPORARY_PASSWORD_TTL_SECONDS: Joi.number()
    .integer()
    .min(900)
    .max(604_800)
    .default(86_400),
  BREVO_API_KEY: Joi.string().min(1).optional(),
  BREVO_API_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  SMTP_HOST: Joi.string().hostname().optional(),
  SMTP_PORT: Joi.number().port().optional(),
  SMTP_SECURE: Joi.boolean().optional(),
  SMTP_USER: Joi.string().max(254).optional(),
  SMTP_PASSWORD: Joi.string().min(1).optional(),
  SMTP_FROM_EMAIL: Joi.string().email().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  SMTP_FROM_NAME: Joi.string().max(120).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  FRONTEND_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  PORT: Joi.number().port().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  // Local folder where uploaded catalog photos are written and served from.
  // On Render this must point inside the mounted Persistent Disk (e.g.
  // /var/data/uploads/catalog) - the default is only safe for local
  // development, since a regular Render web service wipes its filesystem on
  // every deploy/restart.
  CATALOG_UPLOADS_DIR: Joi.string().default('./uploads/catalog'),
  CATALOG_PHOTO_MAX_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(5 * 1024 * 1024),
})
  .and('SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD')
  .with('SMTP_HOST', ['SMTP_FROM_EMAIL', 'SMTP_FROM_NAME'])
  .with('BREVO_API_KEY', ['SMTP_FROM_EMAIL', 'SMTP_FROM_NAME']);

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  try {
    const environment = Joi.attempt(config, environmentSchema, {
      abortEarly: false,
      allowUnknown: true,
      convert: true,
      stripUnknown: true,
    });
    if (
      environment.NODE_ENV === 'production' &&
      !environment.BREVO_API_KEY &&
      !environment.SMTP_HOST
    ) {
      throw new Error(
        'Environment validation failed: production email delivery requires BREVO_API_KEY or SMTP_HOST',
      );
    }
    return environment;
  } catch (error: unknown) {
    if (!Joi.isError(error)) {
      throw error;
    }

    const details = error.details.map((detail) => detail.message).join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }
}
