import { Transform } from 'class-transformer';
import {
  Allow,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { tipo_documento_luma } from '@prisma/client';
import { IsClientDocumentPair } from './client-document-pair.validator';

const trimNullable = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const normalizeDocumentType = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class UpdateClientDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trimNullable)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fullName?: string;

  @Transform(normalizeDocumentType)
  @IsClientDocumentPair(true, {
    message:
      'documentType and documentNumber must be provided together, or both must be null',
  })
  documentType?: tipo_documento_luma | null;

  @Transform(trimNullable)
  @Allow()
  documentNumber?: string | null;

  @IsOptional()
  @Transform(trimNullable)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Transform(trimNullable)
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @Transform(trimNullable)
  @IsString()
  @MaxLength(2_000)
  notes?: string | null;
}
