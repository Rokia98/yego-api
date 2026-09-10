import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ScanHorsLigneDto {
  @IsString()
  @MaxLength(400)
  codeQr: string;

  // Horodatage du scan sur l'appareil du contrôleur (hors-ligne).
  @IsOptional()
  @IsDateString()
  scanneA?: string;

  // Verdict rendu localement par l'app (valide / deja_utilise / …), à titre
  // indicatif — le serveur reste l'autorité.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  resultatLocal?: string;
}

export class SyncValidationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ScanHorsLigneDto)
  scans: ScanHorsLigneDto[];
}
