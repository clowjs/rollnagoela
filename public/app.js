const ROLE_LABELS = {
  tank: 'Tank',
  healer: 'Healer',
  melee: 'Melee DPS',
  ranged: 'Ranged DPS',
};
const ROLL_DURATION_MS = 7000;

const elements = {
  addPlayer: document.getElementById('add-player'),
  brandName: document.getElementById('brand-clan-name'),
  clanDialog: document.getElementById('clan-dialog'),
  clanForm: document.getElementById('clan-form'),
  clanNameInput: document.getElementById('clan-name-input'),
  counter: document.getElementById('draw-counter'),
  currentSpec: document.getElementById('current-spec'),
  feedback: document.getElementById('feedback-message'),
  exportButton: document.getElementById('export-results'),
  exportDialog: document.getElementById('export-dialog'),
  exportList: document.getElementById('export-list'),
  copyExport: document.getElementById('copy-export'),
  mainAction: document.getElementById('main-action'),
  mainActionLabel: document.getElementById('main-action-label'),
  playerCount: document.getElementById('player-count'),
  playerDialog: document.getElementById('player-dialog'),
  playerForm: document.getElementById('player-form'),
  playerId: document.getElementById('player-id'),
  playerName: document.getElementById('player-name'),
  playerSuccess: document.getElementById('player-success'),
  playerSuccessText: document.getElementById('player-success-text'),
  playerTitle: document.getElementById('player-dialog-title'),
  players: document.getElementById('roster-list'),
  resetDraw: document.getElementById('reset-draw'),
  rollStage: document.getElementById('roll-stage'),
  rollStagePlayer: document.getElementById('roll-stage-player'),
  rollStageTitle: document.getElementById('roll-stage-title'),
  rollStageValue: document.getElementById('roll-stage-value'),
  roleSummary: document.getElementById('role-summary'),
  toast: document.getElementById('toast'),
  closeRollStage: document.getElementById('close-roll-stage'),
  rollStageHint: document.getElementById('roll-stage-hint'),
  rollStageActions: document.querySelector('.roll-stage-actions'),
  rollStart: document.getElementById('roll-start'),
  rollNext: document.getElementById('roll-next'),
};

let state = null;
let busy = false;
let toastTimer = null;
let highlightedPlayerId = null;
let rollStageMode = 'sequence';
let manualRerollPlayerId = null;
let cancelPendingRoll = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function getCatalogLookups() {
  const classes = new Map(state.catalog.map((wowClass) => [wowClass.id, wowClass]));
  const specs = new Map();
  for (const wowClass of state.catalog) {
    for (const spec of wowClass.specs) {
      specs.set(spec.id, { ...spec, classId: wowClass.id, className: wowClass.name });
    }
  }
  return { classes, specs };
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3000);
}

function showFeedback(message) {
  elements.feedback.textContent = message;
  elements.feedback.hidden = false;
}

function clearFeedback() {
  elements.feedback.textContent = '';
  elements.feedback.hidden = true;
}

function clearPlayerSuccess() {
  elements.playerSuccess.hidden = true;
  elements.playerSuccess.classList.remove('is-visible');
}

function showPlayerSuccess(message) {
  elements.playerSuccessText.textContent = message;
  elements.playerSuccess.hidden = false;
  elements.playerSuccess.classList.remove('is-visible');
  void elements.playerSuccess.offsetWidth;
  elements.playerSuccess.classList.add('is-visible');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Resposta inválida do servidor.');
  }
  if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
  return payload;
}

function renderHeader() {
  if (!state) return;
  elements.brandName.textContent = state.clanName;
  document.title = `${state.clanName} — Sorteio de specs`;
  const totalPlayers = state.players.length;
  const drawnPlayers = state.draw?.revealedCount || 0;
  elements.playerCount.textContent = `${drawnPlayers} / ${totalPlayers}`;

  elements.counter.textContent = state.draw
    ? state.draw.status === 'complete'
      ? state.draw.finalized ? 'Sorteio concluído' : 'Todos rolados'
      : 'Sorteio em andamento'
    : totalPlayers ? `${totalPlayers} cadastrados` : 'Cadastre jogadores';

  const complete = state.draw && state.draw.revealedCount >= state.draw.total;
  const finalized = Boolean(state.draw?.finalized);
  elements.addPlayer.disabled = busy || Boolean(state.draw);
  elements.mainAction.disabled = busy || (!state.draw && totalPlayers < 2) || finalized;
  elements.exportButton.disabled = busy || !complete;
  elements.mainActionLabel.textContent = busy
    ? 'Sorteando…'
    : finalized
      ? 'Concluído'
      : !state.draw && totalPlayers < 2
        ? `Falta${totalPlayers === 0 ? 'm' : ''} ${2 - totalPlayers}`
        : state.draw ? 'Continuar sorteio' : 'Sortear pessoa';
  elements.resetDraw.disabled = busy || !state.draw;
}

