# urJev Gmail 郵件分析器

Chrome Manifest V3 子專案。外掛透過 Gmail 官方 API 讀取使用者選定範圍內的郵件，將郵件本文送到本機 urJev OneForward，再顯示或套用 Gmail 標籤。

## 分類結果

垃圾郵件判斷與工作分類會同時執行，最後套用一個主要標籤：

| 標籤 | 條件 |
|---|---|
| `urJev/可能垃圾` | 有明確垃圾、釣魚、欺騙或未經請求大量濫發訊號 |
| `urJev/重要-緊急` | 重要，而且有明確近期時間壓力 |
| `urJev/重要-不緊急` | 重要，但可以稍後處理 |
| `urJev/次要` | 有內容價值但優先度較低 |
| `urJev/時間相關` | 未歸入重要或次要，但本文明確提到日期、時間、期限或行程 |
| `urJev/未分類` | 現有內容不足或不符合上述條件 |

外掛只提供輔助判斷，不會把郵件移到垃圾桶，也不會自動刪除郵件。預設只顯示分析結果；設定頁開啟「自動套用 Gmail 標籤」後才會修改標籤。

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

1. 點 Chrome 工具列上的外掛圖示。
2. 按「連接 Gmail」並完成 Google 授權。
3. 按「載入郵件」。預設查詢為 `in:inbox newer_than:30d`，最多 20 封。
4. 勾選要處理的郵件，按「分析已勾選」。
5. 結果會顯示在每封郵件下方；若開啟自動套標，Gmail 會建立並更新 `urJev/*` 標籤。

設定頁可調整 Gmail 搜尋條件、數量、urJev 端點與自動套標。分析採逐封執行，避免同時請求觸發 urJev 的 busy lock。

## 隱私與限制

- Gmail OAuth token 由 Chrome Identity API 管理，外掛不把 token 寫入專案或匯出檔。
- 郵件主旨、寄件者、摘要與最多約 3,500 UTF-8 bytes 的本文會送到本機 urJev 端點；外掛設定拒絕非 localhost 端點，不會呼叫 Jev 官方 API。
- 分類是模型判斷，可能誤判；尤其「可能垃圾」不應直接拿來自動刪信。
- HTML 郵件會轉為純文字；圖片中的文字、加密郵件與部分複雜附件不會分析。
- Gmail 標籤是輔助整理，不會變更 Gmail 自己的 Importance 或 Spam 系統判斷。

Google／Chrome 設定依據：[Chrome Extension OAuth](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)、[Gmail API](https://developers.google.com/workspace/gmail/api/reference/rest)與[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)。
