import { IsIn } from 'class-validator';
import { CompagnieDocumentType } from '../../../config/constants';

export class UploadDocumentDto {
  @IsIn(Object.values(CompagnieDocumentType))
  type: string;
}
