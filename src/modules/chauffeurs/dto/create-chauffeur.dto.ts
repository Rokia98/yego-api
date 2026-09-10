import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TelephoneNormalise } from '../../../common/decorators/telephone-normalise.decorator';

export class CreateChauffeurDto {
  // Ignoré pour un agent/company_admin (forcé à leur compagnie) ;
  // requis pour l'admin plateforme.
  @IsOptional()
  @IsInt()
  @IsPositive()
  compagnieId?: number;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(120)
  nom: string;

  @IsOptional()
  @IsString()
  @TelephoneNormalise()
  telephone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  numeroPermis?: string;
}
