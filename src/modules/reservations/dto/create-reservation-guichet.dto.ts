import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const TELEPHONE_REGEX = /^\+?[0-9]{8,15}$/;

// Le voyageur au guichet n'a pas de compte : on note seulement son identité
// sur la réservation (liste des passagers).
class PassagerGuichetDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(120)
  nom: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @Matches(TELEPHONE_REGEX, {
    message: 'Numéro de téléphone invalide (8 à 15 chiffres, "+" optionnel)',
  })
  telephone?: string;
}

export class CreateReservationGuichetDto {
  @IsInt()
  @IsPositive()
  departId: number;

  @IsInt()
  @Min(1)
  nombrePlaces: number;

  @ValidateNested()
  @Type(() => PassagerGuichetDto)
  passager: PassagerGuichetDto;

  // true = l'agent encaisse le montant en espèces au guichet : un paiement
  // 'espece' au statut 'paye' est créé dans la même transaction.
  @IsOptional()
  @IsBoolean()
  paiementEspece?: boolean;
}
