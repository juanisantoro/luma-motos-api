import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  direccion_caja_luma,
  tipo_cuenta_caja_luma,
  tipo_movimiento_caja_luma,
  tipo_vehiculo_luma,
} from '@prisma/client';

export enum FinancialPaymentStatus {
  PENDIENTE = 'PENDIENTE',
  PARCIAL = 'PARCIAL',
  PAGADO = 'PAGADO',
}

const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/;
const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export class FinancialPageDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class FinancialQueryDto extends FinancialPageDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsDateString() @Matches(BUSINESS_DATE_PATTERN) from?: string;
  @IsOptional() @IsDateString() @Matches(BUSINESS_DATE_PATTERN) to?: string;
  @IsOptional() @IsEnum(FinancialPaymentStatus) status?: FinancialPaymentStatus;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
}

export class SupplierPurchaseQueryDto extends FinancialQueryDto {
  @IsOptional() @IsEnum(tipo_vehiculo_luma) vehicleType?: tipo_vehiculo_luma;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsUUID() versionId?: string;
}

export class IncomeQueryDto extends FinancialQueryDto {
  @IsOptional() @IsEnum(tipo_vehiculo_luma) vehicleType?: tipo_vehiculo_luma;
  @IsOptional() @IsString() @MaxLength(120) type?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsUUID() operationId?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsUUID() collectorId?: string;
}

export class ExpenseQueryDto extends FinancialQueryDto {
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  recoverable?: boolean;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  recovered?: boolean;
}

export class CreateSupplierPurchaseDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsUUID() branchId!: string;
  @IsDateString() @Matches(BUSINESS_DATE_PATTERN) purchaseDate!: string;
  @IsUUID() supplierId!: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsUUID() versionId?: string;
  @IsOptional() @IsString() @MaxLength(120) documentNumber?: string;
  @IsString() @Matches(MONEY_PATTERN) baseAmount!: string;
  @IsOptional() @IsString() @Matches(MONEY_PATTERN) additionalCosts?: string;
  @IsOptional() @IsString() @Matches(CURRENCY_PATTERN) currency?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateSupplierPurchaseDto {
  @IsOptional()
  @IsDateString()
  @Matches(BUSINESS_DATE_PATTERN)
  purchaseDate?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsUUID() unitId?: string | null;
  @IsOptional() @IsUUID() versionId?: string;
  @IsOptional() @IsString() @MaxLength(120) documentNumber?: string | null;
  @IsOptional() @IsString() @Matches(MONEY_PATTERN) baseAmount?: string;
  @IsOptional() @IsString() @Matches(MONEY_PATTERN) additionalCosts?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class CreateIncomeDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsUUID() branchId!: string;
  @IsDateString() @Matches(BUSINESS_DATE_PATTERN) incomeDate!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) type!: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsUUID() operationId?: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;
  @IsString() @Matches(MONEY_PATTERN) totalAmount!: string;
  @IsOptional() @IsString() @Matches(CURRENCY_PATTERN) currency?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateIncomeDto {
  @IsOptional()
  @IsDateString()
  @Matches(BUSINESS_DATE_PATTERN)
  incomeDate?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) type?: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string | null;
  @IsOptional() @IsUUID() unitId?: string | null;
  @IsOptional() @IsUUID() operationId?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @Matches(MONEY_PATTERN) totalAmount?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class CreateExpenseDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsDateString() @Matches(BUSINESS_DATE_PATTERN) expenseDate!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) category!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) reference!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;
  @IsString() @Matches(MONEY_PATTERN) totalAmount!: string;
  @IsString() @IsNotEmpty() @MaxLength(180) paidBy!: string;
  @IsEnum(FinancialPaymentStatus) status!: FinancialPaymentStatus;
  @IsBoolean() recovered!: boolean;
  @Type(() => Number) @IsInt() @Min(1) @Max(12) month!: number;
  @Type(() => Number) @IsInt() @Min(2000) @Max(2200) year!: number;
  @IsOptional() @IsString() @Matches(CURRENCY_PATTERN) currency?: string;
  @IsOptional() @IsBoolean() recoverable?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsDateString()
  @Matches(BUSINESS_DATE_PATTERN)
  expenseDate?: string;
  @IsOptional() @IsUUID() branchId?: string | null;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) category?: string;
  @ValidateIf((_input, value: unknown) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  reference?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @Matches(MONEY_PATTERN) totalAmount?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(180) paidBy?: string;
  @IsOptional() @IsBoolean() recovered?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;
  @IsOptional() @IsBoolean() recoverable?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class RegisterFinancialMovementDto {
  @IsUUID() idempotencyKey!: string;
  @IsUUID() accountId!: string;
  @IsString() @Matches(MONEY_PATTERN) amount!: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class ReverseFinancialMovementDto {
  @IsUUID() idempotencyKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}

export class CashAccountQueryDto extends FinancialPageDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsEnum(tipo_cuenta_caja_luma) type?: tipo_cuenta_caja_luma;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() @MaxLength(140) search?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}

export class CreateCashAccountDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsString() @IsNotEmpty() @MaxLength(40) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(140) name!: string;
  @IsEnum(tipo_cuenta_caja_luma) type!: tipo_cuenta_caja_luma;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() responsiblePersonnelId?: string;
  @IsOptional() @IsString() @Matches(CURRENCY_PATTERN) currency?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateCashAccountDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(140) name?: string;
  @IsOptional() @IsEnum(tipo_cuenta_caja_luma) type?: tipo_cuenta_caja_luma;
  @IsOptional() @IsUUID() branchId?: string | null;
  @IsOptional() @IsUUID() responsiblePersonnelId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CashMovementQueryDto extends FinancialPageDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional()
  @IsEnum(tipo_movimiento_caja_luma)
  type?: tipo_movimiento_caja_luma;
  @IsOptional() @IsEnum(direccion_caja_luma) direction?: direccion_caja_luma;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
}

export class CashTransferQueryDto extends FinancialPageDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class CreateCashTransferDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsUUID() idempotencyKey!: string;
  @IsUUID() sourceAccountId!: string;
  @IsUUID() destinationAccountId!: string;
  @IsString() @Matches(MONEY_PATTERN) amount!: string;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsString() @MaxLength(160) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