function renderRoleSummary() {
  const counts = Object.fromEntries(Object.keys(ROLE_LABELS).map((role) => [role, 0]));
  for (const assignment of state.draw?.assignments || []) {
    if (counts[assignment.role] !== undefined) counts[assignment.role] += 1;
  }

  elements.roleSummary.innerHTML = Object.entries(ROLE_LABELS).map(([role, label]) => `
    <div class="role-stat" data-role="${role}">
      <span class="role-stat-name">${escapeHtml(label)}</span>
      <strong class="role-stat-count">${counts[role]}</strong>
    </div>`).join('');
}

function renderRoster() {
  const { specs } = getCatalogLookups();
  const assignments = new Map((state.draw?.assignments || []).map((assignment) => [assignment.playerId, assignment]));
  const latest = state.draw?.assignments.at(-1);
  const locked = Boolean(state.draw);
  const players = [...state.players].sort((left, right) => (
    left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' })
    || left.id.localeCompare(right.id)
  ));

  if (!players.length) {
    elements.players.innerHTML = '<div class="roster-empty"><span class="roster-empty-mark" aria-hidden="true">+</span><strong>Nenhum jogador cadastrado</strong><small>Use Cadastrar para montar seu elenco.</small></div>';
    return;
  }

  elements.players.innerHTML = players.map((player) => {
    const current = specs.get(player.currentSpecId);
    const assignment = assignments.get(player.id);
    const isSelected = !assignment && state.draw?.activePlayer?.playerId === player.id;
    const isLatest = assignment && (highlightedPlayerId
      ? highlightedPlayerId === player.id
      : latest?.playerId === player.id);
    const assignmentDetails = assignment
      ? `${assignment.specName} · ${assignment.className} · ${ROLE_LABELS[assignment.role]}`
      : 'Sem resultado';
    const currentTitle = current ? `Atual: ${current.name} · ${current.className}` : 'Spec atual não encontrada';
    const initial = player.name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '?';
    const actions = locked
      ? assignment
        ? `<div class="player-actions">
            <button class="row-action row-action-reroll" type="button" data-action="reroll" data-player-id="${escapeHtml(player.id)}" aria-label="Sortear outra spec para ${escapeHtml(player.name)}" title="Reroll individual"><span aria-hidden="true">↻</span><span aria-hidden="true">Reroll</span></button>
          </div>`
        : ''
      : `<div class="player-actions">
          <button class="row-action" type="button" data-action="edit" data-player-id="${escapeHtml(player.id)}" aria-label="Editar ${escapeHtml(player.name)}" title="Editar">✎</button>
          <button class="row-action delete" type="button" data-action="delete" data-player-id="${escapeHtml(player.id)}" aria-label="Remover ${escapeHtml(player.name)}" title="Remover">×</button>
        </div>`;

    return `
      <article class="player-card${state.draw ? ' is-selectable' : ''}${isLatest ? ' is-latest' : ''}${isSelected ? ' is-selected' : ''}" data-player-id="${escapeHtml(player.id)}">
        <div class="player-card-heading">
          <span class="player-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
          <div class="player-identity">
            <strong class="player-name" title="${escapeHtml(player.name)}">${escapeHtml(player.name)}</strong>
            <small class="player-current" title="${escapeHtml(currentTitle)}">Atual · ${escapeHtml(current ? `${current.name} · ${current.className}` : 'Spec não encontrada')}</small>
          </div>
          ${actions}
        </div>
        <div class="player-result${assignment ? ' has-assignment' : ' is-empty'}"${assignment ? ` data-role="${escapeHtml(assignment.role)}"` : ''} title="${escapeHtml(assignmentDetails)}">
          <strong class="player-assigned${assignment ? '' : ' is-empty'}">${escapeHtml(assignment ? `${assignment.specName} ${assignment.className}` : 'Sem resultado')}</strong>
          ${assignment ? `<span class="role-tag" data-role="${escapeHtml(assignment.role)}">${escapeHtml(ROLE_LABELS[assignment.role])}</span>` : ''}
        </div>
      </article>`;
  }).join('');
}

