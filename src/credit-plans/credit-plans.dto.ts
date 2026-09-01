import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { metodo_calculo_credito_luma } from '@prisma/client';

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const CREDIT_INSTALLMENT_STATUSES = [
  'PENDIENTE',
  'PAGADA',
  'VENCIDA',
  'PARCIAL',
] as const;
export type CreditInstallmentStatus =
  (typeof CREDIT_INSTALLMENT_STATUSES)[number];

function parseOptionalBoolean({ value }: { value: unknown }) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class CreditPlanQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional()
  @Transform(parseOptionalBoolean)
  @IsBoolean()
  active?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CreateCreditPlanDto {
  @IsString() @MaxLength(160) name!: string;
  @IsEnum(metodo_calculo_credito_luma) calculationMethod!: metodo_calculo_credito_luma;
  @Type(() => Number) @IsInt() @Min(1) @Max(360) installmentCount!: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  interestRate!: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumAmount?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumAmount?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class UpdateCreditPlanDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional()
  @IsEnum(metodo_calculo_credito_luma)
  calculationMethod?: metodo_calculo_credito_luma;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(360) installmentCount?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  interestRate?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumAmount?: number | null;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maximumAmount?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ConfirmOperationCreditDto {
  @IsUUID() planId!: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  financedAmount!: number;
  @IsDateString() @Matches(BUSINESS_DATE_PATTERN) firstDueDate!: string;
}

export class PayCreditInstallmentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
  @IsDateString() @Matches(BUSINESS_DATE_PATTERN) paymentDate!: string;
}

export class CreditInstallmentQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsIn(CREDIT_INSTALLMENT_STATUSES) status?: CreditInstallmentStatus;
  @IsOptional() @IsUUID() operationId?: string;
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}
