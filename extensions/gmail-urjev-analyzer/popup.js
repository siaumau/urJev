import { getSettings } from './settings.js';
import { getGmailToken, listMessages, loadMessageSummaries, getMessage, extractEmail, applyAiLabel } from './gmail-api.js';
import { analyzeEmail, CATEGORY_LABELS } from './urjev.js';
import { summarizeProgress } from './progress.js';
import { authenticatedSender, findLearnedCorrection, saveFeedback } from './feedback.js';

const $ = id => document.getElementById(id);
const SESSION_KEY = 'gmailAnalyzerPanelState';
const state = { token: null, settings: null, messages: [], elements: new Map(), results: new Map(), appliedIds: new Set(), working: false, analyzing: false, runIds: [], runCompletedIds: new Set(), runTotal: 0, panelPosition: { x: 0, y: 0 } };

function setStatus(message, type = '') {
  $('status').textContent = message;
  $('status').className = `status ${type}`.trim();
}

function busy(value) {
  state.working = value;
  for (const id of ['connect', 'load', 'analyze', 'classify', 'scope']) $(id).disabled = value;
  if (!value) updateCounter();
}

function selectedIds() {
  return [...document.querySelectorAll('.pick:checked')].map(input => input.dataset.id);
}

async function persistSession() {
  await chrome.storage.session.set({ [SESSION_KEY]: {
    messages: state.messages,
    results: [...state.results.entries()],
    appliedIds: [...state.appliedIds],
    selectedIds: selectedIds(),
    scope: $('scope').value,
    runIds: state.runIds,
    runCompletedIds: [...state.runCompletedIds],
    panelPosition: state.panelPosition,
    savedAt: Date.now()
  } });
}

function updateCounter() {
  const selected = selectedIds().length;
  $('counter').textContent = state.messages.length ? `${selected}/${state.messages.length} 封已勾選` : '尚未載入';
  const pending = [...state.results.keys()].filter(id => !state.appliedIds.has(id)).length;
  $('analyze').disabled = state.working || !selected;
  $('classify').disabled = state.working || !pending;
  $('classify').textContent = pending ? `執行分類 (${pending})` : '執行分類';
}

function updateProgress() {
  const panel = $('analysis-progress');
  const visible = state.analyzing || state.runTotal > 0 || state.results.size > 0;
  panel.classList.toggle('hidden', !visible);
  document.body.classList.toggle('has-progress', visible);
  if (!visible) return;

  const summary = summarizeProgress({ loadedCount: state.messages.length, runIds: state.runIds, completedIds: state.runCompletedIds, results: state.results, categories: Object.keys(CATEGORY_LABELS) });
  for (const node of document.querySelectorAll('[data-category-count]')) node.textContent = summary.counts[node.dataset.categoryCount] ?? 0;
  $('progress-loaded').textContent = summary.loaded;
  $('progress-target').textContent = summary.target;
  $('progress-analyzed').textContent = summary.done;
  $('progress-fraction').textContent = `${summary.done} / ${summary.target}`;
  $('progress-percent').textContent = `${summary.percent}%`;
  $('progress-phase').textContent = state.analyzing ? '正在分析' : summary.done < summary.target ? '分析已停止' : '分析完成';
  $('progress-bar').style.width = `${summary.percent}%`;
}

function applyPanelPosition() {
  $('analysis-progress').style.setProperty('--drag-x', `${state.panelPosition.x}px`);
  $('analysis-progress').style.setProperty('--drag-y', `${state.panelPosition.y}px`);
}

function renderMessages(selected = new Set(), reset = true) {
  $('messages').replaceChildren(); state.elements.clear();
  if (reset) { state.results.clear(); state.appliedIds.clear(); }
  for (const message of state.messages) {
    const node = $('message-template').content.firstElementChild.cloneNode(true);
    const pick = node.querySelector('.pick'); pick.dataset.id = message.id; pick.checked = selected.has(message.id);
    node.querySelector('.subject').textContent = message.subject;
    node.querySelector('.from').textContent = message.from;
    node.querySelector('.snippet').textContent = message.snippet;
    const correctionSelect = node.querySelector('.correction-select');
    for (const [value, label] of Object.entries(CATEGORY_LABELS)) correctionSelect.add(new Option(label, value));
    node.querySelector('.save-correction').addEventListener('click', () => saveCorrection(message.id).catch(error => setStatus(error.message, 'error')));
    pick.addEventListener('change', () => { updateCounter(); persistSession().catch(console.error); });
    state.elements.set(message.id, node); $('messages').append(node);
    const result = state.results.get(message.id);
    if (result) showResult(message.id, result, state.appliedIds.has(message.id));
  }
  updateCounter(); updateProgress();
}

