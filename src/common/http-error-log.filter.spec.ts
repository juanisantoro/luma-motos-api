import { BadRequestException, HttpStatus } from '@nestjs/common';
import { apiError } from './api-error';
import { errorLogEntry, redact } from './http-error-log.filter';

describe('Registro de pedidos rechazados', () => {
  const request = {
    method: 'POST',
    originalUrl: '/api/sales/operations',
    body: {
      agreedPrice: 6400000,
      creditAmount: 6400000,
      password: 'secreto',
      client: { fullName: 'Ana Cliente' },
    },
    user: {
      sessionId: 's',
      user: {
        id: 'u1',
        email: 'vendedor@luma.com',
        role: { code: 'VENDEDOR' },
        organization: { code: 'LUMA' },
        branch: { name: 'San Miguel' },
      },
    },
  } as unknown as Parameters<typeof errorLogEntry>[1];

  it('guarda quién, qué mandó y por qué falló', () => {
    const entry = errorLogEntry(
      new BadRequestException('Credit amount cannot exceed the agreed price'),
      request,
    );

    expect(entry).toMatchObject({
      status: 400,
      method: 'POST',
      path: '/api/sales/operations',
      message: 'Credit amount cannot exceed the agreed price',
      user: {
        email: 'vendedor@luma.com',
        role: 'VENDEDOR',
        branch: 'San Miguel',
      },
      body: {
        agreedPrice: 6400000,
        password: '[oculto]',
        client: { fullName: 'Ana Cliente' },
      },
    });
  });

  it('incluye el código de error de la API', () => {
    const entry = errorLogEntry(
      apiError(
        HttpStatus.BAD_REQUEST,
        'GUARANTOR_REQUIRED',
        'Guarantor required',
      ),
      request,
    );
    expect(entry.code).toBe('GUARANTOR_REQUIRED');
  });

  it('registra los errores inesperados como 500', () => {
    const entry = errorLogEntry(new Error('boom'), {
      method: 'GET',
      url: '/api/x',
    });
    expect(entry).toMatchObject({ status: 500, message: 'boom', user: null });
    expect(entry.body).toBeUndefined();
  });

  it('acorta textos largos y oculta credenciales anidadas', () => {
    expect(
      redact({ a: 'x'.repeat(400), nested: { accessToken: 't' } }),
    ).toEqual({
      a: `${'x'.repeat(300)}…`,
      nested: { accessToken: '[oculto]' },
    });
  });
});
