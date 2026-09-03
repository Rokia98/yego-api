import { IsOptional, IsString, Matches } from 'class-validator';

export class GenererTicketDto {
  // Ex. « A1 », « 12 », « B14 ». Optionnel (placement libre à bord).
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{0,2}[0-9]{1,3}$/, {
    message: 'Siège invalide (ex. "A1", "12", "B14")',
  })
  siege?: string;
}
