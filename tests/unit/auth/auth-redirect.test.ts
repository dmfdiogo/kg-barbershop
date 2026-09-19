import { describe, expect, it } from 'vitest';
import {
  postLoginDestination,
  resolveNextPath,
  safeNextPath,
} from '@/app/(auth)/_lib/redirect';
import { codePath, identifyPath, withNext } from '@/app/(auth)/_lib/routes';

/**
 * Destino pós-login (F1.2). `next` é entrada do usuário: sem validação a tela
 * de login vira open redirect. Estes casos cobrem as formas que o navegador
 * interpreta como URL absoluta (`//host`, `/\host`) e o caminho interno legítimo.
 */
describe('safeNextPath', () => {
  it('aceita caminho interno', () => {
    expect(safeNextPath('/plataforma')).toBe('/plataforma');
    expect(safeNextPath('/carlosbarber/agendar?servico=1')).toBe(
      '/carlosbarber/agendar?servico=1',
    );
  });

  it('recusa URL absoluta e caminhos que o navegador trata como host', () => {
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
  });

  it('recusa vazio e valor exagerado', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath('')).toBeNull();
    expect(safeNextPath(`/${'a'.repeat(600)}`)).toBeNull();
  });
});

describe('postLoginDestination', () => {
  it('cliente vai para o portal do tenant', () => {
    expect(postLoginDestination('CUSTOMER', '/carlosbarber')).toBe('/carlosbarber');
    expect(postLoginDestination('CUSTOMER', '')).toBe('/');
  });

  it('owner e staff vão para o painel', () => {
    expect(postLoginDestination('OWNER', '/carlosbarber')).toBe('/painel');
    expect(postLoginDestination('STAFF', '')).toBe('/painel');
  });
});

describe('resolveNextPath', () => {
  it('prefere o next válido ao destino padrão', () => {
    expect(resolveNextPath('/plataforma', 'OWNER', '/carlosbarber')).toBe('/plataforma');
  });

  it('ignora next inseguro e usa o padrão', () => {
    expect(resolveNextPath('//evil.example', 'CUSTOMER', '/carlosbarber')).toBe(
      '/carlosbarber',
    );
  });
});

describe('rotas de autenticação', () => {
  it('monta as duas formas: raiz e sob o slug', () => {
    expect(identifyPath('')).toBe('/entrar');
    expect(codePath('')).toBe('/entrar/codigo');
    expect(identifyPath('/carlosbarber')).toBe('/carlosbarber/entrar');
    expect(codePath('/carlosbarber')).toBe('/carlosbarber/entrar/codigo');
  });

  it('preserva o next no caminho do código', () => {
    expect(withNext('/entrar/codigo', '/plataforma')).toBe(
      '/entrar/codigo?next=%2Fplataforma',
    );
    expect(withNext('/entrar/codigo', null)).toBe('/entrar/codigo');
  });
});
