import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export const REMINDER_STAGES = ['PRIMER_SERVICE', 'ANUAL'] as const;
export type ReminderStage = (typeof REMINDER_STAGES)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ServiceRemindersQueryDto {
  // PENDING: los que hay que contactar. RESOLVED: los ya contactados o
  // descartados, para revisar o deshacer.
  @IsOptional() @IsIn(['PENDING', 'RESOLVED']) status?: 'PENDING' | 'RESOLVED';
  @IsOptional() @IsUUID() branchId?: string;
}

/** Identifica un aviso: la moto, qué service le toca y para qué día. */
export class ServiceReminderKeyDto {
  @IsUUID() unitId!: string;
  @IsIn(REMINDER_STAGES) stage!: ReminderStage;
  @Matches(DAY, { message: 'La fecha va como AAAA-MM-DD.' }) dueDate!: string;
}

export class ResolveServiceReminderDto extends ServiceReminderKeyDto {
  @IsIn(['CONTACTADO', 'DESCARTADO']) status!: 'CONTACTADO' | 'DESCARTADO';
  @IsOptional()
  @IsIn(['WHATSAPP', 'TELEFONO', 'OTRO'])
  channel?: 'WHATSAPP' | 'TELEFONO' | 'OTRO';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
