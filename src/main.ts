import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpErrorLogFilter } from './common/http-error-log.filter';
import { EnvironmentVariables } from './config/environment';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  // This API serves per-tenant, frequently-changing JSON. Express's default
  // ETag generation makes the browser revalidate identical GETs and can get a
  // 304 back; some clients then choke trying to read a body-less response.
  // Disable it so every response is served fresh.
  app.set('etag', false);

  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    app.set('trust proxy', 1);
  }
  app.setGlobalPrefix('api');

  // Catalog photos are served as plain static files (they are not sensitive
  // data) from outside the 'api' prefix, at /uploads/catalog/<file>. The
  // directory must exist before Express starts serving from it.
  const catalogUploadsDir = resolve(
    config.get('CATALOG_UPLOADS_DIR', { infer: true }),
  );
  if (!existsSync(catalogUploadsDir)) {
    mkdirSync(catalogUploadsDir, { recursive: true });
  }
  app.useStaticAssets(catalogUploadsDir, { prefix: '/uploads/catalog/' });

  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  // Cada pedido rechazado queda en el log ("api-error") para revisarlo.
  app.useGlobalFilters(
    new HttpErrorLogFilter(app.get(HttpAdapterHost).httpAdapter),
  );
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  Logger.log(`Luma Motos API listening on port ${port}`, 'Bootstrap');
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown application error';
  Logger.error(message, 'Bootstrap');
  process.exitCode = 1;
});
