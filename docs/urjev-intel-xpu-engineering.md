# urJev 建置紀錄：從本地判斷原型到 Intel GPU／WSL 最佳化

日期：2026-09-22。本文記錄本專案已實作、已測試的流程；範例資料為線上課程平台的客服回饋。數字是這台機器的實測，不是對其他硬體的效能保證。

### 後續更新：非同步排程與八題並行

本文下方的四題並行、同步排程與約一秒數據記錄上一階段。最新預設已改成應用層與 vLLM 都最多八題並行，啟用 `--async-scheduling`，decode graph capture sizes 改為 `[1,2,4,8]`。五題可以同時送入引擎，避免第五題等候空位。模型、精度、具名權重 Schema 與提示不變；native RMSNorm 相容設定仍保留。

獨立候選服務上，僅非同步排程的暖機五題為 907／973 ms；再提高並行上限後為 715／688 ms（105 output tokens）。15 輪穩定性測試輪替 1／4／8 並行，八並行的五題耗時為 837、725、674、1082、693 ms；因此不能保證每次都在 700 ms 以內。這些輪次僅改變記錄 ID，語意仍為同一份範例。另有四筆不同退款／物流分類和 16 題請求測試通過；16 題測試為重複的退款／續訂問題，主要驗證派發上限與完整回傳，不能代表廣泛語意準確率。

24 項程式測試通過，包含最大八個 worker、16 題結果順序、非法並行數與失敗後等待在途工作。情緒題已知誤判保留，未計為語意正確。精選證據見 `benchmarks/xpu-async*.json`。保守啟動模式仍用 `npm run model:vllm:safe`，該模型服務最多四序列，額外請求會在引擎中排隊。

重現候選測試可使用 `node scripts/benchmark-xpu.js NAME URL 8`；穩定性測試可指定並行數及報告名稱：`node scripts/stress-xpu.js URL 1,4,8 xpu-async-stability`。

套用至正式 18000 埠並重啟後，五題首次 2425 ms、後續 744／704 ms；瀏覽器端到端為伺服器 751 ms＋傳輸／瀏覽器差值 6 ms＝757 ms。原本預設收合卡片與 State／Problem 格式維持不變。原始紀錄見 `benchmarks/xpu-async-production.json`。

## 1. 成果與範圍

urJev 是個人化的結構化判斷引擎：使用者提供 State 資料和 Problem 規則，模型輸出受 JSON Schema 約束的權重，由程式整理成選項、是／否傾向與分數。前端用預設收合的卡片顯示結果，點開才看詳細資訊。

最終採用 Qwen3-4B-Instruct-2507 BF16、vLLM XPU、Intel Arc Pro B70 32 GB 與 Ubuntu WSL2。相同五題範例從最初 vLLM 保守設定的約 13 秒，經應用層最佳化降到約 3 秒，再經 GPU 執行設定調整降到約 1 秒。最後 Playground 實測為伺服器 1051 ms，加上傳輸／瀏覽器差值 4 ms，總等待 1055 ms。

這不是 Jev 原始模型或完整 SDK 的複製，也沒有微調、蒸餾或訓練專屬分類器。模型產生的權重不是經校準的機率；目前 `confidence` 為 null。情緒題仍有已知誤判，速度提升不代表語意正確率提升。

## 2. 專案如何建立

### 2.1 先建立最小可運行版本

最初採 Node.js HTTP server、Ajv 驗證與 Windows portable Ollama，使用 Qwen2.5 小模型完成分類及資料擷取。模型服務綁定 localhost:11435，應用服務綁定 localhost:3210，沒有公開部署。

Ollama 安裝腳本固定版本 v0.34.2，從官方 release 下載、核對 SHA-256 後解壓；執行檔與模型留在 `.runtime/`。前端使用原生 HTML、CSS、JavaScript，無前端建置流程。

隨需求逐步加入：

