import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class EnregistrerAppareilDto {
  // Jeton d'enregistrement FCM fourni par le SDK client.
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token: string;

  @IsIn(['android', 'ios', 'web'])
  plateforme: 'android' | 'ios' | 'web';
}
