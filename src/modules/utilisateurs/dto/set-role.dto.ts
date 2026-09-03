import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { UserRole } from '../../../config/constants';

export class SetRoleDto {
  @IsEnum(UserRole)
  role: UserRole;

  // Requis pour les rôles 'agent' et 'company_admin' ; ignoré sinon.
  @IsOptional()
  @IsInt()
  @IsPositive()
  compagnieId?: number;
}
