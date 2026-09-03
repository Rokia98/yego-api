import { IsNumber, IsOptional, Min, IsPositive } from 'class-validator';

export class CreateRemboursementDto {
  @IsNumber()
  @IsPositive()
  reservationId: number;

  // montantRembourse n'est pas fourni par le client : il est recalculé côté
  // serveur à partir du montant réellement payé (voir RemboursementsService.create).
  @IsOptional()
  @IsNumber()
  @Min(0)
  fraisRetenus?: number;
}
