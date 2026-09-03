import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Filtre global : normalise toutes les erreurs vers un format JSON unique.
 * - HttpException : statut + message tels quels.
 * - Erreurs portant un `status`/`statusCode` (ex. body-parser 413, erreurs
 *   Prisma décorées) : ce statut est respecté.
 * - Tout le reste : 500, message générique, détails loggués côté serveur.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Erreur interne du serveur';
    let details: unknown = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || message;
        details = (exceptionResponse as any).error || null;
      } else {
        message = exceptionResponse as string;
      }
    } else if (exception instanceof Error) {
      const err = exception as Error & {
        status?: number;
        statusCode?: number;
        type?: string;
      };
      const httpStatus = Number(err.status ?? err.statusCode);

      if (err.type === 'entity.too.large') {
        status = HttpStatus.PAYLOAD_TOO_LARGE;
        message = 'Corps de requête trop volumineux';
      } else if (
        Number.isInteger(httpStatus) &&
        httpStatus >= 400 &&
        httpStatus < 500
      ) {
        status = httpStatus;
        message = err.message;
      } else {
        // Erreur inattendue : ne jamais divulguer le détail au client.
        this.logger.error(`Erreur non gérée : ${err.message}`, err.stack);
      }
    } else {
      this.logger.error('Erreur inconnue', exception as any);
    }

    response.status(status).json({
      statusCode: status,
      message,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
    });
  }
}
