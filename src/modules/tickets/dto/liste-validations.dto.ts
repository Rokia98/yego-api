import { IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

// Filtres de GET /tickets/validations (tous optionnels).
export class ListeValidationsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  take?: number;

  // 'refuse' = tout résultat autre que 'valide' (déjà utilisé, annulé,
  // hors compagnie, signature invalide…).
  @IsOptional()
  @IsIn(['valide', 'refuse'])
  resultat?: 'valide' | 'refuse';

  // Bornes incluses sur la date du scan (YYYY-MM-DD, UTC).
  @IsOptional()
  @Matches(JOUR, { message: 'du doit être au format YYYY-MM-DD' })
  du?: string;

  @IsOptional()
  @Matches(JOUR, { message: 'au doit être au format YYYY-MM-DD' })
  au?: string;
}
