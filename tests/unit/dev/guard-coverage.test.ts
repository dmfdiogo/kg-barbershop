import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guarda estrutural do console de desenvolvimento.
 *
 * `/dev` é a superfície mais perigosa do produto: o outbox mostra o código de
 * OTP de qualquer telefone, o console de pagamentos confirma e estorna
 * cobrança, e o de billing conclui assinatura. Uma única rota que chegue a
 * produção sem o bloqueio de ambiente entrega tudo isso a quem souber a URL.
 *
 * O bloqueio existe em cada arquivo (`isDevConsoleEnabled`/`guardDevAction`), e
 * é isso que o torna frágil: ele depende de quem escreve a próxima rota
 * lembrar. Este teste é o que não esquece. Ele falha na criação do arquivo, e
 * não em produção.
 *
 * Por que varrer o arquivo em vez de renderizar: renderizar cada rota exigiria
 * banco, sessão e provider. A pergunta aqui é estrutural — "existe bloqueio
 * neste arquivo?" — e para ela ler o texto basta e não deixa a trava cara
 * demais para continuar rodando.
 */
const DEV_DIR = path.join(process.cwd(), 'app', 'dev');

/** Marcas aceitas de bloqueio; qualquer uma prova que o arquivo decide no servidor. */
const GUARD_MARKERS = ['isDevConsoleEnabled', 'guardDevAction', 'notFound()'];

/** Arquivos que definem uma rota acessível por HTTP. */
const ROUTE_FILES = new Set(['page.tsx', 'route.ts']);

function collectRouteFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRouteFiles(full, found);
    } else if (ROUTE_FILES.has(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

describe('console de desenvolvimento não vaza para produção', () => {
  it('toda rota sob /dev bloqueia por ambiente no servidor', () => {
    const rotas = collectRouteFiles(DEV_DIR);

    // Se a varredura parar de achar rotas, o teste passaria vazio e a trava
    // teria sumido sem ninguém notar.
    expect(rotas.length).toBeGreaterThan(3);

    const desprotegidas = rotas
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return !GUARD_MARKERS.some((marker) => source.includes(marker));
      })
      .map((file) => path.relative(process.cwd(), file));

    expect(
      desprotegidas,
      `Rota(s) de /dev sem bloqueio de ambiente: ${desprotegidas.join(', ')}. ` +
        'Toda página e toda action sob app/dev precisa conferir isDevConsoleEnabled() ' +
        'no servidor antes de ler ou mudar estado — o console expõe código de OTP, ' +
        'confirmação de cobrança e conclusão de assinatura.',
    ).toEqual([]);
  });

  it('o bloqueio depende de NODE_ENV, e não de uma variável que alguém possa ligar', () => {
    // Uma flag de ambiente própria (DEV_CONSOLE=1) seria ligável por engano no
    // deploy. Amarrar em NODE_ENV torna o console inalcançável em produção por
    // construção, não por configuração.
    const guard = readFileSync(path.join(DEV_DIR, 'guard.ts'), 'utf8');
    expect(guard).toContain("process.env.NODE_ENV === 'development'");
  });
});
