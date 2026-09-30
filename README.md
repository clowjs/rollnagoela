# Roll na Goela

Sorteador de classes e especializações para uma raid de World of Warcraft. A interface e a API rodam no mesmo processo Node.js; não há frontend/backend separados nem dependências externas.

## Executar

Requer Node.js 20 ou mais recente.

```bash
npm start
```

Abra [http://localhost:3000](http://localhost:3000). Para usar na rede local durante a chamada, inicie o servidor aceitando conexões da rede:

```powershell
$env:HOST="0.0.0.0"; npm start
```

O cadastro, o nome do clã e o sorteio ficam em `data/state.json`, criado automaticamente. O acesso ao app e à API exige a senha compartilhada do grupo; ainda assim, use o endereço apenas em uma rede de confiança.

## Acesso por senha

O servidor valida a senha usando PBKDF2 e guarda somente o salt e o hash em `server.js`. Após entrar, o navegador salva um token de acesso no `localStorage`; não há sessão ou banco de dados no deploy. Para trocar a senha, gere um novo salt/hash com `crypto.pbkdf2Sync` e atualize as constantes `ACCESS_PASSWORD_SALT` e `ACCESS_PASSWORD_HASH` em `server.js`. Essa barreira é para uso casual do grupo, não substitui autenticação robusta.

## Regras do sorteio

- O cadastro não tem limite fixo de jogadores; cada pessoa informa seu nome e sua spec atual. O sorteio só começa quando encontra uma composição válida com as specs disponíveis.
- A lista de jogadores aparece em ordem alfabética. Ao começar ou continuar, o modal mostra primeiro a pessoa sorteada. O botão `/roll` inicia a roleta da spec; **Sortear próxima pessoa** avança somente depois do roll atual. A fila é embaralhada a cada sorteio e as specs futuras permanecem no servidor.
- Com o modal fechado e o sorteio em andamento, clicar no cartão de uma pessoa sem spec seleciona essa pessoa e abre a etapa `/roll`; clicar no cartão de alguém já rolado abre o modal de `/reroll`.
- As primeiras até 13 escolhas usam classes diferentes e incluem exatamente dois tanks.
- A rodada seguinte não repete classes dentro dela. O planejador evita a classe atual de cada pessoa quando consegue fazer a distribuição.
- Specs sorteadas são únicas na raid e ninguém recebe a própria spec atual.
- Depois de revelada, uma pessoa pode receber reroll clicando no seu cartão ou no botão ↻; no modal, `/roll` rola uma nova spec para ela. O reroll mantém a role e a spec não se repete; primeiro tenta trocar também de classe. Se não houver uma classe livre e ninguém ainda não revelado puder trocar com ela, a nova classe pode se repetir.
- A composição final tem exatamente 2 tanks, healers entre 20% e 25% do grupo e, entre os DPS, ao menos 20% melee e 50% ranged. Quando possível, melee e ranged ficam próximos de 50/50.
- O plano completo é validado antes de a primeira escolha aparecer. Se não houver uma combinação válida, o sorteio não começa.

O catálogo contém 13 classes e 40 specs, classificadas como tank, healer, DPS melee ou DPS ranged. As porcentagens de melee/ranged são calculadas sobre os DPS, não sobre tanks e healers.

O contador de jogadores mostra quantas specs foram roladas (`0 / total` até `total / total`). Fechar o modal mantém o progresso; **Continuar sorteio** reabre na pessoa/etapa atual. Depois do último roll, o sorteio se conclui automaticamente e o X fecha o modal. **Exportar** abre a lista `Jogador - Classe - Spec`, pronta para copiar.

Cada `/roll` e reroll tem 20 segundos de animação de suspense antes de mostrar o resultado.

## Desenvolvimento e testes

```bash
npm run dev
npm test
```

Reiniciar o sorteio apaga os resultados revelados, mas mantém o elenco e o nome do clã. É necessário reiniciar antes de editar os jogadores durante ou após um sorteio.
