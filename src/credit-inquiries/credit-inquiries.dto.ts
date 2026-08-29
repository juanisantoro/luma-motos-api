import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { resultado_crediticio_luma, tipo_documento_luma } from '@prisma/client';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const boolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class RejectedInquiryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  search?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  document?: string;

  @IsOptional()
  @IsUUID()
  financialEntityId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  registeredById?: string;
}

export class CreditHistoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(resultado_crediticio_luma)
  outcome?: resultado_crediticio_luma;
}

export class VerifyDocumentQueryDto {
  @Transform(upper)
  @IsEnum(tipo_documento_luma)
  documentType!: tipo_documento_luma;

  @Transform(trim)
  @IsString()
  @Matches(/^(?=.*[A-Za-z0-9])[A-Za-z0-9 .-]{5,30}$/)
  documentNumber!: string;
}

export class CreateCreditInquiryDto extends VerifyDocumentQueryDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fullName!: string;

  @IsUUID()
  financialEntityId!: string;

  @IsEnum(resultado_crediticio_luma)
  outcome!: resultado_crediticio_luma;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  reason?: string;

  @IsDateString()
  consultedAt!: string;

  @IsOptional()
  @IsUUID()
  registeredById?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  operationId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  externalReference?: string;
}

export class ReferenceListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  search?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class FinancialInstitutionListQueryDto extends ReferenceListQueryDto {
  @IsOptional()
  @Transform(boolean)
  @IsBoolean()
  active = true;
}

export class CreateFinancialInstitutionDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^(?=.*[A-Za-z0-9])[A-Za-z0-9 .-]{5,30}$/)
  taxId?: string;
}
