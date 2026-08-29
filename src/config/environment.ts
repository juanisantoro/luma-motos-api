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
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
  NODE_ENV: NodeEnvironment;
  PORT: number;
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
  SMTP_HOST: Joi.string().hostname().optional(),
  SMTP_PORT: Joi.number().port().optional(),
  SMTP_SECURE: Joi.boolean().optional(),
  SMTP_USER: Joi.string().max(254).optional(),
  SMTP_PASSWORD: Joi.string().min(1).optional(),
  SMTP_FROM_EMAIL: Joi.string().email().optional(),
  SMTP_FROM_NAME: Joi.string().max(120).optional(),
  FRONTEND_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  PORT: Joi.number().port().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
}).and(
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM_EMAIL',
  'SMTP_FROM_NAME',
);

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  try {
    return Joi.attempt(config, environmentSchema, {
      abortEarly: false,
      allowUnknown: true,
      convert: true,
      stripUnknown: true,
    });
  } catch (error: unknown) {
    if (!Joi.isError(error)) {
      throw error;
    }

    const details = error.details.map((detail) => detail.message).join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }
}
