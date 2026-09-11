import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CompagnieDocumentStatut } from '../../../config/constants';

// La revue ne remet jamais un document 'en_attente' : c'est l'état initial,
// pas une décision. L'admin valide ou refuse.
export class RevueDocumentDto {
  @IsIn([CompagnieDocumentStatut.VALIDE, CompagnieDocumentStatut.REFUSE])
  statut: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  commentaireAdmin?: string;
}
