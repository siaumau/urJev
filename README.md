# urJev

完整建置與 Intel GPU／WSL 調校紀錄：[urJev 建置技術文檔](docs/urjev-intel-xpu-engineering.md)。包含專案演進、相容性問題定位、約 13 秒至 1 秒的最佳化過程、測試依據與回復步驟。

最新一輪已啟用非同步排程及最多八題並行；同一五題範例重啟暖機後為 744／704 ms，Playground 實測 757 ms 總等待。首次測量為 2425 ms，穩定性測試也觀察到超過一秒的波動，不能保證每次小於一秒。24 項程式測試通過；情緒題既有誤判仍未修正。下方歷史數據保留作比較，最新設定以啟動腳本及技術文檔的後續更新為準。

屬於你的本地結構化判斷引擎。輸入 State 與 Problem，回傳受 JSON Schema 約束的判斷結果。支援 Qwen3 + vLLM 與 Qwen2.5 + Ollama，並在應用程式用 Ajv 再驗證一次。

這是 Jev 類型工作流程的可執行原型，不是 Jev 原始模型的複製品，也尚未做專屬資料微調。沒有宣稱 100 ms 延遲或生產級準確率。

## Qwen3 + vLLM（Windows / Ubuntu WSL2）

模型為 `Qwen/Qwen3-4B-Instruct-2507`，使用 BF16 與 Intel XPU。Python 3.12 環境位於 WSL `~/.local/share/urjev/vllm-env`，模型下載到 Hugging Face 標準快取。這是獨立的 Linux 環境，無法直接使用 Ollama 的 GGUF 模型。

安裝 GPU userspace 套件 `libze-intel-gpu1 libze1 libze-dev intel-opencl-icd intel-ocloc libnuma1 build-essential` 與 uv 後，在 Ubuntu 執行 `bash /mnt/f/sideproject/urJev/scripts/setup-vllm.sh`。建議 apt 使用 `--no-install-recommends`，避免帶入舊世代驅動。本機的 `libze-intel-gpu-legacy1-1` 與 B70 在 WSL 的初始化衝突，移除此額外套件後 BF16 運算通過。vLLM 版本固定於腳本；XPU wheel 使用官方預覽版。首次下載包含約 7.49 GiB 權重與數 GB 推論相依套件。

`.env` 設定：
```dotenv
PORT=3210
INFERENCE_BACKEND=vllm
VLLM_URL=http://127.0.0.1:18000
MODEL=Qwen/Qwen3-4B-Instruct-2507
INFERENCE_TIMEOUT_MS=120000
```

先在一個終端執行 `npm run model:vllm`，等模型啟動完成後，在另一個終端執行 `npm start`。模型服務只綁定 localhost。初次載入與核心初始化可能較久；目前採 XPU decode graph、8192 context 與最多 8 個序列。

WSL 在此 GPU 上無法提供可用 VRAM（回報 0），因此啟動使用 `scripts/urjev_xpu_worker.py` 相容層與固定 2 GiB KV cache。僅限 WSL、總 VRAM ≥24 GiB、明確 cache ≤3 GiB 時，略過會誤判的自動容量檢查；GPU 實際配置仍可能因其他程序占用而失敗。此處沒有把總容量假裝成可用容量。若更換 GPU 或模型，請重新評估配置。新版 Intel 程式庫曾另外下載至 `.runtime/intel-drivers` 供診斷，正常啟動不使用該目錄。

本機目前使用 vLLM 原生模型實作、Triton attention、原生 PyTorch RMSNorm、自訂運算與 XPU Graph（僅 decode，batch 1/2/4）；開啟 prefix cache，啟用非同步排程，仍停用 pinned memory/UVA。預設 XPU RMSNorm 在寬度 2560 的獨立測試中漏寫 75% 輸出，因此保留原生 RMSNorm 替代路徑。這是局部繞過核心錯誤，並未修復上游驅動。已驗證環境：Ubuntu 26.04 / WSL2、Intel Arc Pro B70、Compute Runtime 26.05.37020.3、PyTorch 2.13.0+xpu。

