import { getSettings } from './settings.js';
import { getGmailToken, listMessages, loadMessageSummaries, getMessage, extractEmail, applyAiLabel } from './gmail-api.js';
import { analyzeEmail, CATEGORY_LABELS } from './urjev.js';

const $ = id => document.getElementById(id);
const SESSION_KEY = 'gmailAnalyzerPanelState';
const state = { token: null, settings: null, messages: [], elements: new Map(), results: new Map(), appliedIds: new Set(), working: false };

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

function renderMessages(selected = new Set(), reset = true) {
  $('messages').replaceChildren(); state.elements.clear();
  if (reset) { state.results.clear(); state.appliedIds.clear(); }
  for (const message of state.messages) {
    const node = $('message-template').content.firstElementChild.cloneNode(true);
    const pick = node.querySelector('.pick'); pick.dataset.id = message.id; pick.checked = selected.has(message.id);
    node.querySelector('.subject').textContent = message.subject;
    node.querySelector('.from').textContent = message.from;
    node.querySelector('.snippet').textContent = message.snippet;
    pick.addEventListener('change', () => { updateCounter(); persistSession().catch(console.error); });
    state.elements.set(message.id, node); $('messages').append(node);
    const result = state.results.get(message.id);
    if (result) showResult(message.id, result, state.appliedIds.has(message.id));
  }
  updateCounter();
}

async function restoreSession() {
  const saved = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY];
  if (!saved || !Array.isArray(saved.messages)) return;
  state.messages = saved.messages;
  state.results = new Map(Array.isArray(saved.results) ? saved.results : []);
  state.appliedIds = new Set(Array.isArray(saved.appliedIds) ? saved.appliedIds : []);
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
  node.querySelector('.detail').textContent = `${spam}・${result.mentionsTime ? '提到時間' : '未提到時間'}${applied ? '・已套用標籤' : ''}`;
}

async function checkUrjev() {
  const healthUrl = new URL('/api/health', state.settings.endpoint);
  const response = await fetch(healthUrl);
  const body = await response.json();
  if (!response.ok || !body.ready) throw new Error('urJev 模型尚未就緒，請先啟動 18000 與網頁服務。');
}

async function analyze() {
  const ids = selectedIds(); if (!ids.length) return;
  busy(true);
  try {
    state.token ??= await getGmailToken(false);
    await checkUrjev();
    for (const [index, id] of ids.entries()) {
      setStatus(`分析中 ${index + 1}/${ids.length}…`, 'working');
      const email = await extractEmail(state.token, await getMessage(state.token, id));
      const result = await analyzeEmail(email, state.settings.endpoint);
      state.results.set(id, result); state.appliedIds.delete(id);
      showResult(id, result, false); updateCounter();
      await persistSession();
    }
    setStatus(`完成 ${ids.length} 封郵件分析。確認結果後，按「執行分類」套用 AI 標籤。`);
  } catch (error) { setStatus(error.message, 'error'); }
  finally { busy(false); }
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

$('connect').addEventListener('click', connect);
$('load').addEventListener('click', load);
$('analyze').addEventListener('click', analyze);
$('classify').addEventListener('click', executeClassification);
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('select-all').addEventListener('change', event => { for (const input of document.querySelectorAll('.pick')) input.checked = event.target.checked; updateCounter(); persistSession().catch(console.error); });
$('scope').addEventListener('change', () => persistSession().catch(console.error));

state.settings = await getSettings();
$('endpoint').textContent = `urJev：${state.settings.endpoint}`;
const preset = [...$('scope').options].find(option => option.value === state.settings.query);
$('scope').value = preset ? preset.value : 'custom';
await restoreSession();
