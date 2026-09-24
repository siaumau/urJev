import { getSettings, saveSettings, validateEndpoint } from './settings.js';
const $ = id => document.getElementById(id);
const settings = await getSettings();
$('endpoint').value = settings.endpoint; $('query').value = settings.query; $('max-messages').value = settings.maxMessages; $('apply-labels').checked = settings.applyLabels;
$('origin').textContent = location.origin;
$('copy-origin').addEventListener('click', async () => { await navigator.clipboard.writeText(location.origin); $('status').textContent = 'Origin 已複製。'; });
$('save').addEventListener('click', async () => {
  try {
    const endpoint = validateEndpoint($('endpoint').value.trim());
    const maxMessages = Number($('max-messages').value);
    if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 50) throw new Error('載入數量必須是 1–50。');
    const query = $('query').value.trim(); if (!query) throw new Error('Gmail 搜尋條件不能留空。');
    await saveSettings({ endpoint, query, maxMessages, applyLabels: $('apply-labels').checked });
    $('status').textContent = '設定已儲存。';
  } catch (error) { $('status').textContent = error.message; }
});
