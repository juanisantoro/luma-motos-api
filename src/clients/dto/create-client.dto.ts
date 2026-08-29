import { Transform } from 'class-transformer';
import {
  Allow,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { tipo_documento_luma } from '@prisma/client';
import { IsClientDocumentPair } from './client-document-pair.validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const normalizeDocumentType = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateClientDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fullName!: string;

  @Transform(normalizeDocumentType)
  @IsClientDocumentPair(false, {
    message:
      'documentType and documentNumber must be provided together and be valid',
  })
  documentType?: tipo_documento_luma;

  @Transform(trim)
  @Allow()
  documentNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2_000)
  notes?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
