import { IsString, MaxLength } from 'class-validator';
import { TelephoneNormalise } from '../../../common/decorators/telephone-normalise.decorator';

export class LoginDto {
  @IsString()
  @TelephoneNormalise()
  telephone: string;

  @IsString()
  @MaxLength(72)
  motDePasse: string;
}
