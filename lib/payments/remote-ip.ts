import { BlockList, isIP } from 'node:net';

/**
 * O `remoteIp` do Asaas é o IP do DISPOSITIVO DO PAGADOR, nunca o IP do
 * servidor (`plano-refatoracao.md` §1.1). Passar o IP errado só aparece em
 * produção, com cartão recusado — por isso o mock recusa aqui.
 */
const blocked = new BlockList();

// IPv4 reservado / privado / loopback / link-local / CGNAT / documentação.
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');
blocked.addSubnet('100.64.0.0', 10, 'ipv4');
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('172.16.0.0', 12, 'ipv4');
blocked.addSubnet('192.0.0.0', 24, 'ipv4');
blocked.addSubnet('192.0.2.0', 24, 'ipv4');
blocked.addSubnet('192.168.0.0', 16, 'ipv4');
blocked.addSubnet('198.18.0.0', 15, 'ipv4');
blocked.addSubnet('198.51.100.0', 24, 'ipv4');
blocked.addSubnet('203.0.113.0', 24, 'ipv4');
blocked.addSubnet('224.0.0.0', 4, 'ipv4');
blocked.addSubnet('240.0.0.0', 4, 'ipv4');

// IPv6: unspecified, loopback, unique-local, link-local, multicast e documentação.
blocked.addSubnet('::', 128, 'ipv6');
blocked.addSubnet('::1', 128, 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');

export function isPublicIp(value: string): boolean {
  const trimmed = value.trim();
  const family = isIP(trimmed);
  if (family === 4) {
    return !blocked.check(trimmed, 'ipv4');
  }
  if (family === 6) {
    // IPv4 mapeado (`::ffff:x.x.x.x`) é artefato de parsing, nunca o IP do
    // pagador. Recusar aqui também evita a normalização do BlockList, que
    // transforma `::ffff:0:0/96` em `0.0.0.0/0` e bloquearia todo IPv4.
    if (/^::ffff:/i.test(trimmed)) {
      return false;
    }
    return !blocked.check(trimmed, 'ipv6');
  }
  return false;
}

/**
 * Resolve o `remoteIp` do pagador a partir do valor extraído do header.
 *
 * Em desenvolvimento a requisição chega de loopback, então `DEV_PAYER_IP` (um
 * IP público de exemplo) é aceito como origem do valor SOMENTE com
 * `NODE_ENV=development`. Fora de desenvolvimento a variável é ignorada e a
 * validação é exatamente a de produção. A ausência continua sendo erro de quem
 * chama: o caminho de extração do header nunca deixa de ser exercido.
 */
export function resolvePayerIp(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  if (candidate && isPublicIp(candidate)) {
    return candidate;
  }
  if (process.env.NODE_ENV === 'development') {
    const devPayerIp = process.env.DEV_PAYER_IP?.trim();
    if (devPayerIp && isPublicIp(devPayerIp)) {
      return devPayerIp;
    }
  }
  return candidate && candidate.length > 0 ? candidate : undefined;
}

/**
 * Extrai o primeiro IP válido de um header de proxy (`X-Forwarded-For`,
 * `CF-Connecting-IP`, etc.), descartando porta e valores não-IP. A ausência é
 * tratada por quem chama — nunca caia no IP do servidor como fallback.
 */
export function firstIpFromHeader(headerValue: string | null | undefined): string | null {
  if (!headerValue) {
    return null;
  }
  for (const entry of headerValue.split(',')) {
    const candidate = stripPort(entry.trim());
    if (candidate && isIP(candidate) !== 0) {
      return candidate;
    }
  }
  return null;
}

function stripPort(value: string): string | null {
  if (!value) {
    return null;
  }
  if (value.startsWith('[')) {
    const closing = value.indexOf(']');
    return closing > 0 ? value.slice(1, closing) : null;
  }
  // IPv4 com porta (`203.0.113.1:443`); IPv6 puro tem mais de um `:` e é
  // devolvido como veio.
  const colon = value.indexOf(':');
  if (colon > 0 && !value.includes(':', colon + 1)) {
    return value.slice(0, colon);
  }
  return value;
}