1. 將首頁改成 State／Problem 編輯器，預載五題客服回饋範例。
2. 支援 `choice`、`noul`、`score`，每題依相同 State 獨立推論。
3. 以中文卡片、估計權重條和等級分數呈現結果，原始 JSON 收在詳細內容。
4. 卡片預設收合，只在標題右側顯示主要結果。
5. 拆分伺服器耗時與傳輸／瀏覽器差值，再加入逐題效能明細。
6. 從 Qwen2.5 1.5B 升級到 3B，接著加入 Qwen3＋vLLM 後端。

### 2.2 資料流與程式分工

```mermaid
flowchart LR
    A[Playground：State / Problem] --> B[Node HTTP API]
    B --> C[驗證問題與生成 Schema]
    C --> D[最多四題並行]
    D --> E[vLLM / Qwen3 / Intel XPU]
    E --> F[Ajv 驗證輸出]
    F --> G[權重正規化與型別化答案]
    G --> H[收合卡片與效能明細]
```

| 檔案 | 職責 |
|---|---|
| `src/server.js` | HTTP 路由、輸入大小限制、同時請求保護、Server-Timing |
| `src/engine.js` | Ollama／vLLM 介接、JSON Schema、逾時、輸出驗證及計時 |
| `src/systemone.js` | Problem 編譯、有限度並行、權重正規化、維持問題順序 |
| `public/app.js` | State／Problem 操作、卡片、原始 JSON、效能明細 |
| `scripts/start-vllm.sh` | 已驗證的 Intel XPU 最佳化設定 |
| `scripts/urjev_xpu_worker.py` | WSL 可用顯存回報異常與 pinned memory／UVA 相容層 |
| `test/` | 格式、錯誤處理、HTTP、並行及後端介接測試 |

`POST /v1/systemone` 接受 `{state, problem}` 或 `{state, questions}`；兩種問題欄位不能同時使用。外部回應維持 `answers`、`usage`、`meta`。

模型內部輸出為具名 `weights`。程式把權重除以總和：choice 選最大值、noul 取 true 權重比例、score 計算從 0 開始的等級加權平均。這些值是模型文字輸出的估計，不是讀取模型 logits 得到的機率。

## 3. 實際使用的環境

| 項目 | 本次驗證環境 |
|---|---|
| 主機與 GPU | Windows、Intel Arc Pro B70，32 GB 顯存 |
| Windows 顯示驅動 | 32.0.101.8804 |
| Linux | Ubuntu 26.04，WSL2；有 `/dev/dxg`，沒有 `/dev/dri` |
| WSL kernel | 6.18.33.2-microsoft-standard-WSL2 |
| Python | 3.12.14，uv 獨立環境 |
| PyTorch | 2.13.0+xpu |
| vLLM | 0.29.1rc1.dev452+g3df4ae153.xpu，官方預覽版 |
| Triton | triton-xpu 3.7.2，搭配 XPU 相容 shim |
| XPU kernels | vllm-xpu-kernels 0.1.14.1 |
| Intel Compute Runtime | 26.05.37020.3 |
| 模型 | Qwen/Qwen3-4B-Instruct-2507，BF16 |
| 模型服務 | localhost:18000；18001 僅用於候選設定驗證 |

模型原始權重約 7.49 GiB。vLLM 環境位於 WSL 的 `~/.local/share/urjev/vllm-env`，權重位於 Hugging Face 標準快取。它不能直接沿用 Ollama 的 GGUF 檔案。

選用 18000 是因為本機 8000 已被其他應用使用。導入過程沒有終止或改動該應用。

## 4. Intel 非 CUDA 路徑如何導入

### 4.1 分層驗證，避免只看到「服務啟動」就當作成功

本次按以下順序驗證：

1. WSL 能看見 GPU 裝置。
2. PyTorch `torch.xpu` 能列出裝置，並完成 BF16 矩陣運算。
3. 同一份模型用 Transformers 在 CPU 與 XPU 上都能回答簡單算術。
4. vLLM 能載入權重及配置 KV cache。
5. vLLM 算術、Schema 約束輸出與五題實際任務正常。
6. 不同並行數、不同內容、重啟後及 Playground 端到端測試通過。

