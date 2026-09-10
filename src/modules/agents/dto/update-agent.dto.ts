import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TelephoneNormalise } from '../../../common/decorators/telephone-normalise.decorator';

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(120)
  nom?: string;

  @IsOptional()
  @IsString()
  @TelephoneNormalise()
  telephone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  motDePasse?: string;

  // false = désactive le compte (déconnexion immédiate).
  @IsOptional()
  @IsBoolean()
  actif?: boolean;
}
