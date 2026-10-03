import { ADMINISTRATIVA_MANUAL } from './manuals/administrativa.manual';
import { CALLCENTER_MANUAL } from './manuals/callcenter.manual';
import { GERENTE_MANUAL } from './manuals/gerente.manual';
import { VENDEDOR_MANUAL } from './manuals/vendedor.manual';

// Manual de uso por código de rol. Los textos se generan desde los HTML del
// frontend con scripts/sync-assistant-manuals.mjs.
const MANUALS: Record<string, { profile: string; text: string }> = {
  ADMINISTRATIVA: { profile: 'Administrativa', text: ADMINISTRATIVA_MANUAL },
  VENDEDOR: { profile: 'Vendedor', text: VENDEDOR_MANUAL },
  CALLCENTER: { profile: 'Call Center', text: CALLCENTER_MANUAL },
  GERENTE: { profile: 'Gerente', text: GERENTE_MANUAL },
};

// Roles que no tienen manual propio pero ven todo el sistema: el asistente
// les responde con los manuales de todos los perfiles.
const ALL_MANUALS_ROLES = new Set(['ADMINISTRADOR']);

// Call Center usa las mismas pantallas que Vendedor y su manual es casi
// idéntico: en la versión "todos los perfiles" se reemplaza por una nota,
// para no duplicar miles de tokens en cada pregunta.
const SAME_AS: Record<string, string> = { CALLCENTER: 'VENDEDOR' };

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
    text: Object.entries(MANUALS)
      .map(([code, manual]) => {
        const twin = SAME_AS[code];
        const body = twin
          ? `El perfil ${manual.profile} usa las mismas pantallas y pasos que el perfil ${MANUALS[twin].profile}: vale su manual.`
          : manual.text;
        return `===== MANUAL DEL PERFIL ${manual.profile.toUpperCase()} =====\n${body}`;
      })
      .join('\n\n'),
  };
}
