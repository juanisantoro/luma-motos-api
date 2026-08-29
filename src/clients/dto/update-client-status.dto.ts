import { IsBoolean } from 'class-validator';

export class UpdateClientStatusDto {
  @IsBoolean()
  active!: boolean;
}
