import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @MaxLength(16)
  telephone: string;

  @IsString()
  @MaxLength(72)
  motDePasse: string;
}