function render() {
  if (!state) return;
  renderHeader();
  renderRoleSummary();
  renderRoster();
}

function setBusy(value) {
  busy = value;
  renderHeader();
  for (const button of [elements.rollStart, elements.rollNext]) {
    button.disabled = busy;
  }
}

function renderRollStage() {
  const draw = state?.draw;
  if (!draw) return;

  const manual = rollStageMode === 'manual';
  const playerId = manual ? manualRerollPlayerId : draw.activePlayer?.playerId;
  const assignment = draw.assignments.find((candidate) => candidate.playerId === playerId);
  const player = state.players.find((candidate) => candidate.id === playerId);
  const playerName = player?.name || assignment?.playerName || draw.activePlayer?.playerName || 'Jogador';
  const hasResult = Boolean(assignment);
  const allPlayersHaveSpecs = state.players.every((candidate) => (
    draw.assignments.some((rolled) => rolled.playerId === candidate.id)
  ));

  elements.rollStage.classList.remove('is-rolling');
  elements.rollStageTitle.textContent = manual ? 'Reroll para esta pessoa' : hasResult ? 'Spec sorteada' : 'Pessoa sorteada';
  elements.rollStagePlayer.textContent = playerName;
  elements.rollStageValue.textContent = hasResult
    ? `${assignment.specName} · ${assignment.className}`
    : '';
  elements.rollStageHint.hidden = !hasResult;
  elements.rollStageHint.textContent = hasResult ? `Role: ${ROLE_LABELS[assignment.role]}` : '';

  elements.rollStart.hidden = false;
  elements.rollNext.hidden = !hasResult || manual || allPlayersHaveSpecs;
  elements.rollStageActions.hidden = elements.rollStart.hidden && elements.rollNext.hidden;
  for (const button of [elements.rollStart, elements.rollNext]) {
    button.disabled = busy;
  }
}

function openRollStage(mode = 'sequence', playerId = null) {
  rollStageMode = mode;
  manualRerollPlayerId = mode === 'manual' ? playerId : null;
  renderRollStage();
  if (!elements.rollStage.open) elements.rollStage.showModal();
}

function startRollAnimation(playerName) {
  const specs = state.catalog.flatMap((wowClass) => wowClass.specs.map((spec) => ({
    ...spec,
    className: wowClass.name,
  })));
  elements.rollStage.classList.add('is-rolling');
  elements.rollStageTitle.textContent = `Rolando a spec de ${playerName}`;
  elements.rollStagePlayer.textContent = playerName;
  elements.rollStageHint.hidden = false;
  elements.rollStageHint.textContent = 'A roleta está girando...';
  elements.rollStart.hidden = true;
  elements.rollNext.hidden = true;
  elements.rollStageActions.hidden = true;

  const showRandomSpec = () => {
    const spec = specs[Math.floor(Math.random() * specs.length)];
    elements.rollStageValue.textContent = `${spec.name} · ${spec.className}`;
  };
  showRandomSpec();
  return window.setInterval(showRandomSpec, 115);
}

async function drawNext() {
  if (busy || !state) return;
  clearFeedback();
  if (state.draw) {
    openRollStage('sequence');
    return;
  }

  setBusy(true);
  try {
    state = await api('/api/draw/start', { method: 'POST' });
    highlightedPlayerId = null;
    render();
    openRollStage('sequence');
  } catch (error) {
    showFeedback(error.message);
  } finally {
    setBusy(false);
  }
}

async function spinAndRoll(playerId, endpoint) {
  if (busy || !state?.draw) return;
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return;

  clearFeedback();
  setBusy(true);
  const interval = startRollAnimation(player.name);
  let rolledAssignment = null;
  let error = null;
  try {
    const shouldCommit = await new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        if (cancelPendingRoll === cancel) cancelPendingRoll = null;
        resolve(true);
      }, ROLL_DURATION_MS);
      const cancel = () => {
        window.clearTimeout(timeout);
        if (cancelPendingRoll === cancel) cancelPendingRoll = null;
        resolve(false);
      };
      cancelPendingRoll = cancel;
    });
    if (!shouldCommit) return;
    state = await api(endpoint, { method: 'POST' });
    rolledAssignment = state.draw.assignments.find((assignment) => assignment.playerId === playerId);
    highlightedPlayerId = playerId;
    render();
  } catch (caughtError) {
    error = caughtError;
  } finally {
    window.clearInterval(interval);
    elements.rollStage.classList.remove('is-rolling');
    setBusy(false);
    if (elements.rollStage.open) {
      renderRollStage();
      if (error) {
        elements.rollStageHint.hidden = false;
        elements.rollStageHint.textContent = error.message;
      }
    }
    if (error) showToast(error.message);
    else if (!elements.rollStage.open && rolledAssignment) {
      showToast(`${rolledAssignment.playerName}: ${rolledAssignment.specName} · ${rolledAssignment.className}`);
    }
  }
}

