# urJev

本地結構化判斷引擎：輸入 **State（資料）** 與 **Problem（問題與規則）**，用收合卡片閱讀分類、是／否傾向與分數。

**目前主要執行方式是 Qwen3-4B-Instruct-2507＋vLLM，在 Windows 的 Ubuntu WSL2 使用 Intel GPU。這條路徑不需要啟動 Ollama。** Ollama 是保留的替代後端，請見[獨立說明](docs/ollama-alternative.md)。

本專案採 [MIT License](LICENSE)。模型權重與第三方套件遵循各自授權，未隨 repository 散布。這是 Jev 類型工作流程的原型，不是 Jev 原始模型或完整 SDK 複製品，也尚未做專屬資料微調。

## 目前設定

| 項目 | 設定 |
|---|---|
| 模型 | `Qwen/Qwen3-4B-Instruct-2507`，BF16 |
| 推論引擎 | vLLM XPU，官方預覽版 |
| 已驗證環境 | Intel Arc Pro B70 32 GB、Windows＋Ubuntu 26.04／WSL2 |
| Playground | http://127.0.0.1:15413/ |
| 模型 API | http://127.0.0.1:18000/ |
| 排程 | 非同步排程、最多八題並行、prefix cache |
| GPU 執行 | Flash Attention、decode-only XPU Graph（batch 1/2/4/8）、編譯融合的原生 RMSNorm |

這份啟動配置針對上述環境驗證。換用其他 GPU、作業系統或模型時，需要重新檢查相容性與顯存配置。

## 安裝與設定：Qwen3＋vLLM

### 1. 準備環境

Windows 端需要 Node.js 22+、PowerShell、WSL2 與適用的 Intel 顯示驅動。模型在 Ubuntu 中執行；目前 PowerShell wrapper 使用名為 `Ubuntu` 的 distribution。

Ubuntu 端需要 uv、Python 3.12，以及 `libze-intel-gpu1 libze1 libze-dev intel-opencl-icd intel-ocloc libnuma1 build-essential`。安裝系統套件時建議使用 `--no-install-recommends`，並確認適用的 GPU 世代。完整版本及曾遇到的驅動問題見[建置技術文檔](docs/urjev-intel-xpu-engineering.md)。

以下命令假設專案放在 `F:\sideproject\urJev`；若下載到其他位置，請替換路徑。

```powershell
# Windows PowerShell：專案根目錄
cd F:\sideproject\urJev
npm ci
```

```bash
# Ubuntu WSL：完成上述系統套件與 uv 安裝後
bash /mnt/f/sideproject/urJev/scripts/setup-vllm.sh
```

腳本建立 WSL 獨立 Python 環境 `~/.local/share/urjev/vllm-env`，並下載模型至 Hugging Face 標準快取。首次下載包含約 7.49 GiB 權重與數 GB 相依套件。vLLM 版本固定於腳本，其他相依項目並非完整 lockfile。

### 2. 選擇 vLLM 後端

首次建立 `.env` 時，在 Windows PowerShell 執行：

```powershell
Copy-Item .env.vllm.example .env
```

若已有 `.env`，請直接確認／調整以下欄位，避免覆寫其他設定：

```dotenv
PORT=15413
INFERENCE_BACKEND=vllm
VLLM_URL=http://127.0.0.1:18000
MODEL=Qwen/Qwen3-4B-Instruct-2507
INFERENCE_TIMEOUT_MS=120000
```

`.env` 不納入 Git。**`.env.example` 是 Ollama 替代後端範本；vLLM 請使用 `.env.vllm.example`。** 程式未指定 backend 時仍保留 Ollama fallback，所以不能省略這一步。

### 3. 啟動模型，再啟動 Playground

在專案根目錄開兩個 Windows 終端：

```powershell
# 終端一：持續執行模型服務，等啟動完成
npm run model:vllm
```

```powershell
# 終端二：持續執行應用服務
npm start
```

開啟 http://127.0.0.1:15413/，模型狀態應顯示 `Qwen/Qwen3-4B-Instruct-2507` 與 `vllm`。也可檢查：

```powershell
Invoke-RestMethod http://127.0.0.1:15413/api/health
```

預期為 `ready: true`、`backend: vllm`。這代表服務與模型可達，不代表答案一定正確。

## 啟動與停止

環境安裝完成後，每次只需依序執行 `npm run model:vllm` 與 `npm start`；不必重新安裝或下載，也不必執行 `model:start`／`setup:local`（那兩個命令屬於 Ollama）。

停止時，在應用服務與模型服務各自的終端按 Ctrl+C。只停止 `npm start` 不會同時停止另一個終端中的模型服務。

### 保守模式

如需切回保守的 **vLLM** 設定，先停止目前模型服務，再執行：

```powershell
npm run model:vllm:safe
```

此模式仍是 Qwen3＋vLLM，採 eager、同步排程與四序列上限。應用層送出的額外題目會在引擎排隊。兩種模式使用同一個 18000 埠，不可同時啟動；`.env` 不需變更。