async function restoreSession() {
  const saved = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
  if (!saved || !Array.isArray(saved.messages)) return;
  state.messages = saved.messages;
  state.results = new Map(Array.isArray(saved.results) ? saved.results : []);
  state.appliedIds = new Set(Array.isArray(saved.appliedIds) ? saved.appliedIds : []);
  const messageIds = new Set(state.messages.map(message => message.id));
  state.runIds = Array.isArray(saved.runIds) ? saved.runIds.filter(id => messageIds.has(id)) : [...state.results.keys()];
  const runIdSet = new Set(state.runIds);
  state.runCompletedIds = new Set(Array.isArray(saved.runCompletedIds) ? saved.runCompletedIds.filter(id => runIdSet.has(id) && state.results.has(id)) : state.runIds);
  state.runTotal = state.runIds.length;
  if (Number.isFinite(saved.panelPosition?.x) && Number.isFinite(saved.panelPosition?.y)) state.panelPosition = saved.panelPosition;
  applyPanelPosition();
  if ([...$('scope').options].some(option => option.value === saved.scope)) $('scope').value = saved.scope;
  renderMessages(new Set(Array.isArray(saved.selectedIds) ? saved.selectedIds : []), false);
  if (state.messages.length) setStatus(`已還原 ${state.messages.length} 封郵件與分析進度。`);
}

async function connect() {
  busy(true); setStatus('正在開啟 Google 授權…', 'working');
  try { state.token = await getGmailToken(true); setStatus('Gmail 已連接，可以載入郵件。'); }
  catch (error) { setStatus(error.message, 'error'); }
  finally { busy(false); }
}

async function load() {
  busy(true); setStatus('正在讀取 Gmail 郵件清單…', 'working');
  try {
    state.token ??= await getGmailToken(false);
    const selectedScope = $('scope').value;
    const query = selectedScope === 'custom' ? state.settings.query : selectedScope;
    const refs = await listMessages(state.token, query, state.settings.maxMessages);
    state.messages = await loadMessageSummaries(state.token, refs);
    state.runIds = []; state.runCompletedIds.clear(); state.runTotal = 0; state.analyzing = false;
    renderMessages();
    setStatus(state.messages.length ? `已載入 ${state.messages.length} 封郵件（上限 ${state.settings.maxMessages}）。勾選後開始分析。` : '查詢範圍內沒有郵件。');
    await persistSession();
  } catch (error) { setStatus(error.message, 'error'); }
  finally { busy(false); }
}

function showResult(id, result, applied) {
  const node = state.elements.get(id), box = node.querySelector('.result'), badge = node.querySelector('.badge');
  box.classList.remove('hidden'); badge.textContent = CATEGORY_LABELS[result.category];
  badge.className = `badge ${result.category === 'possible_spam' ? 'spam' : result.category === 'important_urgent' ? 'urgent' : ''}`.trim();
  const spam = { likely_spam: '垃圾：可能', not_spam: '垃圾：否', unclear: '垃圾：不明' }[result.spam] ?? '垃圾：不明';
  const source = result.correctedByUser ? '・人工修正' : result.learnedOverride ? '・依校正記憶' : '';
  node.querySelector('.detail').textContent = `${spam}・${result.mentionsTime ? '提到時間' : '未提到時間'}${source}${applied ? '・已套用標籤' : ''}`;
  node.querySelector('.correction').classList.remove('hidden');
  node.querySelector('.correction-select').value = result.category;
  node.querySelector('.correction-status').textContent = result.learnedOverride ? '已依過去修正自動調整，可再次更改。' : result.correctedByUser ? '此分類已加入本機校正記憶。' : '';
}

async function saveCorrection(id) {
  const result = state.results.get(id), node = state.elements.get(id), message = state.messages.find(item => item.id === id);
  if (!result || !node || !message) return;
  const correctedCategory = node.querySelector('.correction-select').value;
  if (!(correctedCategory in CATEGORY_LABELS)) throw new Error('不支援這個分類。');
  await saveFeedback(result.feedbackContext ?? message, result.modelCategory ?? result.category, correctedCategory);
  state.results.set(id, { ...result, category: correctedCategory, modelCategory: result.modelCategory ?? result.category, correctedByUser: true, learnedOverride: false });
  state.appliedIds.delete(id);
  showResult(id, state.results.get(id), false); updateCounter(); updateProgress(); await persistSession();
  node.querySelector('.correction-status').textContent = '已儲存；相同寄件者且主旨相近的郵件會優先使用這個分類。';
}

