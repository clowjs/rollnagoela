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

O cadastro, o nome do clã e o sorteio ficam em `data/state.json`, criado automaticamente. O servidor não tem login; compartilhe o endereço apenas em uma rede de confiança.

## Regras do sorteio

- O cadastro não tem limite fixo de jogadores; cada pessoa informa seu nome e sua spec atual. O sorteio só começa quando encontra uma composição válida com as specs disponíveis.
- A lista de jogadores aparece em ordem alfabética. Cada clique revela uma pessoa e uma spec; a fila de revelação é embaralhada a cada sorteio e as specs futuras permanecem no servidor.
- As primeiras até 13 escolhas usam classes diferentes e incluem exatamente dois tanks.
- A rodada seguinte não repete classes dentro dela. O planejador evita a classe atual de cada pessoa quando consegue fazer a distribuição.
- Specs sorteadas são únicas na raid e ninguém recebe a própria spec atual.
- A composição final tem exatamente 2 tanks, healers entre 20% e 25% do grupo e, entre os DPS, ao menos 20% melee e 50% ranged. Quando possível, melee e ranged ficam próximos de 50/50.
- O plano completo é validado antes de a primeira escolha aparecer. Se não houver uma combinação válida, o sorteio não começa.

O catálogo contém 13 classes e 40 specs, classificadas como tank, healer, DPS melee ou DPS ranged. As porcentagens de melee/ranged são calculadas sobre os DPS, não sobre tanks e healers.

O contador de jogadores mostra quantos resultados foram revelados (`0 / total` até `total / total`). Ao concluir, **Exportar** abre a lista `Jogador - Classe - Spec`, pronta para copiar.

## Desenvolvimento e testes

```bash
npm run dev
npm test
```

Reiniciar o sorteio apaga os resultados revelados, mas mantém o elenco e o nome do clã. É necessário reiniciar antes de editar os jogadores durante ou após um sorteio.
