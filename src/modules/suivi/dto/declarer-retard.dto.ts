import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class DeclarerRetardDto {
  @IsInt()
  @Min(1)
  @Max(1440)
  minutesRetard: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motif?: string;
}
