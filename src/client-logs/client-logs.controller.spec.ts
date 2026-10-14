import type { AuthenticatedUser } from '../auth/auth.types';
import { ClientLogsController, clientLogEntry } from './client-logs.controller';

describe('Registro de validaciones de pantalla', () => {
  const actor = {
    id: 'u1',
    email: 'vendedor@luma.com',
    role: { code: 'VENDEDOR' },
    organization: { code: 'LUMA' },
    branch: { name: 'San Miguel' },
  } as unknown as AuthenticatedUser;

  it('arma la línea con la pantalla, los mensajes, los datos y el usuario', () => {
    expect(
      clientLogEntry(
        {
          kind: 'VALIDATION',
          screen: 'Nueva operación',
          messages: {
            creditAmount: 'El crédito no puede superar el precio de cierre.',
          },
          data: {
            agreedPrice: 6320000,
            creditAmount: 6400000,
            accessToken: 'x',
          },
        },
        actor,
      ),
    ).toEqual({
      kind: 'VALIDATION',
      screen: 'Nueva operación',
      messages: {
        creditAmount: 'El crédito no puede superar el precio de cierre.',
      },
      data: {
        agreedPrice: 6320000,
        creditAmount: 6400000,
        accessToken: '[oculto]',
      },
      user: {
        id: 'u1',
        email: 'vendedor@luma.com',
        role: 'VENDEDOR',
        organization: 'LUMA',
        branch: 'San Miguel',
      },
    });
  });

  it('escribe la línea en el log', () => {
    const controller = new ClientLogsController();
    const warn = jest
      .spyOn(
        (controller as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    controller.create(
      { kind: 'VALIDATION', screen: 'Nueva operación', messages: {} },
      actor,
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^ui-validation \{/),
    );
  });
});
