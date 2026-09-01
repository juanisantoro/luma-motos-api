import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { CLIENT_DOCUMENT_TYPES } from '../clients.constants';

const DNI_NUMBER_PATTERN = /^\d{6,9}$/;

interface DocumentPair {
  documentType?: unknown;
  documentNumber?: unknown;
}

export function IsClientDocumentPair(
  allowNull: boolean,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isClientDocumentPair',
      target: object.constructor,
      propertyName: propertyName.toString(),
      constraints: [allowNull],
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const input = args.object as DocumentPair;
          const type = input.documentType;
          const documentNumber = input.documentNumber;
          const bothUndefined =
            type === undefined && documentNumber === undefined;
          const bothNull = type === null && documentNumber === null;

          if (bothUndefined || (allowNull && bothNull)) {
            return true;
          }
          if (
            type === undefined ||
            documentNumber === undefined ||
            type === null ||
            documentNumber === null
          ) {
            return false;
          }

          const validPair =
            typeof type === 'string' &&
            CLIENT_DOCUMENT_TYPES.includes(
              type as (typeof CLIENT_DOCUMENT_TYPES)[number],
            ) &&
            typeof documentNumber === 'string' &&
            documentNumber.length >= 1 &&
            documentNumber.length <= 30 &&
            /[A-Za-z0-9]/.test(documentNumber);
          if (!validPair) return false;

          // DNI is always a purely numeric Argentine document number - reject
          // anything else (letters, symbols) instead of accepting it as-is.
          if (type === 'DNI' && !DNI_NUMBER_PATTERN.test(documentNumber as string)) {
            return false;
          }
          return true;
        },
      },
    });
  };
}

export function IsDocumentNumberFormat(
  documentTypeProperty = 'documentType',
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isDocumentNumberFormat',
      target: object.constructor,
      propertyName: propertyName.toString(),
      constraints: [documentTypeProperty],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          // Presence/length/charset are enforced by the other decorators on
          // this property - this one only tightens the format for DNI.
          if (typeof value !== 'string') return true;
          const input = args.object as Record<string, unknown>;
          const type = input[args.constraints[0] as string];
          if (type !== 'DNI') return true;
          return DNI_NUMBER_PATTERN.test(value);
        },
        defaultMessage(): string {
          return 'A DNI must contain 6 to 9 digits and nothing else';
        },
      },
    });
  };
}
