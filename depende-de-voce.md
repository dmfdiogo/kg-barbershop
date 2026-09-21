# O que depende de você

Tudo que sobrou do projeto e que eu **não** consigo fazer sozinho do terminal.
Cada passo diz onde clicar, o que copiar, onde colar, e o que eu faço depois.

A regra que organiza este documento: **credencial de sandbox destrava o código
inteiro; conta aprovada só é necessária para cobrar dinheiro de verdade.** Por
isso os dois passos obrigatórios abaixo levam minutos, e tudo que depende de
análise de terceiro está separado no fim, sem bloquear nada.

Onde estiver escrito "cole no `.env`", a linha já existe no arquivo, vazia,
esperando o valor. Abra com `open -e .env`, preencha entre as aspas e salve.
O `.env` não vai para o Git.

---

## 1. Obrigatório — destrava o resto do código

São dois cadastros gratuitos. Sem eles eu não consigo escrever nem testar as
integrações reais de pagamento e de WhatsApp.

### 1.1 Asaas sandbox — cobrança do cliente final (F8.2)

O sandbox é um ambiente **separado e gratuito**, com cadastro próprio,
independente de conta de produção. Ele aceita subconta e split, que é
exatamente o que o produto precisa: cada salão recebe na subconta dele e a
plataforma fica só com a taxa.

1. Crie a conta em **https://sandbox.asaas.com** (é um cadastro novo, não é a
   sua conta de produção).
2. No painel do sandbox: **Configurações → Integrações → API** e gere uma
   chave.
3. Cole em `ASAAS_API_KEY` no `.env`.

Não precisa mexer em `ASAAS_BASE_URL` — já aponta para o sandbox.

**Depois disso eu faço sozinho:** adaptador do `PaymentProvider` contra a API
real, criação de subconta por tenant, cobrança com split, webhook com
verificação, e a suíte de contrato rodando contra sandbox e mock.

### 1.2 WhatsApp Cloud API — número de teste (F8.3)

O Meta cria uma conta de WhatsApp Business e um **número de teste**
automaticamente junto com o app. Ele tem limite relaxado, não exige meio de
pagamento, não exige verificação de negócio, e já vem com um template
`hello_world` aprovado. Serve para desenvolver tudo.

1. Entre em **https://developers.facebook.com/apps** e crie um app do tipo
   **Business**.
2. Adicione o produto **WhatsApp**. O número de teste e a conta aparecem
   sozinhos.
3. Na tela de introdução da API, copie os três valores e cole no `.env`:
   - token temporário → `WHATSAPP_ACCESS_TOKEN`
   - *Phone number ID* → `WHATSAPP_PHONE_NUMBER_ID`
   - *WhatsApp Business Account ID* → `WHATSAPP_BUSINESS_ACCOUNT_ID`
4. Ainda nessa tela, em **"Para"**, adicione o **seu próprio número** como
   destinatário de teste e confirme o código que chegar. O número de teste só
   fala com até cinco números verificados.
5. Invente uma senha qualquer e coloque em `WHATSAPP_VERIFY_TOKEN` — ela é só
   um segredo compartilhado que o Meta devolve ao registrar o webhook.

O token da tela de introdução **expira em 24 horas**. Serve para começar;
quando ele vencer eu te digo como gerar o permanente, que é outro caminho
(usuário do sistema) e leva mais dois minutos.

**Depois disso eu faço sozinho:** adaptador do `WhatsAppProvider`, envio dos
templates de confirmação e lembrete, webhook de status de entrega, e o
tratamento de quem respondeu "PARAR".

---

## 2. Opcional agora — mas com risco de sumir

### 2.1 Registrar `marcadireto.com.br` e `marcadireto.com`

Os dois estão livres. Este é o único item da lista que **some se alguém
chegar antes**, e você já perdeu `agendex` e `melhorhorario` exatamente assim.

Registre os dois juntos. O `.com` custa pouco e evita que um vizinho colha o
seu tráfego — foi o defeito que eliminou o `horaboa`, cuja grafia natural
`boahora` é de terceiro.

Nada no código depende disso. Quando registrar, eu renomeio de Bom Horário
para Marca Direto num commit só; já mapeei os arquivos.

### 2.2 Consultar a marca no INPI

**https://busca.inpi.gov.br** — domínio livre não é marca livre. Faça antes de
gastar com identidade visual, não depois.

### 2.3 Subir o Docker uma vez

O `docker-compose.yml` é o único artefato do projeto que **nunca foi validado
de ponta a ponta**, porque o Docker nunca subiu nesta máquina. Se você abrir o
Docker Desktop e me avisar, eu rodo `npm run db:up` contra ele e conserto o
que estiver quebrado. Enquanto isso o Postgres local resolve, então não
bloqueia nada.

---

## 3. Só para ir ao ar — não bloqueia desenvolvimento

Estes dependem de análise de terceiro e levam dias ou semanas. Vale **começar
cedo** justamente por isso, mas nada aqui impede o projeto de ficar pronto.

### 3.1 Asaas de produção com split liberado

A conta de produção precisa de CNPJ e passa por análise. Subconta e split
costumam exigir liberação comercial — não vêm ligados por padrão. Abra o
chamado assim que tiver o CNPJ, porque é a fila mais lenta das três.

### 3.2 Meta: verificação de negócio e templates

Para falar com cliente de verdade, o número precisa sair do modo de teste:
verificação do negócio (documento do CNPJ) e **aprovação dos templates**, que
leva de horas a dois dias por template. Os textos dos templates eu preparo; a
submissão é na sua conta.

### 3.3 Stripe de produção

A conta que você criou já funciona em test mode, que é onde tudo foi provado.
Para cobrar de verdade falta completar o cadastro: CNPJ, conta bancária e
dados do responsável. **Atenção ao nome do negócio** — é ele que aparece na
fatura do cartão do dono do salão, e um nome que ele não reconheça vira
contestação.

### 3.4 Hospedagem

Ainda não conversamos sobre onde o produto vai rodar. Quando chegar a hora eu
te apresento as opções com prós e contras; hoje não é decisão urgente.

---

## O que já está pronto e não precisa de nada seu

- Produto inteiro funcionando contra mocks: portal, agendamento, painel,
  clube de assinatura, financeiro, notificações, privacidade, Super Admin.
- Cobrança B2B pelo Stripe **provada de ponta a ponta em test mode**: catálogo
  criado por script, Checkout hospedado, webhook assinado, portal do cliente
  com troca de plano e cancelamento desligados.
- 870 testes automatizados e 34 de ponta a ponta, verdes.

---

## Ordem que eu recomendo

1. **Asaas sandbox** (5 min) — é a fase maior que falta.
2. **WhatsApp número de teste** (10 min).
3. **Registrar os domínios** (15 min) — só porque somem.
4. O resto quando o CNPJ existir.

Com 1 e 2 feitos, o projeto inteiro fica ao meu alcance sem você precisar sair
do terminal de novo.
