import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { CLIENT_DOCUMENT_TYPES } from '../clients.constants';

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

          return (
            typeof type === 'string' &&
            CLIENT_DOCUMENT_TYPES.includes(
              type as (typeof CLIENT_DOCUMENT_TYPES)[number],
            ) &&
            typeof documentNumber === 'string' &&
            documentNumber.length >= 1 &&
            documentNumber.length <= 30 &&
            /[A-Za-z0-9]/.test(documentNumber)
          );
        },
      },
    });
  };
}