async function checkUrjev() {
  const healthUrl = new URL('/api/health', state.settings.endpoint);
  const response = await fetch(healthUrl);
  const body = await response.json();
  if (!response.ok || !body.ready) throw new Error('urJev 模型尚未就緒，請先啟動 18000 與網頁服務。');
}

async function analyze() {
  const ids = selectedIds(); if (!ids.length) return;
  state.runIds = [...ids]; state.runCompletedIds.clear(); state.runTotal = ids.length; state.analyzing = true; updateProgress();
  busy(true);
  try {
    await persistSession();
    state.token ??= await getGmailToken(false);
    await checkUrjev();
    for (const [index, id] of ids.entries()) {
      setStatus(`分析中 ${index + 1}/${ids.length}…`, 'working');
      const email = await extractEmail(state.token, await getMessage(state.token, id));
      const modelResult = await analyzeEmail(email, state.settings.endpoint);
      const learned = await findLearnedCorrection(email, modelResult.category);
      const feedbackContext = { subject: email.subject, from: email.from, authenticated: authenticatedSender(email) };
      const result = learned && learned.category in CATEGORY_LABELS
        ? { ...modelResult, modelCategory: modelResult.category, category: learned.category, learnedOverride: true, learnedReason: learned.reason, feedbackContext }
        : { ...modelResult, modelCategory: modelResult.category, feedbackContext };
      state.results.set(id, result); state.appliedIds.delete(id);
      state.runCompletedIds.add(id);
      showResult(id, result, false); updateCounter(); updateProgress();
      await persistSession();
    }
    setStatus(`完成 ${ids.length} 封郵件分析。確認結果後，按「執行分類」套用 AI 標籤。`);
  } catch (error) { setStatus(error.message, 'error'); }
  finally { state.analyzing = false; updateProgress(); busy(false); }
}

async function executeClassification() {
  const entries = [...state.results.entries()].filter(([id]) => !state.appliedIds.has(id));
  if (!entries.length) return;
  busy(true);
  try {
    state.token ??= await getGmailToken(false);
    for (const [index, [id, result]] of entries.entries()) {
      setStatus(`執行分類中 ${index + 1}/${entries.length}…`, 'working');
      await applyAiLabel(state.token, id, result.category, { archive: state.settings.archiveAfterApply });
      state.appliedIds.add(id); showResult(id, result, true);
      await persistSession();
    }
    const suffix = state.settings.archiveAfterApply ? '，並已移出 Inbox。' : '。郵件仍保留在 Inbox。';
    setStatus(`已將 ${entries.length} 封郵件放入 AI 分類標籤${suffix}`);
  } catch (error) { setStatus(error.message, 'error'); }
  finally { busy(false); }
}

function enableProgressDrag() {
  const panel = $('analysis-progress'), handle = panel.querySelector('.progress-header'); let drag = null;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  handle.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    const rect = panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect, origin: { ...state.panelPosition } };
    handle.setPointerCapture(event.pointerId); panel.classList.add('dragging'); event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = clamp(event.clientX - drag.x, 8 - drag.rect.left, innerWidth - 8 - drag.rect.right);
    const dy = clamp(event.clientY - drag.y, 8 - drag.rect.top, innerHeight - 8 - drag.rect.bottom);
    state.panelPosition = { x: Math.round(drag.origin.x + dx), y: Math.round(drag.origin.y + dy) };
    applyPanelPosition();
  });
  const finish = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    drag = null; panel.classList.remove('dragging'); persistSession().catch(console.error);
  };
  handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
  window.addEventListener('resize', () => {
    state.panelPosition = { x: 0, y: 0 }; applyPanelPosition(); persistSession().catch(console.error);
  });
}

$('connect').addEventListener('click', connect);
$('load').addEventListener('click', load);
$('analyze').addEventListener('click', analyze);
$('classify').addEventListener('click', executeClassification);
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('select-all').addEventListener('change', event => { for (const input of document.querySelectorAll('.pick')) input.checked = event.target.checked; updateCounter(); persistSession().catch(console.error); });
$('scope').addEventListener('change', () => persistSession().catch(console.error));
$('progress-toggle').addEventListener('click', () => {
  const collapsed = $('analysis-progress').classList.toggle('collapsed');
  $('progress-toggle').textContent = collapsed ? '+' : '−';
  $('progress-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('progress-toggle').setAttribute('aria-label', collapsed ? '展開分析統計' : '收合分析統計');
  document.body.classList.toggle('progress-collapsed', collapsed);
});
enableProgressDrag();

state.settings = await getSettings();
$('endpoint').textContent = `urJev：${state.settings.endpoint}`;
const preset = [...$('scope').options].find(option => option.value === state.settings.query);
$('scope').value = preset ? preset.value : 'custom';
await restoreSession();
