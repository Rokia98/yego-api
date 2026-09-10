import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TelephoneNormalise } from '../../../common/decorators/telephone-normalise.decorator';

export class UpdateChauffeurDto {
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
  @IsString()
  @MaxLength(40)
  numeroPermis?: string;
}
