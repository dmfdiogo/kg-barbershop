// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESERVED_SLUGS,
  classifyHost,
  firstPathSegment,
  getAppDomain,
  isReservedSlug,
  normalizeHost,
  resolveTenantTarget,
  validateSlug,
} from '@/lib/tenant/slugs';

const APP_DOMAIN = 'app.agendex.com.br';

describe('validateSlug', () => {
  it('normaliza caixa e espaços', () => {
    expect(validateSlug('  CarlosBarber  ')).toEqual({ ok: true, slug: 'carlosbarber' });
  });

  it('recusa slug reservado — o tenant ficaria inacessível para sempre', () => {
    expect(validateSlug('painel')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateSlug('API')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateSlug('www')).toEqual({ ok: false, reason: 'reserved' });
  });

  it('recusa vazio, curto, longo e formato inválido', () => {
    expect(validateSlug('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateSlug('ab')).toEqual({ ok: false, reason: 'too_short' });
    expect(validateSlug('a'.repeat(41))).toEqual({ ok: false, reason: 'too_long' });
    expect(validateSlug('-carlos')).toEqual({ ok: false, reason: 'format' });
    expect(validateSlug('carlos-')).toEqual({ ok: false, reason: 'format' });
    expect(validateSlug('carlos barber')).toEqual({ ok: false, reason: 'format' });
    expect(validateSlug('carlos_barber')).toEqual({ ok: false, reason: 'format' });
  });

  it('a lista de reservados é a mesma que a validação usa', () => {
    for (const slug of RESERVED_SLUGS) {
      expect(isReservedSlug(slug), `reservado ${slug}`).toBe(true);
      expect(validateSlug(slug).ok, `recusado ${slug}`).toBe(false);
    }
  });
});

describe('normalizeHost', () => {
  it('minúsculas, sem ponto final, primeiro valor de lista e porta preservada', () => {
    expect(normalizeHost('CarlosBarber.Localhost:3000.')).toBe('carlosbarber.localhost:3000');
    expect(normalizeHost('www.salao.com.br, proxy.internal')).toBe('www.salao.com.br');
    expect(normalizeHost('  ')).toBeNull();
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
  });
});

describe('classifyHost', () => {
  it('distingue domínio base, subdomínio e domínio próprio', () => {
    expect(classifyHost(APP_DOMAIN, APP_DOMAIN).kind).toBe('app');
    expect(classifyHost(`carlosbarber.${APP_DOMAIN}`, APP_DOMAIN)).toMatchObject({
      kind: 'subdomain',
      slug: 'carlosbarber',
    });
    expect(classifyHost('www.carlosbarber.com.br', APP_DOMAIN)).toMatchObject({
      kind: 'custom',
      host: 'www.carlosbarber.com.br',
    });
    expect(classifyHost(null, APP_DOMAIN).kind).toBe('missing');
  });

  it('prefixo com mais de um rótulo não é subdomínio de tenant', () => {
    expect(classifyHost(`a.b.${APP_DOMAIN}`, APP_DOMAIN).kind).toBe('custom');
  });
});

describe('resolveTenantTarget — as três formas de resolução', () => {
  it('1. domínio próprio: host que não é o domínio base', () => {
    expect(
      resolveTenantTarget({ host: 'www.carlosbarber.com.br', pathname: '/', appDomain: APP_DOMAIN }),
    ).toEqual({ source: 'custom-domain', value: 'www.carlosbarber.com.br' });
  });

  it('2. subdomínio: slug no rótulo à esquerda do domínio base', () => {
    expect(
      resolveTenantTarget({
        host: `carlosbarber.${APP_DOMAIN}`,
        pathname: '/agendar',
        appDomain: APP_DOMAIN,
      }),
    ).toEqual({ source: 'subdomain', value: 'carlosbarber' });
  });

  it('3. path: primeiro segmento no domínio base', () => {
    expect(
      resolveTenantTarget({
        host: APP_DOMAIN,
        pathname: '/carlosbarber/agendar?servico=1',
        appDomain: APP_DOMAIN,
      }),
    ).toEqual({ source: 'path', value: 'carlosbarber' });
  });

  it('a ordem da spec é domínio próprio antes de path e subdomínio', () => {
    // Um domínio próprio pode ter qualquer caminho; o host decide primeiro.
    expect(
      resolveTenantTarget({
        host: 'www.carlosbarber.com.br',
        pathname: '/carlosbarber',
        appDomain: APP_DOMAIN,
      }),
    ).toEqual({ source: 'custom-domain', value: 'www.carlosbarber.com.br' });
  });

  it('segmento reservado nunca é tenant', () => {
    expect(
      resolveTenantTarget({ host: APP_DOMAIN, pathname: '/painel', appDomain: APP_DOMAIN }),
    ).toBeNull();
    expect(
      resolveTenantTarget({ host: APP_DOMAIN, pathname: '/api/auth/otp', appDomain: APP_DOMAIN }),
    ).toBeNull();
    expect(
      resolveTenantTarget({
        host: `painel.${APP_DOMAIN}`,
        pathname: '/',
        appDomain: APP_DOMAIN,
      }),
    ).toBeNull();
  });

  it('raiz do domínio base e slug de formato inválido não produzem alvo', () => {
    expect(resolveTenantTarget({ host: APP_DOMAIN, pathname: '/', appDomain: APP_DOMAIN })).toBeNull();
    expect(
      resolveTenantTarget({ host: APP_DOMAIN, pathname: '/ab', appDomain: APP_DOMAIN }),
    ).toBeNull();
    expect(resolveTenantTarget({ host: null, pathname: '/', appDomain: APP_DOMAIN })).toBeNull();
  });
});

describe('firstPathSegment', () => {
  it('ignora query e barra final e decodifica o segmento', () => {
    expect(firstPathSegment('/carlosbarber/agendar?x=1')).toBe('carlosbarber');
    expect(firstPathSegment('/carlosbarber/')).toBe('carlosbarber');
    expect(firstPathSegment('/')).toBeNull();
    expect(firstPathSegment('/carlos%20barber')).toBe('carlos barber');
  });
});

describe('getAppDomain', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefere APP_DOMAIN', () => {
    vi.stubEnv('APP_DOMAIN', 'app.exemplo.com.br');
    expect(getAppDomain()).toBe('app.exemplo.com.br');
  });

  it('deriva de APP_URL quando APP_DOMAIN não existe', () => {
    vi.stubEnv('APP_DOMAIN', '');
    vi.stubEnv('APP_URL', 'https://app.exemplo.com.br/api/webhooks/payments');
    expect(getAppDomain()).toBe('app.exemplo.com.br');
  });

  it('cai para localhost na porta em desenvolvimento', () => {
    vi.stubEnv('APP_DOMAIN', '');
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('PORT', '4321');
    expect(getAppDomain()).toBe('localhost:4321');
  });

  it('em produção sem APP_DOMAIN nem APP_URL, falha explícito', () => {
    vi.stubEnv('APP_DOMAIN', '');
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getAppDomain()).toThrow(/APP_DOMAIN/);
  });
});