`/health` 或 `/v1/models` 回應正常，只能證明服務可達、模型已註冊，不能證明推論數值正確。

### 4.2 Linux userspace 與 Python 相依套件

本機 Ubuntu 安裝了 `libze-intel-gpu1`、`libze1`、`libze-dev`、`intel-opencl-icd`、`intel-ocloc`、`libnuma1`、`build-essential`。建議安裝時使用 `--no-install-recommends`，先確認套件適用本機 GPU。

Python 套件來自官方 vLLM XPU wheel、XPU shim 與 PyTorch XPU index。`scripts/setup-vllm.sh` 固定 vLLM 預覽版及其 commit 對應 index；其他相依套件並未全部鎖定，因此不能視為完整可重現的環境 lockfile。升級前應保留版本清單並重跑驗證。

### 4.3 實際遇到的相容性問題

| 問題 | 本次觀察 | 處理與界限 |
|---|---|---|
| GPU 初始化崩潰 | 安裝舊世代 Level Zero 額外套件後 `zesInit` 發生錯誤 | 移除本次額外帶入的 `libze-intel-gpu-legacy1-1` 後，XPU 運算通過；不是建議任意移除其他機器的驅動 |
| 可用顯存回報 0 | 總顯存正常，但 WSL free VRAM 為 0 | 以自訂 worker 配合固定 2 GiB KV cache；沒有把總容量冒充可用容量 |
| vLLM 輸出重複字元 | 權重能載入，但回答出現重複 `!` 等內容 | 逐步排除權重、精度與模型基本運算，最後定位到錯誤的 RMSNorm 核心路徑 |
| 缺少 `ocloc` | 診斷 logprobs 時，動態編譯找不到工具 | 安裝 Ubuntu 官方 `intel-ocloc` 套件 |
| 新版 userspace 不可直接替換 | 額外下載的較新 Intel runtime 在本機初始化仍失敗 | 未全域套用那些實驗套件，最終保留通過驗證的版本 |

自訂顯存相容層只在 WSL、free VRAM=0、總 VRAM 至少 24 GiB、明確 KV cache 大於 0 且不超過 3 GiB 時略過自動容量檢查。正式腳本使用 2 GiB。它仍可能因其他 GPU 程序占用而配置失敗，並非通用的 OOM 解法。

## 5. RMSNorm 問題如何定位

一開始採用保守設定：原生 PyTorch 正規化、eager 執行、停用多項加速。這讓結果恢復正常，但不能直接判斷究竟是哪一項改善。

後續使用 `scripts/check-xpu-norm.py` 進行獨立測試：建立 BF16 輸入，把輸出 buffer 先填入 123，再直接呼叫已安裝的 `torch.ops._C.rms_norm`，與 CPU 參考值比較。

| 測試形狀 | 結果 |
|---|---|
| 4 × 128 | 全部有限值，最大絕對誤差 0.015625 |
| 4 × 2560 | 75% 輸出仍是 123，最大絕對誤差 131 |

此現象重現兩次，證明該環境的此核心路徑有漏寫問題，而不是單純「模型不會回答」。但尚不能進一步判定最底層責任在驅動、編譯核心或 vLLM 封裝。

最終以 `kernel-config.ir_op_priority` 指定 `rms_norm` 與 `fused_add_rms_norm` 優先使用 `native`，同時恢復其他經驗證可用的加速。這是局部繞過錯誤，不是修復了所有 Intel／WSL 問題。

## 6. 從 13 秒降到 1 秒的調整

### 6.1 先量測時間花在哪裡

原 vLLM 五題暖機紀錄為 12847 ms，首 token 到末 token 的生成合計 12467 ms，約占 97%；排程至首 token 合計約 346 ms，排隊不到 1 ms。主要時間花在逐 token 生成，而不是網路或 JSON 驗證。

### 6.2 應用層：並行與少輸出

