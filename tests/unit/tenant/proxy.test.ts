// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxy } from '@/proxy';

/**
 * O proxy só EXTRAI o tenant: identifica host/slug, rejeita segmento reservado,
 * reescreve subdomínio para /[slug] e injeta os headers internos. A resolução
 * contra o banco é testada em tests/integration/tenant.
 */

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(url, { headers }));
}

function overrideHeaders(response: Response): string[] {
  return (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

describe('proxy de tenant', () => {
  beforeEach(() => {
    vi.stubEnv('APP_DOMAIN', 'localhost:3000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('subdomínio: reescreve o caminho para /[slug] preservando query', () => {
    const response = proxy(
      makeRequest('https://carlosbarber.localhost:3000/agendar?servico=1', {
        host: 'carlosbarber.localhost:3000',
      }),
    );

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://carlosbarber.localhost:3000/carlosbarber/agendar?servico=1',
    );
    expect(response.headers.get('x-middleware-request-x-tenant-slug')).toBe('carlosbarber');
    expect(response.headers.get('x-middleware-request-x-tenant-host')).toBe(
      'carlosbarber.localhost:3000',
    );
  });

  it('subdomínio na raiz: reescreve para /slug', () => {
    const response = proxy(
      makeRequest('https://carlosbarber.localhost:3000/', {
        host: 'carlosbarber.localhost:3000',
      }),
    );

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://carlosbarber.localhost:3000/carlosbarber',
    );
  });

  it('path no domínio base: injeta o slug sem reescrever', () => {
    const response = proxy(
      makeRequest('https://localhost:3000/carlosbarber', { host: 'localhost:3000' }),
    );

    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-request-x-tenant-slug')).toBe('carlosbarber');
  });

  it('domínio próprio: injeta o host, não o slug, e não reescreve', () => {
    const response = proxy(
      makeRequest('https://www.carlosbarber.com.br/', { host: 'www.carlosbarber.com.br' }),
    );

    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-tenant-host')).toBe(
      'www.carlosbarber.com.br',
    );
    expect(response.headers.get('x-middleware-request-x-tenant-slug')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-tenant-slug')).not.toBe('www');
  });

  it('slug reservado no path não vira tenant', () => {
    const response = proxy(makeRequest('https://localhost:3000/painel', { host: 'localhost:3000' }));

    expect(response.headers.get('x-middleware-request-x-tenant-slug')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-tenant-host')).toBe('localhost:3000');
  });

  it('subdomínio com path reservado não reescreve (rota da plataforma)', () => {
    const response = proxy(
      makeRequest('https://carlosbarber.localhost:3000/painel', {
        host: 'carlosbarber.localhost:3000',
      }),
    );

    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-tenant-slug')).toBe('carlosbarber');
  });

  it('headers de tenant forjados pelo cliente são descartados', () => {
    const response = proxy(
      makeRequest('https://localhost:3000/painel', {
        host: 'localhost:3000',
        'x-tenant-slug': 'tenant-invadido',
        'x-tenant-host': 'www.invadido.com.br',
      }),
    );

    expect(response.headers.get('x-middleware-request-x-tenant-slug')).toBeNull();
    expect(response.headers.get('x-middleware-request-x-tenant-host')).toBe('localhost:3000');
    expect(overrideHeaders(response)).toContain('x-tenant-host');
    expect(overrideHeaders(response)).not.toContain('x-tenant-slug');
  });
});
