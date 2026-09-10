import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';
import {
  normaliserTelephone,
  TELEPHONE_E164_REGEX,
} from '../telephone';

/**
 * À poser sur tout champ `telephone` d'un DTO : normalise la saisie en E.164
 * (`+225XXXXXXXXXX`) puis valide la forme. Pour un champ optionnel, ajouter
 * `@IsOptional()` à côté.
 */
export function TelephoneNormalise(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }) => normaliserTelephone(value)),
    Matches(TELEPHONE_E164_REGEX, {
      message:
        'Numéro de téléphone invalide (ex. 0701020304 ou +2250701020304)',
    }),
  );
}
