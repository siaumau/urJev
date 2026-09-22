# Ollama 替代後端

目前主要使用方式是 [Qwen3＋vLLM](../README.md)。本頁只供主動選擇 Qwen2.5＋Ollama 時使用；執行 vLLM 不需要 Ollama。

## 首次安裝與切換

Windows 端需要 Node.js 22+、PowerShell、網路與約 6 GB 磁碟空間。在專案根目錄執行：

```powershell
npm ci
npm run setup:local
```

腳本下載固定版本 Ollama v0.34.2 portable、核對官方 SHA-256、啟動 localhost:11435 並下載 `qwen2.5:3b`。執行檔及模型放在 `.runtime/`，不更改系統 PATH。下載中斷可重跑；checksum 不符時只移除失敗的下載檔再試。

**安裝腳本不會自動把既有 vLLM `.env` 切換到 Ollama。** 請先停止應用服務，保留原設定備份，再將 `.env` 調整為：

```dotenv
PORT=3210
INFERENCE_BACKEND=ollama
OLLAMA_URL=http://127.0.0.1:11435
MODEL=qwen2.5:3b
INFERENCE_TIMEOUT_MS=120000
```

首次建立設定也可參考根目錄的 `.env.example`；未指定 `INFERENCE_BACKEND` 時，程式預設使用 Ollama。完成後執行 `npm start`，檢查 `/api/health` 回傳 `backend: ollama`。若不再使用 vLLM，可停止其模型服務以釋放資源。

已安裝環境的日常啟動：

```powershell
npm run model:start
npm start
```

Ollama 在背景執行；PID 記錄於 `.runtime/ollama.pid`，日誌位於 `.runtime/ollama.stderr.log`。應用服務在前景執行，Ctrl+C 可停止。請勿依程序名稱一次終止其他專案的模型服務。

## 切回 vLLM

停止應用服務，在 `.env` 恢復 [`.env.vllm.example`](../.env.vllm.example) 的設定，再於兩個終端執行 `npm run model:vllm` 與 `npm start`。使用自己的 Ollama 服務時，則自行設定 `OLLAMA_URL` 與模型名稱，不必安裝 portable runtime。

## 計時與歷史資料

Ollama 提供 load、prompt_eval、eval 等階段時間，原始奈秒轉換成毫秒；生成速度為輸出 tokens 除以 eval 秒數。推論結束後另由 `/api/ps` 取得配置量／VRAM 快照；這不是峰值或實際記憶體頻寬，也不計入主要請求耗時。

舊 1.5B／3B 量化模型與目前 Qwen3 BF16 的模型、輸出量及快取條件不同。歷史速度與限制請參考[建置技術文檔](urjev-intel-xpu-engineering.md)，不要把它們當成目前 vLLM 配置的數據。