本機 WSL 有 free VRAM 回報 0 與 RMSNorm 核心漏寫問題，啟動腳本保留有條件的顯存相容層、固定 2 GiB KV cache 與 native RMSNorm。這是經測試的替代路徑，不是已修復所有上游驅動問題。細節見[相容性調校歷程](docs/urjev-intel-xpu-engineering.md)。

## 在 Playground 做第一個判斷

1. **State**：填入待分析的 JSON，例如客服回饋；普通文字需包成 JSON 字串。
2. **Problem**：填入具名問題物件，直接使用 `main_topic` 等欄位，不需再包一層 `questions`。
3. 按「執行判斷」，或使用 Ctrl／⌘＋Enter。
4. 每張卡片預設收合，右側顯示答案；點開查看規則與各選項權重。

首頁預載五題課程平台回饋範例，也可按「載入你的回饋範例」。完整資料見 [examples/feedback-systemone.json](examples/feedback-systemone.json)。支援匯出／匯入 State 與 Problem；貼上內容有 `&#x20;` 或 `\_` 造成 JSON 無效時，可按「清理貼上轉義」。

| 問題型別 | 輸入規則 | 結果 |
|---|---|---|
| `choice` | 具名 criteria 物件 | 選項與正規化權重 |
| `noul` | 是／否問題，criteria 可省略 | 「是」的 0–1 估計值 |
| `score` | criteria 為依序排列的等級陣列 | 從 0 開始的等級加權分數 |

「傾向是／否」以 60%／40% 為介面門檻。權重來自模型文字輸出後正規化，未校準、不是 token 機率；`confidence` 為 null。**格式通過驗證不代表答案正確。** 已知範例情緒題仍可能選 negative，依規則應為 mixed。

## API 與效能明細

`POST /v1/systemone` 接受 `{state, problem}` 或 `{state, questions}`，兩種問題欄位不可並存。回傳 `answers`、`usage`、`meta`。可選 `model` 欄位僅接受 `urjev`；實際模型由伺服器 `.env` 決定。

單次最多 16 題，choice 最多 32 選項、score 最多 10 等級；每題提示上限 7,000 UTF-8 bytes。vLLM 最多八題並行，回應保持原問題順序。任一題失敗會等待在途工作結束再回錯誤，不回傳部分成功。

兩種推論路由共用一個 HTTP 忙碌鎖：處理中收到另一份推論請求會回 429。請求大小上限 64 KB，推論逾時由 `INFERENCE_TIMEOUT_MS` 控制。`GET /api/health` 檢查後端，`GET /api/runtime` 取得可提供的快照資訊。

效能明細預設收合，包含伺服器處理、傳輸／瀏覽器差值，以及 vLLM 排隊、排程至首 token、首至末 token 生成、平均 token 間隔及吞吐。並行題目的時間重疊，不能相加當作實際等待時間。傳輸／瀏覽器差值包含解析與排程，並非純網路 RTT。

vLLM 未提供的逐題模型載入、獨立 Prefill、記憶體配置及實際頻寬，顯示未提供，不當成零。Ollama 的計時定義不同，見[替代後端說明](docs/ollama-alternative.md)。

舊 `POST /api/decide` 分類／擷取功能仍保留為 API，不在目前 Playground 顯示；用法見[舊 API 說明](docs/legacy-api.md)。

## 五題並行與解碼步數

目前是「題目之間並行，每題內部逐 token 生成」。五題各自組成獨立提示與模型請求，同時送到 vLLM；應用層並行上限為八題。vLLM 將可執行的序列安排成 GPU 批次，共用同一張 GPU，並不是每題各占一張卡。超過八題時，後面的題目等前面的工作完成後再送出。

每題仍使用自回歸生成：處理輸入並產生第一個 token，再逐步產生後續 token。Token 是文字片段，不等於一個中文字；JSON 欄位、數字與標點也會占 token。「步」指解碼步驟，不是思考步驟、題數或 GPU 核心呼叫次數。

先前一筆測量中，最慢的情緒題輸出 26 tokens，所以第一個 token 之後約需 25 次解碼；輸出 100 tokens，則約需 99 次後續解碼。步數隨實際輸出改變，不固定為 25。這是目前未啟用推測解碼時的運作方式。

```text
單題耗時 ≈ 首 token 等待時間 + (輸出 token 數 − 1) × 平均解碼間隔 + 其他開銷
五題整體等待 ≈ 最晚完成題目的時間 + 應用與傳輸開銷
```

五題時間會重疊，不能把步數或生成時間直接相加。較長輸出的題目通常較慢，但提示長度與排程也會影響完成順序。例如以某次實測約 16.5 ms 的 token 間隔估算，100 tokens 的後續解碼約為 `99 × 16.5 = 1633.5 ms`，還要加上首 token 等待與其他開銷；不是固定速度保證。

### 頻寬估算與 Jev 官方速度

