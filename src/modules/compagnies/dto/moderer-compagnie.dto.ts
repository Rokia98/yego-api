import { IsIn } from 'class-validator';

export const STATUTS_COMPAGNIE = ['en_attente', 'actif', 'suspendu'] as const;

export class ModererCompagnieDto {
  @IsIn(STATUTS_COMPAGNIE)
  statut: (typeof STATUTS_COMPAGNIE)[number];
}
