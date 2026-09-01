import { randomUUID } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { BadRequestException, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { EnvironmentVariables } from '../config/environment';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

const ALLOWED_PHOTO_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Module({
  imports: [
    MulterModule.registerAsync({
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        storage: diskStorage({
          destination: resolve(
            config.get('CATALOG_UPLOADS_DIR', { infer: true }),
          ),
          filename: (_request, file, callback) => {
            const extension =
              ALLOWED_PHOTO_EXTENSIONS[file.mimetype] ??
              extname(file.originalname).toLowerCase();
            callback(null, `${randomUUID()}${extension}`);
          },
        }),
        limits: {
          fileSize: config.get('CATALOG_PHOTO_MAX_BYTES', { infer: true }),
        },
        fileFilter: (_request, file, callback) => {
          if (!ALLOWED_PHOTO_EXTENSIONS[file.mimetype]) {
            callback(
              new BadRequestException(
                'Only JPEG, PNG or WEBP photos are allowed',
              ),
              false,
            );
            return;
          }
          callback(null, true);
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
