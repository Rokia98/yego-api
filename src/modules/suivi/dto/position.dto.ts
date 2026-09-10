import { IsDateString, IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class PositionDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  // km/h
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(250)
  vitesse?: number;

  // degrés, 0 = nord
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  cap?: number;

  // précision GPS annoncée, en mètres
  @IsOptional()
  @IsNumber()
  @Min(0)
  precision?: number;

  // horodatage de la mesure sur l'appareil ; par défaut = maintenant
  @IsOptional()
  @IsDateString()
  mesureA?: string;
}
