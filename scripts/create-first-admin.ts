import 'dotenv/config';
import { input, password } from '@inquirer/prompts';
import { Prisma, PrismaClient } from '@prisma/client';
import { AUDIT_ACTIONS, ROLE_CODES } from '../src/auth/auth.constants';
import { hashPassword } from '../src/auth/password-hashing';

const prisma = new PrismaClient();

function validateRequired(value: string): true | string {
  return value.trim().length > 0 || 'This field is required';
}

function validateEmail(value: string): true | string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? true
    : 'Enter a valid email address';
}

function validatePassword(value: string): true | string {
  if (value.length < 12) {
    return 'Use at least 12 characters';
  }
  if (value.length > 128) {
    return 'Use at most 128 characters';
  }
  return true;
}

async function main(): Promise<void> {
  const organization = await prisma.organizaciones.findUnique({
    where: { codigo: 'LUMA_CENTRAL' },
    select: { id: true, activa: true },
  });
  if (!organization?.activa) {
    throw new Error(
      'Active LUMA_CENTRAL organization not found. Run the database seed first.',
    );
  }

  const existingUsers = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('app.organizacion_id', ${organization.id}, true),
        set_config('app.acceso_global', 'true', true)
    `;
    return transaction.usuarios.count();
  });
  if (existingUsers > 0) {
    throw new Error(
      'Bootstrap refused: at least one user already exists. Create additional users through an authenticated administration flow.',
    );
  }

  const role = await prisma.role.findFirst({
    where: {
      codigo: ROLE_CODES.ADMINISTRADOR,
      es_sistema: true,
      organizacion_id: null,
      activo: true,
    },
    select: { id: true },
  });
  if (!role) {
    throw new Error(
      'Administrator role not found. Run the database seed first.',
    );
  }

  if (process.argv.includes('--check')) {
    console.log('Initial administrator bootstrap is ready.');
    return;
  }

  const email = (
    await input({
      message: 'Administrator email:',
      validate: validateEmail,
    })
  )
    .trim()
    .toLowerCase();
  const firstName = (
    await input({
      message: 'First name:',
      validate: validateRequired,
    })
  ).trim();
  const lastName = (
    await input({
      message: 'Last name:',
      validate: validateRequired,
    })
  ).trim();
  const plainPassword = await password({
    message: 'Password:',
    mask: '*',
    validate: validatePassword,
  });
  const passwordConfirmation = await password({
    message: 'Confirm password:',
    mask: '*',
  });

  if (plainPassword !== passwordConfirmation) {
    throw new Error('Passwords do not match.');
  }

  const passwordHash = await hashPassword(plainPassword);

  await prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT
          set_config('app.organizacion_id', ${organization.id}, true),
          set_config('app.acceso_global', 'true', true)
      `;

      if ((await transaction.usuarios.count()) > 0) {
        throw new Error(
          'Bootstrap refused: another user was created concurrently.',
        );
      }

      const user = await transaction.usuarios.create({
        data: {
          correo: email,
          correo_normalizado: email,
          hash_contrasena: passwordHash,
          rol_id: role.id,
          organizacion_id: organization.id,
          acceso_global: true,
          contrasena_configurada_en: new Date(),
          estado_invitacion: 'ACCEPTED',
          invitacion_aceptada_en: new Date(),
        },
        select: { id: true },
      });

      const fullName = `${firstName} ${lastName}`;
      await transaction.personal.create({
        data: {
          usuario_id: user.id,
          nombre_completo: fullName,
          nombre_normalizado: fullName.toLocaleLowerCase('es-AR'),
          correo_normalizado: email,
          rol_id: role.id,
          puede_iniciar_sesion: true,
          organizacion_id: organization.id,
        },
      });

      await transaction.registros_auditoria.create({
        data: {
          accion: AUDIT_ACTIONS.INITIAL_ADMIN_CREATED,
          entidad: 'usuarios',
          entidad_id: user.id,
          usuario_id: user.id,
          organizacion_id: organization.id,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  console.log(`Administrator ${email} created successfully.`);
}

void main()
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown bootstrap error';
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
