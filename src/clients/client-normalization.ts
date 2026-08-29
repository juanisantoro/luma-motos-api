export function normalizeClientName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
}

export function normalizeClientDocument(document: string): string {
  return document.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
