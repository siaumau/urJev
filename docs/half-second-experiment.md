# 0.5 秒挑戰：結果與取捨

2026-09-22。目標是同一份五題 State／Problem、真實推論、維持外部 API，暖機後多次測量低於 500 ms。本輪**尚未達成**。

## 交錯比較

基準服務與候選服務使用同一張 Intel Arc Pro B70，分別在 18000／18001 埠；推論交錯依序執行，並非同時施加負載。每組先跑兩輪暖機，再收集十次。模型仍為 Qwen3-4B-Instruct-2507 BF16，沒有更換模型或使用答案快取。

| 實驗 | 同組基準中位數 | 候選中位數 | 候選範圍 | 低於 500 ms |
|---|---:|---:|---:|---:|
| 精確錄製 batch 1–8 | 680 ms | 677 ms | 660–711 ms | 0/10 |
| 編譯正規化＋移除 JSON 外層，Triton attention | 693 ms | 554 ms | 534–571 ms | 0/10 |
| 同上，改用 Flash Attention | 692.5 ms | 536.5 ms | 517–715 ms | 0/10 |

精確 batch 的改善很小，未採用。Flash Attention 在本次小樣本中中位數略低，但有較慢的單次波動；不能視為普遍優於 Triton。最終候選採 Flash Attention，並通過後續穩定性檢查。

## 實際保留的調整

1. `urjev_compiled_worker.CompiledNormWorker` 繼承既有 WSL worker，只將 vLLM 原生 `rms_norm`／`fused_add_rms_norm` 以 `torch.compile(fullgraph=True, dynamic=True)` 編譯融合。沒有重新啟用已證實漏寫的 `_C.rms_norm`，也未開啟整個模型的 torch.compile。這個 hook 依賴 vLLM 內部 IR registry，限制在已驗證的版本；版本不符會明確拒絕並提示使用保守模式。
2. 內部輸出保留具名選項，移除 `{weights: ...}` 包裝，105 tokens 降為 95。外部 `answers`／`usage`／`meta` 與輸入 State／Problem 格式不變；`meta.output_format` 標記為 `flat_named_weights`。Ollama 仍保留原本具名 weights 格式。
3. 啟用 Flash Attention，保留非同步排程、最多八題並行、prefix cache、graph batch 1/2/4/8。保守模式不使用編譯 hook，仍使用原生正規化與 Triton attention。

數值測試涵蓋兩種正規化、寬度 128／2560、列數 1／5／64，共 12 組。與 CPU 參考值比較，最大絕對誤差最高 0.0625；採 BF16 容差 atol=0.0625、rtol=0.02，全部通過。這是容差驗證，不代表位元完全相同或已涵蓋所有形狀。

## 判斷品質與穩定性

六組額外的正面、負面、中性、價格、客服及混合回饋案例，各檢查情緒、退款及停止續訂，共 18 項；基準與候選均為 17/18。混合情緒案例兩者皆錯，只是選到不同的錯誤類別；本輪沒有修正原有情緒判斷問題。這組小型測試不能證明所有資料品質都不退步。

另跑 15 輪五題，並行數輪替 1／4／8。八並行的五輪耗時為 531、550、566、587、538 ms；技術問題、退款／續訂意圖及不滿分數範圍檢查通過。四筆不同退款／物流分類也通過。應用程式 24 項測試通過，包含權重驗證、順序、併發上限及失敗排空。

## 重現與回復

在已安裝環境執行 `npm run model:vllm`、`npm start`。初次核心編譯與暖機會較慢。若編譯或版本相容性有問題，停止模型後使用 `npm run model:vllm:safe`；不要同時占用相同埠。

數值檢查：在 WSL 執行環境的 Python 跑 `scripts/check-compiled-norm.py`。新舊比較需準備兩個模型服務，18000 為基準、18001 為候選，再執行 `node scripts/compare-latency.js REPORT_NAME flat`。該命令對基準使用原包裝、候選使用平面具名輸出，並保存完整結果。

語意比較用 `node scripts/compare-quality.js flat`；穩定性用 `node scripts/stress-xpu.js URL 1,4,8 REPORT_NAME`。這些命令會寫入／覆寫 `reports/`。

精選原始紀錄位於 [benchmarks/half-second](benchmarks/half-second)。若要進一步追求穩定低於 500 ms，需要新的實驗，例如量化或推測解碼；它們未在本輪導入，也不能預先保證速度與品質。

切換正式本機服務後，三次 API 測量為 1601、576、705 ms（第一筆包含暖機影響）。實際運行仍有波動，不能將 536.5 ms 視為每次請求的保證。原始資料見 benchmarks/half-second/xpu-fused-production.json。
