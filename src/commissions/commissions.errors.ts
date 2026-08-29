import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

function body(
  statusCode: number,
  error: string,
  code: string,
  message: string,
) {
  return { statusCode, error, code, message };
}

export function commissionBadRequest(code: string, message: string): never {
  throw new BadRequestException(body(400, 'Bad Request', code, message));
}

export function commissionConflict(code: string, message: string): never {
  throw new ConflictException(body(409, 'Conflict', code, message));
}

export function commissionNotFound(code: string, message: string): never {
  throw new NotFoundException(body(404, 'Not Found', code, message));
}
