import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { UserRole } from '../../../config/constants';

// Filtres de GET /utilisateurs (tous optionnels, combinés en ET).
export class ListeUtilisateursDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  take?: number;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  // Personnel (agents, gestionnaires) rattaché à cette compagnie.
  @IsOptional()
  @IsInt()
  @IsPositive()
  compagnieId?: number;

  // Lu sur la valeur brute : la conversion implicite ferait de "false" un true.
  @IsOptional()
  @Transform(({ obj }) =>
    obj.actif === 'true' ? true : obj.actif === 'false' ? false : obj.actif,
  )
  @IsBoolean()
  actif?: boolean;

  // Nom, téléphone ou email (contient, insensible à la casse).
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(80)
  q?: string;
}
