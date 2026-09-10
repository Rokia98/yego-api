import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Taille maximale de l'image décodée (data-URI). ~40 Ko laisse la place à un
// logo raisonnable sans peser sur la limite de corps de requête (100 Ko).
const TAILLE_MAX_OCTETS = 40 * 1024;

const DATA_URI_IMAGE =
  /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function tailleBase64Octets(base64: string): number {
  const padding = /=*$/.exec(base64)?.[0].length ?? 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

@ValidatorConstraint({ name: 'estLogoValide', async: false })
export class EstLogoValideConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null || value === '') return true;
    if (typeof value !== 'string') return false;

    // URL http(s) : on se contente d'une forme plausible et d'une longueur raisonnable.
    if (/^https?:\/\/\S+$/i.test(value)) return value.length <= 2048;

    const m = DATA_URI_IMAGE.exec(value);
    if (!m) return false;
    return tailleBase64Octets(m[2]) <= TAILLE_MAX_OCTETS;
  }

  defaultMessage(): string {
    return 'logoUrl doit être une URL http(s), ou un data:image/(png|jpeg|webp);base64 de moins de 40 Ko décodé';
  }
}

export function EstLogoValide(options?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: EstLogoValideConstraint,
    });
  };
}