原本五題循序執行。改為最多四題並行，與 vLLM `max-num-seqs=4` 對齊；結果仍按輸入問題順序排列。任一題失敗，停止派發新題並等待已執行工作結束後才回錯誤，避免提早釋放 HTTP 忙碌鎖。

曾嘗試把具名權重改成短陣列，速度可到約 2 秒，但退款、流失及不滿判斷明顯退步，因此未採用。最終只要求 JSON 不縮排、不含多餘空白或換行，保留選項名稱與 Schema，輸出由 190 tokens 減為 105。

| 同一範例的設定 | 實測時間 |
|---|---:|
| 循序、原輸出格式 | 13116 ms |
| 僅四題並行 | 5239 ms |
| 僅緊湊 JSON | 7863 ms |
| 四題並行＋緊湊 JSON | 2784／2882 ms |

### 6.3 GPU 執行層：逐項恢復加速

維持同一份 BF16 權重和 105-token 輸出，逐項調整：

| 設定 | 後續兩次五題耗時 |
|---|---:|
| vLLM 原生模型實作，仍保守執行 | 3053／3144 ms |
| 恢復其他自訂運算，保留 native RMSNorm | 2666／2654 ms |
| 啟用 decode-only XPU Graph | 1109／1062 ms |
| 再啟用 prefix cache | 1081／1016 ms |
| 最終設定重啟至正式服務埠 | 1076／1011 ms |

XPU Graph 是本次最大的執行層改善：錄製並重用 decode 階段的 GPU 執行流程，減少重複派送開銷。prefix cache 的額外收益較小。首次測量可能包含核心暖機，不能與後續測量混為一談。

候選測試時新舊模型服務同時駐留顯存，但推論測試依序執行；切換後已停止舊服務與候選服務，只留下正式 18000 服務。樣本數有限，這些數字不能代替完整 benchmark。

### 6.4 最終設定的取捨

| 選項 | 最終值／原因 |
|---|---|
| 模型實作 | `vllm`，原生實作已通過驗證 |
| 精度 | BF16，沒有在這一步引入量化變因 |
| Attention | `TRITON_ATTN` |
| RMSNorm 與 residual-add RMSNorm | `native`，避開已重現的錯誤核心 |
| 其他 custom ops | `all`，恢復可用加速 |
| XPU Graph | `FULL_DECODE_ONLY`，錄製 batch 1／2／4 |
| 整體模型編譯 | mode 0，未啟用 |
| prefix cache | 開啟，實測通過 |
| async scheduling | 關閉，本次未證實可安全恢復 |
| pinned memory／UVA | WSL worker 中關閉；這不是已證實的原始根因 |
| context／KV cache | 8192 tokens／固定 2 GiB |

完整啟動參數以 `scripts/start-vllm.sh` 為準。因為明確指定 KV cache bytes，不能把 `gpu-memory-utilization=0.65` 理解成總顯存的硬性使用上限。

## 7. 為什麼以前 Ollama 也能做到一秒

| 歷史版本 | 五題耗時 | 生成速度 |
|---|---:|---:|
| Qwen2.5 1.5B Q4_K_M／Ollama | 995 ms | 約 197 tokens/s |
| Qwen2.5 3B Q4_K_M／Ollama | 1806 ms | 約 130 tokens/s |

當時模型較小、使用量化，且 1978 個輸入 tokens 中有 1973 個命中快取；不能只用框架名稱比較速度。現在約一秒使用的是較大的 Qwen3-4B BF16，加上應用層並行與 XPU Graph，也不是與舊版完全相同的工作負載。

## 8. 驗證結果與尚未解決的問題

