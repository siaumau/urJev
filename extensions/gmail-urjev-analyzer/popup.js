import { getSettings } from './settings.js';
import { getGmailToken, listMessages, loadMessageSummaries, getMessage, extractEmail, applyUrjevLabel } from './gmail-api.js';
import { analyzeEmail, CATEGORY_LABELS } from './urjev.js';

const $ = id => document.getElementById(id);
const state = { token: null, settings: null, messages: [], elements: new Map() };

function setStatus(message, type = '') {
  $('status').textContent = message;
  $('status').className = `status ${type}`.trim();
}

function busy(value) {
  for (const id of ['connect', 'load', 'analyze']) $(id).disabled = value || (id === 'analyze' && !selectedIds().length);
}

function selectedIds() {
  return [...document.querySelectorAll('.pick:checked')].map(input => input.dataset.id);
}

function updateCounter() {
  const selected = selectedIds().length;
  $('counter').textContent = state.messages.length ? `${selected}/${state.messages.length} 封已勾選` : '尚未載入';
  $('analyze').disabled = !selected;
}

function renderMessages() {
  $('messages').replaceChildren(); state.elements.clear();
  for (const message of state.messages) {
    const node = $('message-template').content.firstElementChild.cloneNode(true);
    const pick = node.querySelector('.pick'); pick.dataset.id = message.id;
    node.querySelector('.subject').textContent = message.subject;
    node.querySelector('.from').textContent = message.from;
    node.querySelector('.snippet').textContent = message.snippet;
    pick.addEventListener('change', updateCounter);
    state.elements.set(message.id, node); $('messages').append(node);
  }
  updateCounter();
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
    const refs = await listMessages(state.token, state.settings.query, state.settings.maxMessages);
    state.messages = await loadMessageSummaries(state.token, refs);
    renderMessages();
    setStatus(state.messages.length ? `已載入 ${state.messages.length} 封郵件。勾選後開始分析。` : '查詢範圍內沒有郵件。');
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
      if (state.settings.applyLabels) await applyUrjevLabel(state.token, id, result.category);
      showResult(id, result, state.settings.applyLabels);
    }
    setStatus(`完成 ${ids.length} 封郵件分析。`);
  } catch (error) { setStatus(error.message, 'error'); }
  finally { busy(false); }
}

$('connect').addEventListener('click', connect);
$('load').addEventListener('click', load);
$('analyze').addEventListener('click', analyze);
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('select-all').addEventListener('change', event => { for (const input of document.querySelectorAll('.pick')) input.checked = event.target.checked; updateCounter(); });

state.settings = await getSettings();
$('endpoint').textContent = `urJev：${state.settings.endpoint}`;
