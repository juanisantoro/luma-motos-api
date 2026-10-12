import { IsDateString, IsOptional, IsUUID, Matches } from 'class-validator';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class WorkMonthsQueryDto {
  @IsOptional() @IsUUID() organizationId?: string;
}

export class WorkMonthParamDto {
  @Matches(PERIOD, { message: 'El mes va como AAAA-MM.' }) period!: string;
}

export class SetWorkMonthCutDto {
  @IsOptional() @IsUUID() organizationId?: string;
  // Último día del mes de trabajo, AAAA-MM-DD.
  @IsDateString(
    { strict: true },
    { message: 'La fecha de corte va como AAAA-MM-DD.' },
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de corte va como AAAA-MM-DD.',
  })
  cutDate!: string;
}
