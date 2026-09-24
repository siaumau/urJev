# urJev Gmail 郵件分析器

Chrome Manifest V3 子專案。外掛透過 Gmail 官方 API 讀取使用者選定範圍內的郵件，將郵件本文送到本機 urJev OneForward，再顯示或套用 Gmail 標籤。

## 分類結果

垃圾郵件判斷與工作分類會同時執行，最後套用一個主要標籤：

| 標籤 | 條件 |
|---|---|
| `AI/可能詐騙` | 寄件身分、驗證網域或回覆路徑不吻合，並伴隨金錢、帳密、敏感資料或惡意操作誘導等明確詐騙訊號 |
| `AI/可能垃圾` | 有明確垃圾、釣魚、欺騙或未經請求大量濫發訊號 |
| `AI/重要/緊急` | 重要，而且有明確近期時間壓力 |
| `AI/重要/不緊急` | 重要，但可以稍後處理 |
| `AI/行銷` | 主要目的是產品／服務推廣、折扣、活動導購、品牌宣傳或商業轉換 |
| `AI/新知` | 主要目的是分享教學、研究、產業趨勢、技術文章、專業觀點或知識整理 |
| `AI/次要` | 有內容價值但優先度較低 |
| `AI/時間相關` | 未歸入重要或次要，但本文明確提到日期、時間、期限或行程 |
| `AI/未分類` | 現有內容不足或不符合上述條件 |

外掛先顯示分析結果供使用者確認，只有按下「執行分類」才會修改 Gmail 標籤。它不會把郵件移到垃圾桶，也不會自動刪除郵件。預設在執行分類後移出 Inbox，這是 Gmail 的封存行為，郵件仍可從 `AI/*` 標籤與「所有郵件」找到；完成後該批郵件也會立刻從外掛清單移除，之後載入時會排除所有已有 `AI/*` 分類標籤的郵件。按「載入郵件」時也會一次封存仍留在 Inbox 的舊有 `AI/*` 分類郵件，包含升級前已處理的郵件。設定頁可關閉封存，但已分類郵件仍不會重複出現在外掛清單。

「可能詐騙」與「可能垃圾」分開：詐騙著重冒充、網域或 Reply-To／Return-Path 不一致、內容聲稱的機構與連結目的網域不一致，以及騙取金錢、帳密、驗證碼或敏感資料；垃圾著重大量濫發、無關推銷與其他不受歡迎內容。正常品牌寄出的促銷、優惠、活動導購與合理訂閱電子報屬於「行銷」，不會只因含促銷、追蹤或退訂連結就判成垃圾。分類優先順序為：可能詐騙 → 可能垃圾 → 行銷／新知 → 重要（緊急／不緊急）→ 次要 → 時間相關 → 未分類。

外掛會透過 Gmail Profile 取得目前登入帳號，並比較 `To`、`Cc`、`Delivered-To`、`X-Original-To`。結果卡顯示「收件者：是本人／明確不符／未顯示／不明」；「未顯示」可能是 BCC、轉寄或郵件群組，不會單獨成為詐騙證據。寄件合法性則比較 From 網域、DKIM／DMARC 驗證、Reply-To 與 Return-Path。驗證通過只能證明寄件者控制該網域，不能單獨保證內容沒有詐騙，因此仍會和正文要求一起判斷。

外掛也會抽出 HTML 按鈕背後的真正 `href` 與純文字網址，再把內容聲稱的機構、已驗證寄件網域和連結目的網域一起比較。第一版可信機構表收錄玉山銀行公布的 `esunbank.com`、`esunbank.com.tw`、官方短網址 `esun.co`，以及 iKala 公布的 `ikala.ai`（舊網域 `ikala.tv`）；子網域也視為官方網址。若郵件自稱玉山銀行，但寄件者與連結都不是官方網域，會直接列入「可能詐騙」；結果卡會顯示聲稱機構、連結是否官方，以及不符的網域。可信機構表位於 `trusted-organizations.js`，後續可依各機構官方資料擴充。

合法電子報可能使用第三方寄送與退信服務，因此 `Reply-To` 或 `Return-Path` 不同只能當成風險訊號，不能單獨判定詐騙。像 `contact@ikala.ai` 寄出的 iKala 月報，若 From 的 DKIM／DMARC 與 `ikala.ai` 對齊、內容是產業月報且沒有索取帳密、驗證碼或付款資料，應分類為「行銷」或「新知」。

## 1. 準備 urJev

先啟動模型與 Node 服務：

```powershell
cd F:\sideproject\urJev
npm run model:vllm
```

另一個 PowerShell：

```powershell
cd F:\sideproject\urJev
npm start
```

預設端點為 `http://127.0.0.1:15413/v1/systemone/oneforward`。

## 2. 第一次載入外掛並取得 Extension ID

1. Chrome 開啟 `chrome://extensions/`。
2. 開啟右上角「開發人員模式」。
3. 按「載入未封裝項目」，選擇本資料夾。
4. 複製 Chrome 顯示的 Extension ID。

此時 OAuth Client ID 尚未設定，外掛可以載入，但還不能連接 Gmail。

## 3. 建立 Google OAuth Client

1. 在 Google Cloud Console 建立或選擇專案。
2. 啟用 **Gmail API**。
3. 設定 OAuth consent screen；個人測試時把自己的 Google 帳號加入 Test users。
4. 建立 OAuth Client，Application type 選 **Chrome Extension**。
5. Item ID 填入上一步的 Extension ID。
6. 複製產生的 Client ID，打開 `manifest.json`，替換：

