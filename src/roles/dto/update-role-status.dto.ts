import { Type } from 'class-transformer';
import { IsBoolean, IsInt, Min } from 'class-validator';

export class UpdateRoleStatusDto {
  @IsBoolean()
  active!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