- 23 項應用程式測試通過，包括輸出格式、逾時、錯誤、並行上限、問題順序及失敗後等待在途工作。
- 每組候選設定先驗證兩個算術問題，再執行五題 JSON 任務。
- 15 輪五題測試輪替 1／2／4 並行，並改變 State 記錄 ID；這是在測試不同請求與執行形狀，不是 15 種語意案例。
- 四題並行的五輪為 1041、990、993、1029、981 ms。技術主題、退款、續訂與不滿分數區間檢查通過。
- 另以四筆退款／物流不同內容測試，確認沒有把前一份答案當成快取回傳。
- 情緒題仍選 negative，依「肯定與不滿並存」規則應為 mixed；這項沒有被算成語意通過。
- 顯存可用量仍回報異常，未取得實際記憶體頻寬、功耗或完整 GPU 利用率剖析。

目前輸出機率只是權重正規化。JSON Schema 保證形狀，無法保證模型遵守每一條語意定義。後續可針對情緒規則拆成肯定／不滿的證據判斷，再以獨立測試集驗證；本次沒有把這項改動混入效能調整。

## 9. 啟動、驗證與切回保守模式

在已建好的 Windows／WSL 環境，於專案根目錄開兩個終端：

```powershell
# 終端一：模型服務
npm run model:vllm

# 終端二：應用服務
npm start
```

瀏覽器開啟 `http://127.0.0.1:3210/`。`.env` 使用 `.env.vllm.example` 的設定：backend=vllm、模型 Qwen3-4B、URL localhost:18000。

如果要切回保守模式，先停止目前模型服務，再執行 `npm run model:vllm:safe`；兩個模式使用相同埠，不可同時啟動。保守模式仍保留 native RMSNorm 與 WSL 顯存相容層。

```powershell
npm test
node scripts/benchmark-xpu.js verification http://127.0.0.1:18000
node scripts/stress-xpu.js http://127.0.0.1:18000
```

上述測試會產生或覆寫 `reports/` 的對應結果。診斷核心可在 Ubuntu 執行：

```bash
~/.local/share/urjev/vllm-env/bin/python /mnt/f/sideproject/urJev/scripts/check-xpu.py
~/.local/share/urjev/vllm-env/bin/python /mnt/f/sideproject/urJev/scripts/check-xpu-norm.py
```

搬到另一台機器時，先安裝適用的 Windows GPU 驅動、WSL2、Ubuntu、Intel userspace 套件及 uv，再執行 `scripts/setup-vllm.sh`。資料夾或 WSL distribution 名稱不同時，需調整路徑及 PowerShell wrapper 的 `Ubuntu` 名稱。不可只複製相容層就假設所有 Intel 顯示卡皆適用。

## 10. 版本控制與證據

程式、啟動腳本、測試、範例及本文納入 Git。`.env`、`.runtime/`、`node_modules/`、一般執行報告及 Python 暫存檔排除。模型權重、Linux venv 和驅動不提交到 Git。

本次精選的實測快照放在 `docs/benchmarks/`，避免一般 `reports/` 被後續測試覆寫後失去依據：

- `feedback-before-3b.json`、`feedback-3b-warm.json`：歷史 Ollama 數據。
- `systemone-optimization.json`：應用層最佳化比較。
- `xpu-baseline.json`、`xpu-native-model.json`、`xpu-custom-all.json`、`xpu-graph.json`、`xpu-graph-cache.json`：XPU 分階段比較。
- `xpu-production.json`、`xpu-stability.json`：最終服務與穩定性檢查。
- `xpu-norm-diagnostic.txt`：核心漏寫重現結果。

這些快照包含本次範例的推論結果，不應在將來直接複製真實客戶資料作為公開 benchmark。

## 11. 官方參考入口

- [Qwen3-4B-Instruct-2507 模型](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)
- [vLLM GPU／Intel XPU 安裝](https://docs.vllm.ai/en/latest/getting_started/installation/gpu/)
- [vLLM 逐請求計時](https://docs.vllm.ai/en/latest/features/per_request_metrics/)
- [vLLM IR 與運算實作選擇](https://github.com/vllm-project/vllm/blob/main/docs/design/vllm_ir.md)
- [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)

官方頁面可能隨版本更新；本文的相容性結論以所列版本、程式碼與實測快照為準。