```json
"client_id": "REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
```

回到 `chrome://extensions/`，按此外掛的重新載入按鈕。

外掛使用 `gmail.modify`，因為它需要讀取郵件本文並選擇性套用標籤。若要公開發布，Google 可能要求 OAuth 應用程式驗證；個人測試請使用測試使用者。

## 4. 允許外掛呼叫本機 urJev

打開外掛設定頁，複製顯示的 Origin，例如：

```text
chrome-extension://abcdefghijklmnopabcdefghijklmnop
```

加入專案 `.env`：

```dotenv
EXTENSION_ORIGINS=chrome-extension://abcdefghijklmnopabcdefghijklmnop
```

多個外掛 Origin 用逗號分隔。修改後重新啟動 `npm start`。urJev 只接受明確列出的 32 字元 Chrome Extension ID，不會開放任意跨來源請求。

## 5. 使用

1. 點 Chrome 工具列上的外掛圖示，分析器會固定開在 Chrome 側邊面板；Chrome 預設顯示在右側，也可由 Chrome 的側邊面板設定調整位置。
2. 按「連接 Gmail」並完成 Google 授權。
3. 選擇郵件範圍後按「載入郵件」。預設查詢為 `in:inbox newer_than:30d`，每次最多 100 封。
4. 勾選要處理的郵件，按「分析已勾選」。
5. 結果會顯示在每封郵件下方。確認後按「執行分類」，Gmail 才會建立並更新 `AI/*` 標籤。

開始分析後，側邊面板底部會顯示可收合、可拖曳的懸浮統計卡，即時更新已載入數量、本次分析目標、本次完成數量，以及九種分類各自的郵件數量。只要本次分析出現「可能詐騙」，統計卡會亮起黃色閃爍警示並顯示封數；沒有詐騙結果時警示自動隱藏。百分比只以本次勾選數量為分母，例如載入 100 封但勾選 5 封，完成後會顯示 `5 / 5` 與 `100%`。若其中一封處理失敗，統計卡會保留已完成進度並顯示「分析已停止」。

每封分析結果下方都有「正確分類」選單。按「儲存並學習」後，外掛會在 `chrome.storage.local` 保存寄件地址、主旨特徵、郵件驗證是否通過、模型原分類及人工分類，不保存郵件全文。後續同一寄件者且主旨相近的郵件會優先使用修正結果；同一寄件者累積兩次一致修正，或同網域累積三次且至少 80% 一致時，也能形成較廣的校正規則。若模型原本判為可能垃圾，只有先前修正與新郵件都具備對齊的 DKIM／DMARC 通過訊號，才允許校正記憶把它改成非垃圾，避免寄件地址遭冒用。

設定頁可查看校正筆數、複製校正 JSON 或清除所有校正。這是本機規則式校正記憶，可立即改善相似郵件；它不會直接修改 Qwen3-8B 權重。匯出的 JSON 可作為後續微調或評估資料。

側邊面板可直接選擇最近 30 天 Inbox、全部重要郵件、全部未讀郵件、最近 30 天全部郵件，或使用設定頁的自訂 Gmail 搜尋條件。搜尋欄可選「標題或內容」或「只搜尋標題」；輸入文字後按 Enter 或「載入郵件」，Gmail 會在所選範圍內搜尋，並排除已有 `AI/*` 標籤的郵件。選擇「全部重要郵件」會使用 `is:important`，因此不受 Inbox 或 30 天範圍限制，但仍受「每次最多載入」上限限制。設定頁可將上限調到 1–500、修改 urJev 端點，並選擇分類後是否封存。分析採逐封執行，避免同時請求觸發 urJev 的 busy lock。

已載入的郵件摘要、勾選狀態與分析結果會保存在 `chrome.storage.session`。切換分頁或關閉再開啟側邊面板時會還原，不必重新載入；重新啟動 Chrome、重新載入／更新／停用外掛時會清除。OAuth token 與郵件全文不會放進此暫存。

舊版只抓到 20 封，是因為預設上限曾設為 20，而且查詢只包含最近 30 天的 Inbox。Gmail 左側「重要郵件」顯示的 43 封來自 Gmail 的 `is:important` 集合，兩者不是同一個搜尋範圍。新版預設上限為 100；要對應 Gmail 的重要郵件清單，請在郵件範圍選擇「全部重要郵件」。

## 隱私與限制

- Gmail OAuth token 由 Chrome Identity API 管理，外掛不把 token 寫入專案或匯出檔。
- 郵件主旨、寄件者、驗證結果、摘要與本文前 2,000 UTF-8 bytes 會送到本機 urJev 端點；外掛設定拒絕非 localhost 端點，不會呼叫 Jev 官方 API。輸入還會經過整體提示預算檢查，避免超過 OneForward 每題 7,000 bytes 上限。
- 分類是模型判斷，可能誤判；尤其「可能垃圾」不應直接拿來自動刪信。
- HTML 郵件會轉為純文字；圖片中的文字、加密郵件與部分複雜附件不會分析。
- Gmail 標籤是輔助整理，不會變更 Gmail 自己的 Importance 或 Spam 系統判斷。

Google／Chrome 設定依據：[Chrome Extension OAuth](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)、[Gmail API](https://developers.google.com/workspace/gmail/api/reference/rest)與[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)。
