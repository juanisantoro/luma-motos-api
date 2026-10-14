import { HttpStatus } from '@nestjs/common';
import { Prisma, plataforma_pago_luma } from '@prisma/client';
import { apiError } from '../common/api-error';
import {
  CREDIT_PAYMENT_PLATFORMS,
  platformHasCredit,
} from './payment-platforms';

// Garante de la operación. Cuando alguna parte se paga con crédito, la venta
// indica si tiene un garante propio (nombre, apellido y DNI obligatorios) o
// si el garante es el mismo cliente: en ese caso se copian sus datos al
// guardarla. Sin crédito no hay garante.

export const GUARANTOR_CREDIT_PLATFORMS = CREDIT_PAYMENT_PLATFORMS;

export { platformHasCredit };

export type GuarantorInput = {
  hasGuarantor?: boolean | null;
  guarantorFirstName?: string | null;
  guarantorLastName?: string | null;
  guarantorDocument?: string | null;
};

export type GuarantorColumns = {
  tiene_garante: boolean | null;
  garante_nombre: string | null;
  garante_apellido: string | null;
  garante_documento: string | null;
  garante_busqueda: string | null;
};

export type GuarantorClient = {
  nombre_completo: string;
  numero_documento: string | null;
};

export const EMPTY_GUARANTOR: GuarantorColumns = {
  tiene_garante: null,
  garante_nombre: null,
  garante_apellido: null,
  garante_documento: null,
  garante_busqueda: null,
};

// Minúsculas, sin acentos y con espacios simples: "Pérez  JUAN" → "perez juan".
export function normalizeGuarantorText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('es-AR')
    .replace(/\s+/g, ' ')
    .trim();
}

// DNI sin puntos, guiones ni espacios: "30.111.222" → "30111222".
export function normalizeGuarantorDocument(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function guarantorSearchText(
  firstName: string | null,
  lastName: string | null,
  document: string | null,
) {
  const text = [
    lastName ? normalizeGuarantorText(lastName) : '',
    firstName ? normalizeGuarantorText(firstName) : '',
    document ? normalizeGuarantorDocument(document).toLowerCase() : '',
  ]
    .filter(Boolean)
    .join(' ');
  return text ? text.slice(0, 400) : null;
}

function clean(value: string | null | undefined) {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : null;
}

function guarantorError(code: string, message: string) {
  return apiError(HttpStatus.BAD_REQUEST, code, message);
}

// Columnas del garante para guardar en la operación.
// - Sin crédito: no hay garante (todo en null).
// - Con crédito y garante propio: nombre, apellido y DNI obligatorios.
// - Con crédito y sin garante propio: el garante es el cliente.
// `current` son los datos que ya tenía la operación (en una edición), para
// completar lo que no vino en el pedido.
export function resolveGuarantor(
  platform: plataforma_pago_luma | null | undefined,
  input: GuarantorInput,
  client: GuarantorClient | null,
  current?: Partial<GuarantorColumns>,
): GuarantorColumns {
  if (!platformHasCredit(platform)) return { ...EMPTY_GUARANTOR };
  const hasGuarantor =
    input.hasGuarantor === undefined
      ? (current?.tiene_garante ?? null)
      : input.hasGuarantor;
  if (hasGuarantor === null)
    throw guarantorError(
      'GUARANTOR_REQUIRED',
      'Indicate whether the credit has a guarantor',
    );
  if (!hasGuarantor) {
    if (!client)
      throw guarantorError('GUARANTOR_CLIENT_REQUIRED', 'Client is required');
    const firstName = clean(client.nombre_completo);
    const document = clean(client.numero_documento);
    return {
      tiene_garante: false,
      garante_nombre: firstName,
      garante_apellido: null,
      garante_documento: document,
      garante_busqueda: guarantorSearchText(firstName, null, document),
    };
  }
  // Si antes el garante era el cliente, sus datos no se reutilizan.
  const reuse = current?.tiene_garante === true;
  const pick = (
    value: string | null | undefined,
    previous: string | null | undefined,
  ) => (value === undefined ? (reuse ? clean(previous) : null) : clean(value));
  const firstName = pick(input.guarantorFirstName, current?.garante_nombre);
  const lastName = pick(input.guarantorLastName, current?.garante_apellido);
  const document = pick(input.guarantorDocument, current?.garante_documento);
  if (!firstName || !lastName || !document)
    throw guarantorError(
      'GUARANTOR_DATA_REQUIRED',
      'Guarantor first name, last name and document are required',
    );
  const normalizedDocument = normalizeGuarantorDocument(document);
  if (!/^\d{6,11}$/.test(normalizedDocument))
    throw guarantorError(
      'GUARANTOR_DOCUMENT_INVALID',
      'Guarantor document must be a valid DNI',
    );
  return {
    tiene_garante: true,
    garante_nombre: firstName,
    garante_apellido: lastName,
    garante_documento: normalizedDocument,
    garante_busqueda: guarantorSearchText(
      firstName,
      lastName,
      normalizedDocument,
    ),
  };
}

export function touchesGuarantor(input: GuarantorInput) {
  return (
    input.hasGuarantor !== undefined ||
    input.guarantorFirstName !== undefined ||
    input.guarantorLastName !== undefined ||
    input.guarantorDocument !== undefined
  );
}

// Palabras de la búsqueda, normalizadas igual que el texto guardado: todas
// tienen que aparecer, en cualquier orden ("perez juan", "juan perez",
// "30.111.222").
export function guarantorSearchTokens(search: string | null | undefined) {
  if (!search) return [];
  return normalizeGuarantorText(search)
    .split(' ')
    .map((token) =>
      /\d/.test(token)
        ? normalizeGuarantorDocument(token).toLowerCase()
        : token,
    )
    .filter((token) => token.length > 0)
    .slice(0, 6);
}

// Condición Prisma sobre operaciones.
export function guarantorSearchWhere(
  search: string | null | undefined,
): Prisma.operacionesWhereInput | null {
  const tokens = guarantorSearchTokens(search);
  if (!tokens.length) return null;
  return {
    AND: tokens.map((token) => ({
      garante_busqueda: { contains: token },
    })),
  };
}

// Condición SQL sobre la columna indicada (p. ej. o."garante_busqueda").
export function guarantorSearchSql(
  column: Prisma.Sql,
  search: string | null | undefined,
): Prisma.Sql | null {
  const tokens = guarantorSearchTokens(search);
  if (!tokens.length) return null;
  return Prisma.sql`(${Prisma.join(
    tokens.map((token) => Prisma.sql`${column} LIKE ${`%${token}%`}`),
    ' AND ',
  )})`;
}

export type GuarantorRow = Partial<GuarantorColumns> & {
  respaldo_garante?: string | null;
};

export type GuarantorView = {
  hasGuarantor: boolean;
  sameAsClient: boolean;
  firstName: string | null;
  lastName: string | null;
  documentNumber: string | null;
  fullName: string;
} | null;

export function guarantorView(row: GuarantorRow): GuarantorView {
  if (row.tiene_garante === null || row.tiene_garante === undefined)
    return null;
  const fullName = [row.garante_apellido, row.garante_nombre]
    .filter(Boolean)
    .join(', ');
  return {
    hasGuarantor: row.tiene_garante,
    sameAsClient: !row.tiene_garante,
    firstName: row.garante_nombre ?? null,
    lastName: row.garante_apellido ?? null,
    documentNumber: row.garante_documento ?? null,
    fullName,
  };
}
