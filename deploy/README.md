# 目前外網部署紀錄

- `ai3.aischool.edu.pl`：Cloudflare Tunnel → `127.0.0.1:15413`，urJev Playground 與 API。urJev `.env` 設定 `PUBLIC_ORIGIN=https://ai3.aischool.edu.pl`。
- `ai2.aischool.edu.pl`：Cloudflare Tunnel → `127.0.0.1:15412`，FastAPI gateway；`POST /v1/systemone` 轉送到 urJev `15413`，原有 Qwen 路由仍转送 ARC Workspace `15415` 並要求 Bearer key。

`ai2-gateway.py` 是本次修改後的部署快照。實際執行檔位於 `F:/sideproject/first_llm_arc/app/gateway.py`；該資料夾不是 Git repository，所以將快照保存在此，沒有替其他專案建立 repository。此檔依賴 FastAPI、httpx、uvicorn，未整合進 urJev 的 npm 啟動流程，也不會自動同步到實際 gateway。

目前 `/v1/systemone` 沒有 API key 驗證；Host／Origin 白名單不是身分驗證。Cloudflare token、`.env` 與其他專案資料未納入版本紀錄。

已實測 ai2 五題 POST 回傳 200 與結構化答案、ai3 首頁回傳 200、原 Qwen `/v1/models` 無金鑰回傳 401。gateway 限制 urJev 請求為 64 KB，保留後端狀態碼，處理 timeout／offline。
