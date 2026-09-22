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
| Playground | http://127.0.0.1:3210/ |
| 模型 API | http://127.0.0.1:18000/ |
| 排程 | 非同步排程、最多八題並行、prefix cache |
| GPU 執行 | Triton attention、decode-only XPU Graph（batch 1/2/4/8）、native RMSNorm |

這份啟動配置針對上述環境驗證。換用其他 GPU、作業系統或模型時，需要重新檢查相容性與顯存配置。

## 第一次安裝：Qwen3＋vLLM

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
PORT=3210
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

開啟 http://127.0.0.1:3210/，模型狀態應顯示 `Qwen/Qwen3-4B-Instruct-2507` 與 `vllm`。也可檢查：

```powershell
Invoke-RestMethod http://127.0.0.1:3210/api/health
```

預期為 `ready: true`、`backend: vllm`。這代表服務與模型可達，不代表答案一定正確。

## 日常啟動與保守模式

環境安裝完成後，每次只需依序執行 `npm run model:vllm` 與 `npm start`；不必重新安裝或下載，也不必執行 `model:start`／`setup:local`（那兩個命令屬於 Ollama）。

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

## 最新實測與驗證

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

後兩個命令呼叫真實模型，產生或覆寫 `reports/` 的對應結果。已提交的實測快照在 [docs/benchmarks](docs/benchmarks)，目前版本數據見 [xpu-async-production.json](docs/benchmarks/xpu-async-production.json)。

## 歷程、替代方案與限制

- [建置技術文檔](docs/urjev-intel-xpu-engineering.md)：保留 Ollama 原型、Qwen3 導入、Intel／WSL 問題定位與各階段效能比較；歷史設定不等於目前啟動設定。
- [Ollama 替代後端](docs/ollama-alternative.md)：主動選用 Qwen2.5／Ollama 時才需要的安裝與切換方式。
- [舊分類／擷取 API](docs/legacy-api.md)：相容介面與原有評測命令。

服務只綁定 localhost，尚無公開部署所需的登入、租戶隔離或用量限制。未整合 Groq／Cerebras，也沒有 LoRA／蒸餾訓練流程。專案開源不等於模型服務已公開部署。