2026-09-22 實測：原始五題回饋範例首次 15.25 秒、暖機後 12.85 秒，各題輸出吞吐約 14–15 tokens/s。技術問題、退款及附條件停止續訂有辨識出來；情緒仍誤選 negative，依題目應為 mixed。格式驗證通過不代表語意全對。逐筆結果見 `reports/feedback-qwen3-vllm-first.json` 與 `reports/feedback-qwen3-vllm-warm.json`。目前 `.env` 已切換為此後端，舊設定備份於 `.runtime/env-before-vllm.txt`。

vLLM 開啟逐請求 metrics：卡片明細顯示排隊、首 token、首至末 token 生成、平均 token 間隔與含輸入處理的吞吐。這些計時定義不同於 Ollama；未提供的載入時間、Prefill、記憶體快照與頻寬一律為 null。參考：[vLLM XPU](https://docs.vllm.ai/en/latest/getting_started/installation/gpu/)、[逐請求計時](https://docs.vllm.ai/en/latest/features/per_request_metrics/)。

後續應用層最佳化已啟用：vLLM 最多八題並行，保留具名 weights，只要求模型省略 JSON 空白與換行。外部 State／Problem／answers 格式不變，結果依原問題順序排列。任一題失敗會停止派發新題、等待已在執行的題目結束，再回報錯誤；不回傳部分成功。Ollama 維持循序與原始提示。

同一份五題範例最新比較：循序原格式 13.116 秒／190 tokens；僅並行 5.239 秒；僅緊湊 JSON 7.863 秒／105 tokens；兩者合併連續兩次 2.784、2.882 秒。主要分類、退款及續訂意圖維持一致，權重與不滿分數稍有變動；情緒仍誤判 negative。這是單一範例，不代表整體準確率。比較指令 `node scripts/benchmark-systemone.js`，報告 `reports/systemone-optimization.json`。曾試驗匿名權重陣列，速度較快但語意明顯退步，未採用；紀錄見 `reports/systemone-array-experiment.json`。並行時各題時間重疊，不可相加當作實際等待時間。

最新 Intel XPU 最佳化已啟用：原生 RMSNorm 避開已重現的核心漏寫問題，恢復其他自訂運算、decode-only XPU Graph 與 prefix cache。重啟後同一範例暖機兩次為 1076／1011 ms，Playground 實測總等待 1055 ms。15 輪不同並行數與 4 筆不同內容分類測試通過；情緒題既有誤判仍在。完整紀錄見 [XPU 最佳化報告](docs/urjev-intel-xpu-engineering.md)。若需切回保守模式，先停止模型服務，再執行 `npm run model:vllm:safe`；正常啟動仍使用 `npm run model:vllm`。

## Ollama 啟動（Windows，替代後端）

需要 Node.js 22+、PowerShell、首次下載時可連線網路。預留約 6 GB 磁碟空間。

```powershell
cd F:\sideproject\urJev
npm ci
npm run setup:local
npm start
```

開啟 <http://127.0.0.1:3210>。`setup:local` 下載固定版本 Ollama v0.34.2 portable、驗證官方 SHA-256、啟動本機 11435 埠，下載約 1.9 GB 的 `qwen2.5:3b`。所有 runtime 與模型保存在 `.runtime/`，不更改系統 PATH，也不需要 API key。

下載中斷時重跑 setup，會續傳 `.runtime/ollama.zip`。SHA-256 不符時請移除該下載檔再重試。

日後重開電腦：

```powershell
npm run model:start
npm start
```

App 在前景執行，Ctrl+C 停止。模型服務在背景執行，PID 寫在 `.runtime/ollama.pid`；可在工作管理員辨認該 PID 的 Ollama 後結束。日誌在 `.runtime/ollama.stderr.log`。不要任意結束其他專案的 Ollama。

若已經有自己的 Ollama，複製 `.env.example` 成 `.env` 並設定 `OLLAMA_URL` 與 `MODEL`；此時可略過 portable 安裝。環境變數會在 `npm start` 載入。

## 你的第一個判斷

在介面填入每行一個分類，輸入待分類文字，按「執行判斷」。分類會保留 `__unknown__` 作為資訊不足／不屬於任何選項的輸出，但小模型仍可能誤判。

「JSON 擷取」可定義商品、數量、布林值等欄位；缺少資料時請允許 `null`。支援的 Schema 子集是 `type`、`properties`、`required`、`additionalProperties`、`items`、`enum`、`description`；最外層為 object，每個欄位必填，object 禁止額外欄位。不支援 `$ref`、正規表示式、日期 format 等任意 Schema 特性。

匯出設定可保存文字、選項、規則與 Schema，再匯入使用。輸入不會由 urJev 自動寫入磁碟；匯出的設定檔與評測報告會含有文字，請自行管理。

## API

### State / Problem Playground

首頁預設顯示 State 與 Problem 兩個 JSON 編輯區，預載課程平台回饋的五題範例。Problem 直接貼入具名問題物件（例如 `main_topic`、`sentiment`），不用包 `questions`。按「執行判斷」後以中文卡片顯示選項、是／否傾向與分數條，完整 `answers`、`usage`、`meta` 收在「查看原始 JSON」。是／否傾向以 60%／40% 為介面分組門檻，並非經校準的決策標準。支援匯出／匯入 State／Problem 設定；舊分類／擷取 API 保留，但不再顯示於 Playground。

若從對話貼入 `&#x20;` 或 `\_` 而使 JSON 無效，可按「清理貼上轉義」；合法 JSON 不會被改寫。State 的普通文字請用 JSON 字串（加雙引號）。

`POST /v1/systemone` 接受 `{ "state": ..., "questions": { ... } }`，或 `{ "state": ..., "problem": { ... } }`。兩者不可同時存在。範例見 `examples/feedback-systemone.json`。可選 model 只接受 `urjev`，實際底層模型仍由 `.env` 控制。

- `choice`：具名 criteria 物件，回傳 choice、probabilities、confidence。
- `noul`：是／否問題，criteria 可省略，回傳 0–1 的 noul。
- `score`：criteria 是依序排列的等級陣列，回傳從 0 開始的加權 score、legend、probabilities、confidence。

**只有輸入結構與主要輸出欄位對齊，不是完整 Jev SDK 相容實作。** 機率來自 LLM 生成的 0–100 權重再正規化，並非 logits／token 機率，也未校準。confidence 一律 null，meta.calibrated 為 false。模型可以輸出 1.0 卻仍然誤判，不能據此自動決定退款或流失處理。各題獨立推論；vLLM 最多八題並行，Ollama 循序執行，延遲仍會受題數影響。單次限 16 題、choice 32 個選項、score 10 個等級、每題提示 7,000 UTF-8 bytes。任一題失敗整個請求回錯誤，不回傳部分成功。

歷史 1.5B 實測能完整回傳五題，但會誤判主要問題、退款與流失意圖。`reports/feedback-systemone.json` 保存了當時結果；格式通過不代表語意通過。這個模式的品質不能套用先前簡單分類的 15/16 評測。最新 Qwen3 結果見前述 vLLM 小節。

### 原有分類／擷取 API

```javascript
const response = await fetch('http://127.0.0.1:3210/api/decide', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mode: 'classify',
    text: '我想知道包裹什麼時候到',
    labels: ['退款申請', '物流查詢', '產品問題'],
    instructions: '依照使用者的主要需求分類。',
    examples: [
      { text: '我要退錢', output: { label: '退款申請' } }
    ]
  })
});
console.log(await response.json());
```

回應結構：`{ result: { label: '物流查詢' }, meta: { model, backend, schema_valid, abstained, latency_ms, model_ms, load_ms, output_tokens } }`。時間來自本次實際請求；沒有結果快取或假造的信心分數。few-shot 範例最多 8 筆；這是提供示範，不是修改模型權重。

擷取請求範例：

```json
{
  "mode": "extract",
  "text": "我要三個保溫杯",
  "schema": {
    "type": "object",
    "properties": {
      "product": { "type": ["string", "null"] },
      "quantity": { "type": ["integer", "null"] }
    },
    "required": ["product", "quantity"],
    "additionalProperties": false
  }
}
```

`GET /api/health` 檢查服務及模型是否存在，不代表模型已載入記憶體。`POST /api/decide` 每次僅允許一個推論請求，其餘回 429。請求最多 64 KB；文字、規則、範例與 Schema 組合後的提示限制為 7,000 UTF-8 bytes，為 8,192-token context 保留輸出空間，超長會拒絕而非偷偷截斷。逾時預設 120 秒。錯誤使用 `{ error: { code, message } }`，離線／逾時／不符合 Schema 的結果不會冒充成功。

## 驗證與評測

```powershell
npm test
npm run evaluate
# 自訂資料與從 UI 匯出的分類任務：
node scripts/evaluate.js my-eval.jsonl my-task.json
```

測試涵蓋 decoder Schema、輸出驗證、空值、拒判、輸入錯誤、離線、逾時與 HTTP。評測會呼叫真實模型，使用 JSONL `{ "text": "...", "expected": "分類" }`，輸出準確率、錯誤數、p50/p95 與逐筆結果至 `reports/evaluation.json`。預設 8 筆是 smoke test，不能當成實際業務準確率。第一筆可能包含冷啟動時間。

## 後續提升

先收集你的領域中人工確認的範例與獨立測試集；調整標籤定義和 few-shot 後再考慮 LoRA/蒸餾。這版沒有訓練流程。目前依使用者要求將預設升級為 3B（先前 1.5B 的測試數據保留作歷史比較）；若想比較更小的 0.5B：

```powershell
$env:OLLAMA_HOST = '127.0.0.1:11435'
.\.runtime\ollama\ollama.exe pull qwen2.5:0.5b
```

在 `.env` 設定 `MODEL=qwen2.5:0.5b` 並重啟 app。速度取決於模型、輸入長度、冷啟動及 CPU/GPU 實際使用情況。

2026-09-22 本機 Intel Arc Pro B70 / Vulkan 實測：0.5B 在預設 8 筆答對 4 筆；1.5B 答對 7 筆（p50 115 ms，首次冷啟動約 15.8 秒）。接著 1.5B 在 `examples/holdout.jsonl` 的另 8 筆答對 8 筆，p50 96 ms、p95 120 ms。兩組合計 15/16，但樣本非常小，且都是簡單客服情境，不能推論正式準確率。Ollama 會重用 prompt cache；urJev 沒有答案快取。保留的逐筆報告見 `reports/`。

Groq/Cerebras 是可考慮的後續服務端整合，這一版尚未接入。雲端只提供其支援模型與能力，不能假設任意開源模型皆可直接部署。切換雲端也會改變資料去向。

服務僅綁定 127.0.0.1，沒有公開部署所需的登入、租戶隔離或用量限制。JSON 格式約束並不解決語意錯誤或所有 prompt injection；高風險業務仍需驗證與人工覆核。

## 參考

- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)：直接把 JSON Schema 傳給推論端，再驗證回應。
- [Ollama Windows](https://docs.ollama.com/windows)：portable runtime。
- [Qwen2.5](https://ollama.com/library/qwen2.5)：本地小模型。
- [Outlines](https://github.com/dottxt-ai/outlines)：另一條結構化生成整合路線；本版利用 Ollama 原生功能，無需額外 Python 推論堆疊。
- [Groq structured outputs](https://console.groq.com/docs/structured-outputs)：模型與支援模式需依官方文件確認。

## 效能明細

結果下方的「查看完整效能明細」預設收合。瀏覽器等待時間、伺服器計時與 Ollama 計時各有自己的邊界，差值不是純 GPU 時間。Ollama 的 load、prompt_eval、eval 以奈秒換算毫秒；逐題生成速度為 eval_count / eval_duration，合計速度採總 tokens 除以總生成秒數。缺少數值顯示未提供，不當成零。

記憶體資料透過推論完成後另外呼叫 `/api/runtime`（Ollama `/api/ps`）取得，因此不計入主要請求耗時。配置量與 VRAM 是快照，不是峰值或頻寬。實際記憶體頻寬、GPU 利用率、功耗與首次 token 時間尚未量測。來源：[Ollama chat](https://docs.ollama.com/api/chat)、[running models](https://docs.ollama.com/api/ps)。
