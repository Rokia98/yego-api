import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'isPublic';

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
