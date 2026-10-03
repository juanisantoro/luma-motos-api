import { ADMINISTRATIVA_MANUAL } from './manuals/administrativa.manual';
import { VENDEDOR_MANUAL } from './manuals/vendedor.manual';

// Manual de uso por código de rol. Los textos se generan desde los HTML del
// frontend con scripts/sync-assistant-manuals.mjs.
const MANUALS: Record<string, { profile: string; text: string }> = {
  ADMINISTRATIVA: { profile: 'Administrativa', text: ADMINISTRATIVA_MANUAL },
  VENDEDOR: { profile: 'Vendedor', text: VENDEDOR_MANUAL },
};

// Roles que no tienen manual propio pero ven todo el sistema: el asistente
// les responde con los manuales de todos los perfiles.
const ALL_MANUALS_ROLES = new Set(['ADMINISTRADOR']);

export interface AssistantManual {
  // 'own': el manual del perfil del usuario. 'all': los de todos los perfiles.
  scope: 'own' | 'all';
  text: string;
}

export function manualForRole(roleCode: string): AssistantManual | null {
  const own = MANUALS[roleCode];
  if (own) return { scope: 'own', text: own.text };
  if (!ALL_MANUALS_ROLES.has(roleCode)) return null;
  return {
    scope: 'all',
    text: Object.values(MANUALS)
      .map(
        (manual) =>
          `===== MANUAL DEL PERFIL ${manual.profile.toUpperCase()} =====\n${manual.text}`,
      )
      .join('\n\n'),
  };
}
