import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExpenseQueryDto, IncomeQueryDto } from './finance.dto';

const A = '3f0d7a8e-1b2c-4d5e-8f90-1a2b3c4d5e6f';
const B = '4a1e8b9f-2c3d-4e5f-9a01-2b3c4d5e6f70';

describe('accountIds en los filtros de ingresos y gastos', () => {
  it.each([IncomeQueryDto, ExpenseQueryDto])(
    'acepta la lista separada por comas (%p)',
    async (dto) => {
      const query = plainToInstance(dto, { accountIds: `${A}, ${B}` });
      expect(query.accountIds).toEqual([A, B]);
      expect(await validate(query)).toEqual([]);
    },
  );

  it('acepta el parámetro repetido', async () => {
    const query = plainToInstance(IncomeQueryDto, { accountIds: [A, B] });
    expect(query.accountIds).toEqual([A, B]);
    expect(await validate(query)).toEqual([]);
  });

  it('rechaza un valor que no es un id de cuenta', async () => {
    const query = plainToInstance(IncomeQueryDto, {
      accountIds: `${A},caja-lucas`,
    });
    const errors = await validate(query);
    expect(errors.map((error) => error.property)).toEqual(['accountIds']);
  });
});
