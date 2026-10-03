import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EnvironmentVariables } from '../config/environment';
import type { PrismaService } from '../prisma/prisma.service';
import type { AssistantToolsService } from './assistant.tools';
import {
  ASSISTANT_NOT_COVERED_PREFIX,
  AssistantService,
  manualVersion,
  normalizeQuestion,
} from './assistant.service';

function actor(roleCode: string): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'lucia@example.com',
    name: 'Lucía',
    active: true,
    globalAccess: false,
    organization: {
      id: 'org-1',
      code: 'LUMA_CENTRAL',
      name: 'Luma',
      type: 'AGENCIA' as AuthenticatedUser['organization']['type'],
    },
    role: {
      id: 'role-1',
      code: roleCode,
      name: 'Administrativa',
      system: true,
      permissions: [],
    },
    branch: null,
  };
}

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return (error.getResponse() as { code: string }).code;
    }
    throw error;
  }
  throw new Error('Expected the call to fail');
}

describe('AssistantService', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  const loggerLog = jest
    .spyOn(Logger.prototype, 'log')
    .mockImplementation(() => undefined);
  const loggerError = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);

  // Rows returned by the stored-answer lookup, and the inserts it records.
  const queryRaw = jest.fn<
    Promise<unknown[]>,
    [{ values: unknown[]; strings: string[] }]
  >();
  const executeRaw = jest.fn<Promise<number>, [{ values: unknown[] }]>();
  const withTenant = jest.fn(
    (_scope: unknown, operation: (tx: unknown) => Promise<unknown>) =>
      operation({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
  );
  const loggerWarn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);

  // Data queries offered to the model and their results.
  const toolDefinitions = jest.fn<unknown[], [AuthenticatedUser]>();
  const runTool = jest.fn<
    Promise<string>,
    [string, string, AuthenticatedUser]
  >();

  function service(values: Partial<EnvironmentVariables>) {
    return new AssistantService(
      {
        get: jest.fn((key: keyof EnvironmentVariables) => values[key]),
      } as unknown as ConfigService<EnvironmentVariables, true>,
      { withTenant } as unknown as PrismaService,
      {
        definitions: toolDefinitions,
        run: runTool,
      } as unknown as AssistantToolsService,
    );
  }

  const configured: Partial<EnvironmentVariables> = {
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'model-a',
    OPENAI_FALLBACK_MODELS: 'model-b',
    OPENAI_TIMEOUT_MS: 5_000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queryRaw.mockResolvedValue([]);
    executeRaw.mockResolvedValue(1);
    toolDefinitions.mockReturnValue([]);
    withTenant.mockImplementation(
      (_scope: unknown, operation: (tx: unknown) => Promise<unknown>) =>
        operation({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
    );
  });

  afterAll(() => {
    fetchMock.mockRestore();
    loggerLog.mockRestore();
    loggerError.mockRestore();
    loggerWarn.mockRestore();
  });

  it('answers with the manual of the session role and the conversation', async () => {
    fetchMock.mockResolvedValue(completion('Andá a Ventas → Operaciones.'));

    const result = await service(configured).ask(actor('ADMINISTRATIVA'), {
      question: '¿Dónde cargo la patente?',
      history: [
        { role: 'user', content: 'Hola' },
        { role: 'assistant', content: '¿En qué te ayudo?' },
      ],
    });

    expect(result).toEqual({
      answer: 'Andá a Ventas → Operaciones.',
      covered: true,
      cached: false,
    });
    // A follow-up depends on the conversation: it never looks for a stored
    // answer, but it is still recorded.
    expect(queryRaw).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-key',
    );
    const body = JSON.parse(init?.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('model-a');
    expect(body.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(body.messages[0].content).toContain('Manual de la Administrativa');
    expect(body.messages[0].content).not.toContain('Manual del Vendedor');
    expect(body.messages[3].content).toBe('¿Dónde cargo la patente?');
  });

  it('answers managers and call center with their own manual', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(completion('Ok.')));

    await service(configured).ask(actor('GERENTE'), { question: '¿Hola?' });
    await service(configured).ask(actor('CALLCENTER'), { question: '¿Hola?' });

    const prompts = fetchMock.mock.calls.map(
      ([, init]) =>
        (
          JSON.parse(init?.body as string) as {
            messages: Array<{ content: string }>;
          }
        ).messages[0].content,
    );
    expect(prompts[0]).toContain('Manual del Gerente');
    expect(prompts[0]).not.toContain('Manual de la Administrativa');
    expect(prompts[1]).toContain('Manual de Call Center');
    expect(prompts[1]).not.toContain('Manual del Vendedor');
  });

  it('answers the administrator with the manuals of every profile', async () => {
    fetchMock.mockResolvedValue(completion('Depende del perfil.'));

    await service(configured).ask(actor('ADMINISTRADOR'), {
      question: '¿Cómo carga una venta el vendedor?',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0].content).toContain('Manual de la Administrativa');
    expect(body.messages[0].content).toContain('Manual del Vendedor');
    expect(body.messages[0].content).toContain('ve todo el sistema');
    expect(body.messages[0].content).toContain('Manual del Gerente');
    // Call Center shares the seller manual: it is referenced, not repeated.
    expect(body.messages[0].content).not.toContain('Manual de Call Center');
    expect(body.messages[0].content).toContain(
      'El perfil Call Center usa las mismas pantallas',
    );
  });

  it('stores the question, the answer and the tokens it used', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `${ASSISTANT_NOT_COVERED_PREFIX}. Consultá a un Administrador.`,
              },
            },
          ],
          usage: {
            prompt_tokens: 9000,
            completion_tokens: 40,
            prompt_tokens_details: { cached_tokens: 8800 },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await service(configured).ask(actor('VENDEDOR'), {
      question: '¿Cómo pago comisiones?',
    });

    expect(result).toMatchObject({ covered: false, cached: false });
    expect(withTenant).toHaveBeenCalledWith(
      { organizationId: 'org-1', globalAccess: false },
      expect.any(Function),
    );
    const values = executeRaw.mock.calls[0][0].values;
    expect(values).toEqual(
      expect.arrayContaining([
        'org-1',
        'user-1',
        'VENDEDOR',
        '¿Cómo pago comisiones?',
        'como pago comisiones',
        'model-a',
        9000,
        8800,
        40,
      ]),
    );
  });

  it('reuses the stored answer for the same first question without calling OpenAI', async () => {
    queryRaw.mockResolvedValue([
      { id: 'query-1', respuesta: 'En Gastos generales.', cubierta: true },
    ]);

    const result = await service(configured).ask(actor('ADMINISTRATIVA'), {
      question: '  ¿CÓMO cargo un gasto?? ',
    });

    expect(result).toEqual({
      answer: 'En Gastos generales.',
      covered: true,
      cached: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // Looked up by role, prompt version and normalized question.
    expect(queryRaw.mock.calls[0][0].values).toEqual(
      expect.arrayContaining([
        'org-1',
        'ADMINISTRATIVA',
        'como cargo un gasto',
      ]),
    );
    // The reuse is recorded too, pointing at the original answer.
    expect(executeRaw.mock.calls[0][0].values).toEqual(
      expect.arrayContaining(['query-1', true]),
    );
  });

  it('keeps answering when the questions table is not available', async () => {
    withTenant.mockRejectedValue(new Error('relation does not exist'));
    fetchMock.mockResolvedValue(completion('Listo.'));

    const result = await service(configured).ask(actor('ADMINISTRATIVA'), {
      question: '¿Cómo cargo un gasto?',
    });

    expect(result).toEqual({ answer: 'Listo.', covered: true, cached: false });
    expect(loggerWarn).toHaveBeenCalledTimes(2);
  });

  describe('data queries', () => {
    const definition = {
      type: 'function',
      function: {
        name: 'buscar_operaciones',
        description: 'x',
        parameters: {},
      },
    };
    const toolCall = (name: string) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: { name, arguments: '{"busqueda":"1048"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        }),
        { status: 200 },
      );

    it('runs the query as the session user and answers with its result', async () => {
      toolDefinitions.mockReturnValue([definition]);
      runTool.mockResolvedValue('{"resultados":[{"operacion":"1048"}]}');
      fetchMock
        .mockResolvedValueOnce(toolCall('buscar_operaciones'))
        .mockResolvedValueOnce(completion('La operación 1048 está aprobada.'));
      const seller = actor('VENDEDOR');

      const result = await service(configured).ask(seller, {
        question: '¿Cómo está la operación 1048?',
      });

      expect(result).toEqual({
        answer: 'La operación 1048 está aprobada.',
        covered: true,
        cached: false,
      });
      expect(runTool).toHaveBeenCalledWith(
        'buscar_operaciones',
        '{"busqueda":"1048"}',
        seller,
      );
      const first = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
        tools: unknown[];
        messages: Array<{ content: string }>;
      };
      expect(first.tools).toEqual([definition]);
      expect(first.messages[0].content).toContain('Nunca des totales');
      const second = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(second.messages.at(-1)).toEqual({
        role: 'tool',
        tool_call_id: 'call-1',
        content: '{"resultados":[{"operacion":"1048"}]}',
      });
      // Stored as a data answer (last value), so it is never reused.
      expect(executeRaw.mock.calls[0][0].values.at(-1)).toBe(true);
    });

    it('offers no queries and keeps the no-data rule when the user has none', async () => {
      fetchMock.mockResolvedValue(completion('Mirá la pantalla Operaciones.'));

      await service(configured).ask(actor('VENDEDOR'), {
        question: '¿Cuánto vendimos este mes?',
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
        tools?: unknown[];
        messages: Array<{ content: string }>;
      };
      expect(body.tools).toBeUndefined();
      expect(body.messages[0].content).toContain(
        'No tenés acceso a los datos del sistema',
      );
      expect(runTool).not.toHaveBeenCalled();
    });

    it('stops offering queries after a few rounds so the model must answer', async () => {
      toolDefinitions.mockReturnValue([definition]);
      runTool.mockResolvedValue('{"resultados":[]}');
      fetchMock.mockImplementation((_url, init) => {
        const body = JSON.parse(init?.body as string) as { tools?: unknown[] };
        return Promise.resolve(
          body.tools
            ? toolCall('buscar_operaciones')
            : completion('No la encuentro.'),
        );
      });

      const result = await service(configured).ask(actor('ADMINISTRATIVA'), {
        question: '¿Cómo está la operación 9999?',
      });

      expect(result.answer).toBe('No la encuentro.');
      expect(runTool).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('only reuses stored answers that did not use data', async () => {
      await service(configured)
        .ask(actor('ADMINISTRATIVA'), {
          question: '¿Cómo cargo un gasto?',
        })
        .catch(() => undefined);

      expect(queryRaw.mock.calls[0][0].strings.join('?')).toContain(
        'uso_datos = false',
      );
    });
  });

  it('normalizes questions and versions the prompt', () => {
    expect(normalizeQuestion('  ¿Cómo CARGO   la patente?! ')).toBe(
      'como cargo la patente',
    );
    expect(manualVersion('a')).toHaveLength(16);
    expect(manualVersion('a')).not.toBe(manualVersion('b'));
  });

  it('falls back to the next model when the first one is not available', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'model_not_found' } }), {
          status: 404,
        }),
      )
      .mockResolvedValueOnce(completion('Listo.'));

    const result = await service(configured).ask(actor('ADMINISTRATIVA'), {
      question: '¿Cómo cargo un gasto?',
    });

    expect(result.answer).toBe('Listo.');
    const models = fetchMock.mock.calls.map(
      ([, init]) =>
        (JSON.parse(init?.body as string) as { model: string }).model,
    );
    expect(models).toEqual(['model-a', 'model-b']);
  });

  it('rejects roles without a manual before calling OpenAI', async () => {
    await expect(
      errorCode(
        service(configured).ask(actor('SOPORTE'), { question: '¿Hola?' }),
      ),
    ).resolves.toBe('ASSISTANT_MANUAL_NOT_AVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports that it is not configured without an API key', async () => {
    await expect(
      errorCode(
        service({ ...configured, OPENAI_API_KEY: undefined }).ask(
          actor('ADMINISTRATIVA'),
          { question: '¿Hola?' },
        ),
      ),
    ).resolves.toBe('ASSISTANT_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps upstream failures to a typed 502 without leaking details', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), {
        status: 429,
      }),
    );

    await expect(
      errorCode(
        service(configured).ask(actor('ADMINISTRATIVA'), {
          question: '¿Hola?',
        }),
      ),
    ).resolves.toBe('ASSISTANT_UPSTREAM_ERROR');
  });
});