function rollSelectedSpec() {
  const playerId = rollStageMode === 'manual'
    ? manualRerollPlayerId
    : state?.draw?.activePlayer?.playerId;
  if (!playerId) return;
  const alreadyRolled = state.draw.assignments.some((assignment) => assignment.playerId === playerId);
  const endpoint = alreadyRolled
    ? `/api/draw/reroll/${encodeURIComponent(playerId)}`
    : '/api/draw/roll';
  return spinAndRoll(playerId, endpoint);
}

async function selectNextPlayer() {
  if (busy || !state?.draw) return;
  setBusy(true);
  try {
    state = await api('/api/draw/next', { method: 'POST' });
    highlightedPlayerId = null;
    render();
    if (elements.rollStage.open) renderRollStage();
  } catch (error) {
    if (elements.rollStage.open) {
      elements.rollStageHint.hidden = false;
      elements.rollStageHint.textContent = error.message;
    }
    else showToast(error.message);
  } finally {
    setBusy(false);
  }
}

function rerollPlayer(playerId) {
  if (busy || !state?.draw) return;
  if (!state.draw.assignments.some((assignment) => assignment.playerId === playerId)) return;
  openRollStage('manual', playerId);
}

async function selectPlayerForRoll(playerId) {
  if (busy || !state?.draw) return;
  const assignment = state.draw.assignments.find((candidate) => candidate.playerId === playerId);
  if (assignment) {
    rerollPlayer(playerId);
    return;
  }
  if (state.draw.finalized) return;

  setBusy(true);
  try {
    state = await api(`/api/draw/select/${encodeURIComponent(playerId)}`, { method: 'POST' });
    highlightedPlayerId = null;
    render();
    openRollStage('sequence');
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

function populateCurrentSpecSelect(selectedId) {
  elements.currentSpec.innerHTML = '<option value="" disabled selected>Selecione uma spec</option>' + state.catalog.map((wowClass) => `
    <optgroup label="${escapeHtml(wowClass.name)}">
      ${wowClass.specs.map((spec) => `<option value="${escapeHtml(spec.id)}">${escapeHtml(spec.name)} — ${escapeHtml(ROLE_LABELS[spec.role])}</option>`).join('')}
    </optgroup>`).join('');
  if (selectedId) elements.currentSpec.value = selectedId;
}

function openPlayerDialog(playerId) {
  if (state.draw || busy) return;
  const player = playerId ? state.players.find((candidate) => candidate.id === playerId) : null;
  if (playerId && !player) return;
  clearPlayerSuccess();
  elements.playerForm.reset();
  elements.playerId.value = player?.id || '';
  elements.playerName.value = player?.name || '';
  elements.playerTitle.textContent = player ? 'Editar jogador' : 'Cadastrar jogador';
  populateCurrentSpecSelect(player?.currentSpecId);
  elements.playerDialog.showModal();
  requestAnimationFrame(() => elements.playerName.focus());
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
}

async function savePlayer(event) {
  event.preventDefault();
  if (busy) return;
  const playerId = elements.playerId.value;
  const isNewPlayer = !playerId;
  const payload = { name: elements.playerName.value, currentSpecId: elements.currentSpec.value };
  const normalizedName = payload.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  const duplicateName = state.players.some((player) => (
    player.id !== playerId && player.name.toLocaleLowerCase('pt-BR') === normalizedName
  ));
  const submit = elements.playerForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const updated = await api(playerId ? `/api/players/${encodeURIComponent(playerId)}` : '/api/players', {
      method: playerId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    state = updated;
    render();
    if (isNewPlayer) {
      elements.playerForm.reset();
      showPlayerSuccess(duplicateName
        ? 'Jogador cadastrado. Use apelidos para diferenciar nomes iguais.'
        : 'Jogador cadastrado com sucesso! Pode adicionar o próximo.');
      requestAnimationFrame(() => elements.playerName.focus());
    } else {
      closeDialog(elements.playerDialog);
      showToast(duplicateName ? 'Jogador salvo. Use apelidos para diferenciar nomes iguais.' : 'Jogador salvo.');
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function removePlayer(playerId) {
  if (state.draw || busy) return;
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || !window.confirm(`Remover ${player.name}?`)) return;
  try {
    state = await api(`/api/players/${encodeURIComponent(playerId)}`, { method: 'DELETE' });
    render();
    showToast('Jogador removido.');
  } catch (error) {
    showToast(error.message);
  }
}

async function saveClanName(event) {
  event.preventDefault();
  const submit = elements.clanForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    state = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ clanName: elements.clanNameInput.value }),
    });
    closeDialog(elements.clanDialog);
    render();
    showToast('Nome atualizado.');
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function resetDraw() {
  if (!state.draw || busy) return;
  if (!window.confirm('Reiniciar o sorteio? O elenco será mantido.')) return;
  clearFeedback();
  setBusy(true);
  try {
    state = await api('/api/draw/reset', { method: 'POST' });
    highlightedPlayerId = null;
    render();
    showToast('Sorteio reiniciado.');
  } catch (error) {
    showFeedback(error.message);
  } finally {
    setBusy(false);
  }
}

function openExportDialog() {
  if (state?.draw?.status !== 'complete') return;
  const rows = [...state.draw.assignments]
    .sort((left, right) => left.playerName.localeCompare(right.playerName, 'pt-BR', { sensitivity: 'base' }))
    .map((assignment) => `${assignment.playerName} - ${assignment.className} - ${assignment.specName}`);
  elements.exportList.value = rows.join('\n');
  elements.exportDialog.showModal();
  requestAnimationFrame(() => {
    elements.exportList.focus();
    elements.exportList.select();
  });
}

async function copyExportList() {
  const text = elements.exportList.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    elements.exportList.focus();
    elements.exportList.select();
    if (!document.execCommand('copy')) {
      showToast('Selecione a lista e use Ctrl+C.');
      return;
    }
  }
  showToast('Lista copiada.');
}

function bindEvents() {
  elements.addPlayer.addEventListener('click', () => openPlayerDialog());
  elements.mainAction.addEventListener('click', drawNext);
  elements.resetDraw.addEventListener('click', resetDraw);
  elements.exportButton.addEventListener('click', openExportDialog);
  elements.copyExport.addEventListener('click', copyExportList);
  elements.closeRollStage.addEventListener('click', () => closeDialog(elements.rollStage));
  elements.rollStart.addEventListener('click', rollSelectedSpec);
  elements.rollNext.addEventListener('click', selectNextPlayer);
  elements.rollStage.addEventListener('close', () => {
    if (cancelPendingRoll) cancelPendingRoll();
    rollStageMode = 'sequence';
    manualRerollPlayerId = null;
  });
  elements.playerForm.addEventListener('submit', savePlayer);
  elements.playerForm.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || !(event.target instanceof HTMLSelectElement)) return;
    event.preventDefault();
    event.stopPropagation();
    elements.playerForm.requestSubmit();
  }, true);
  elements.playerForm.addEventListener('input', clearPlayerSuccess);
  elements.playerForm.addEventListener('change', clearPlayerSuccess);
  elements.clanForm.addEventListener('submit', saveClanName);

  document.getElementById('open-clan-dialog').addEventListener('click', () => {
    elements.clanNameInput.value = state?.clanName || '';
    elements.clanDialog.showModal();
    requestAnimationFrame(() => elements.clanNameInput.focus());
  });

  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-close-dialog]');
    if (closeButton) closeDialog(document.getElementById(closeButton.dataset.closeDialog));
  });

  elements.players.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) {
      if (button.dataset.action === 'edit') openPlayerDialog(button.dataset.playerId);
      if (button.dataset.action === 'delete') removePlayer(button.dataset.playerId);
      if (button.dataset.action === 'reroll') rerollPlayer(button.dataset.playerId);
      return;
    }

    const card = event.target.closest('.player-card[data-player-id]');
    if (card && state?.draw) selectPlayerForRoll(card.dataset.playerId);
  });
}

async function initialize() {
  bindEvents();
  try {
    state = await api('/api/state');
    render();
  } catch (error) {
    elements.counter.textContent = 'Servidor indisponível';
    elements.mainActionLabel.textContent = 'Indisponível';
    showFeedback(error.message);
  }
}

initialize();