[Intel 官方規格](https://www.intel.com/content/www/us/en/products/sku/245797/intel-arc-pro-b70-graphics/specifications.html)列出 Arc Pro B70 的顯示記憶體頻寬為 608 GB/s。若簡化假設每次解碼讀取約 8 GB 的 BF16 權重、完全利用標稱頻寬：

```text
8 GB ÷ 608 GB/s ≈ 13.16 ms／步
25 步 × 13.16 ms ≈ 329 ms（約 330 ms）
```

**這是特定假設下的權重讀取量級估算，不是這張卡固定的物理極限，也不是完整回應時間。** 實際讀取量、快取與批次共用會影響結果；提示處理、KV cache 存取、計算、排程與傳輸等未納入。五題批次可能共用權重讀取，不能再把上式乘以五。換模型、精度、輸出長度或解碼方法都會改變估算，不能據此宣稱硬體已跑滿。

| 數字 | 定義與條件 |
|---|---|
| Jev 官方 70–500 ms | 官方公布的端到端時間；測試通常從美國西岸執行，服務也位於當地 |
| urJev 約 500 ms 上下 | 本機 Qwen3-4B BF16 五題的實測量級，有波動，詳見下方紀錄 |
| 約 330 ms | 假設每步讀取 8 GB、頻寬 608 GB/s、25 次解碼的理想化權重讀取估算 |

Jev 數字來自 [2026-09-15 官方發布文章](https://typesafe.ai/blog/introducing-system-one-models-and-jev)。官方描述其模型平行產生決策；urJev 則讓多題請求並行，各題仍逐 token 輸出。兩者題目、模型、硬體與測量條件不同，不能視為同等效能或準確度。

## 最新實測與驗證

加入驗證器快取後，交錯測試含準備時間的中位數由 578.4 降到 500.0 ms；實際本機 HTTP 五次測量仍為 524–611 ms，尚未穩定低於 500 ms。見[驗證器快取調校](docs/validator-cache-tuning.md)。

準確度調整後，16 筆案例的情緒／退款／續訂 48 項檢查，由 46/48 改善為首次 48/48、重跑 47/48；額外八筆案例由 20/24 改善為 22/24。25 項單元測試通過，但語意測試尚未全對。該輪五題推論測量約 461–563 ms，不含完整瀏覽器往返。詳見[準確度調整紀錄](docs/accuracy-tuning.md)。

### 先前階段的測量

先前的 0.5 秒挑戰採用正規化融合與平面具名權重輸出：交錯測試中位數 536.5 ms，十次皆未低於 500 ms；穩定性測試約 531–587 ms。**尚未達到穩定 0.5 秒以下**。完整測試、限制及回復方式見 [0.5 秒挑戰紀錄](docs/half-second-experiment.md)。以下保留上一版數據作比較。

2026-09-22，同一份五題範例、Qwen3-4B BF16：

| 測量 | 耗時 |
|---|---:|
| 重啟後第一筆測量 | 2425 ms |
| 暖機後兩次 | 744／704 ms |
| Playground 端到端 | 757 ms（伺服器 751＋額外 6） |

這是本機少量實測；初次測量可能包含暖機，其他測試也出現超過一秒的波動，不能保證每次都小於一秒。24 項程式測試、15 輪不同並行數測試、4 筆不同內容分類及 16 題上限測試通過；它們不是完整語意準確率評估，情緒題既有誤判未算成語意通過。

```powershell
npm test
node scripts/benchmark-xpu.js verification http://127.0.0.1:18000 8
node scripts/stress-xpu.js http://127.0.0.1:18000 1,4,8 xpu-verification
```

後兩個命令呼叫真實模型，產生或覆寫 `reports/` 的對應結果。已提交的實測快照在 [docs/benchmarks](docs/benchmarks)，早期非同步版本數據見 [xpu-async-production.json](docs/benchmarks/xpu-async-production.json)。

## 歷程、替代方案與限制

- [建置技術文檔](docs/urjev-intel-xpu-engineering.md)：保留 Ollama 原型、Qwen3 導入、Intel／WSL 問題定位與各階段效能比較；歷史設定不等於目前啟動設定。
- [Ollama 替代後端](docs/ollama-alternative.md)：主動選用 Qwen2.5／Ollama 時才需要的安裝與切換方式。
- [舊分類／擷取 API](docs/legacy-api.md)：相容介面與原有評測命令。

服務只綁定 localhost，尚無公開部署所需的登入、租戶隔離或用量限制。未整合 Groq／Cerebras，也沒有 LoRA／蒸餾訓練流程。專案開源不等於模型服務已公開部署。

## Cloudflare Tunnel／遠端測試

將 Tunnel 的 hostname 轉送到 http://127.0.0.1:15413，並在 .env 設定 PUBLIC_ORIGIN=https://你的網域，重啟 npm start。此設定只允許該確切 Host 與 Origin，不會信任任意 X-Forwarded-Host。未設定時只允許 localhost。

目前遠端測試網址為 https://ai3.aischool.edu.pl/；Postman 使用 POST https://ai3.aischool.edu.pl/v1/systemone，Content-Type: application/json，Body 同本機 State／Problem。應用目前未實作登入或 API key；允許 Host 並不等於身分驗證，公開網址可被外部呼叫。

ai2 的結構化 API 為 POST https://ai2.aischool.edu.pl/v1/systemone；與 ai3 共用目前 urJev 模型服務。路由與 gateway 快照見 [部署紀錄](deploy/README.md)。
