import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { tipo_vehiculo_luma } from '@prisma/client';

const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export enum CommissionPolicyStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// Separates the vendor scale catalog from the exclusive manager (GERENTE)
// scale catalog on the same politicas_comisiones/escalas_comisiones table.
// Kept as literal Spanish values (matching ambito_politica_comision_luma in
// the DB) rather than translated, same convention already used for
// ManagerCommissionMode/ManagerCommissionScope elsewhere in this file.
export enum CommissionPolicyAmbito {
  VENDEDOR = 'VENDEDOR',
  GERENCIA = 'GERENCIA',
}

export enum CommissionSettlementStatus {
  CALCULATED = 'CALCULATED',
  AGREED = 'AGREED',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
}

export class CommissionPageDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class CommissionSuggestionQueryDto extends CommissionPageDto {
  @IsString() @Matches(PERIOD_PATTERN) period!: string;
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minComputableSales?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxComputableSales?: number;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CommissionSettlementQueryDto extends CommissionPageDto {
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional()
  @IsEnum(CommissionSettlementStatus)
  status?: CommissionSettlementStatus;
  @IsOptional() @IsString() @Matches(PERIOD_PATTERN) period?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CommissionHistoryQueryDto extends CommissionPageDto {
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional() @IsUUID() sellerId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional()
  @IsDateString()
  @Matches(BUSINESS_DATE_PATTERN)
  paidFrom?: string;
  @IsOptional() @IsDateString() @Matches(BUSINESS_DATE_PATTERN) paidTo?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CommissionMeQueryDto extends CommissionPageDto {
  @IsString() @Matches(PERIOD_PATTERN) period!: string;
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  historyYear?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  historyMonth?: number;
}

export class CommissionPolicyQueryDto extends CommissionPageDto {
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional() @IsEnum(CommissionPolicyStatus) status?: CommissionPolicyStatus;
  @IsOptional() @IsEnum(CommissionPolicyAmbito) ambito?: CommissionPolicyAmbito;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CommissionTierDto {
  @Type(() => Number) @IsInt() @Min(1) minUnits!: number;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === null ? null : value))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUnits!: number | null;
  @IsString() @Matches(MONEY_PATTERN) fixedAmount!: string;
}

export class CreateCommissionPolicyDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  // Optional, defaults to VENDEDOR when omitted (see commissions.service.ts)
  // so every existing caller that never sends this keeps creating vendor
  // policies exactly as before.
  @IsOptional() @IsEnum(CommissionPolicyAmbito) ambito?: CommissionPolicyAmbito;
  @IsString() @Matches(CURRENCY_PATTERN) currency!: string;
  @IsDateString() @Matches(BUSINESS_DATE_PATTERN) validFrom!: string;
  @IsOptional()
  @IsDateString()
  @Matches(BUSINESS_DATE_PATTERN)
  validTo?: string;
  @IsEnum(CommissionPolicyStatus) status!: CommissionPolicyStatus;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CommissionTierDto)
  tiers!: CommissionTierDto[];
}

export class UpdateCommissionPolicyDto extends CreateCommissionPolicyDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
}

export class VersionedCommissionPolicyDto {
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
}

export class CommissionAgreementDto {
  @IsString() @Matches(MONEY_PATTERN) agreedAmount!: string;
  @IsDateString() @Matches(BUSINESS_DATE_PATTERN) meetingDate!: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

export class PayCommissionDto {
  @IsUUID() idempotencyKey!: string;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsUUID() accountId!: string;
  @IsDateString() paidAt!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) reference!: string;
  @IsOptional() @IsString() @MaxLength(240) receipt?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

// Manager (GERENTE) commission configuration - additive and separate from
// the vendor scale/agreement/payment flow above.

export enum ManagerCommissionMode {
  PORCENTAJE = 'PORCENTAJE',
  ESCALA = 'ESCALA',
}

export enum ManagerCommissionScope {
  SUCURSAL_PROPIA = 'SUCURSAL_PROPIA',
  TODAS_LAS_SUCURSALES = 'TODAS_LAS_SUCURSALES',
}

const PERCENTAGE_PATTERN = /^(100|[1-9]?\d)(\.\d{1,2})?$/;

export class SaveManagerCommissionConfigDto {
  @IsEnum(ManagerCommissionMode) mode!: ManagerCommissionMode;
  @IsOptional() @IsString() @Matches(PERCENTAGE_PATTERN) percentage?: string;
  @IsOptional() @IsUUID() policyId?: string;
  @IsEnum(ManagerCommissionScope) scope!: ManagerCommissionScope;
  @IsOptional() @IsBoolean() active?: boolean;
}

// Manager (GERENTE) commission settlements - agree/pay flow, mirroring the
// vendor suggestion/settlement/history shape above but persisted in its own
// table (liquidaciones_comisiones_gerente), never in liquidaciones_comisiones.

export enum ManagerCommissionSettlementStatus {
  SUGGESTED = 'SUGGESTED',
  AGREED = 'AGREED',
  PAID = 'PAID',
}

export class ManagerCommissionSuggestionQueryDto extends CommissionPageDto {
  @IsString() @Matches(PERIOD_PATTERN) period!: string;
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class ManagerCommissionSettlementQueryDto extends CommissionPageDto {
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional()
  @IsEnum(ManagerCommissionSettlementStatus)
  status?: ManagerCommissionSettlementStatus;
  @IsOptional() @IsString() @Matches(PERIOD_PATTERN) period?: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class ManagerCommissionHistoryQueryDto extends CommissionPageDto {
  @IsEnum(tipo_vehiculo_luma) vehicleType!: tipo_vehiculo_luma;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional()
  @IsDateString()
  @Matches(BUSINESS_DATE_PATTERN)
  paidFrom?: string;
  @IsOptional() @IsDateString() @Matches(BUSINESS_DATE_PATTERN) paidTo?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class AgreeManagerCommissionDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

export class PayManagerCommissionDto {
  @IsDateString() paidAt!: string;
  @Type(() => Number) @IsInt() @Min(0) expectedVersion!: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
