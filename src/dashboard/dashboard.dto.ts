import { IsIn, IsOptional } from 'class-validator';
import { DASHBOARD_MONTHS, type DashboardMonth } from './dashboard.service';

export class DashboardHomeQueryDto {
  // Mes de los números del inicio del ADMINISTRADOR: el actual o el anterior.
  @IsOptional() @IsIn(DASHBOARD_MONTHS) month?: DashboardMonth;
}
