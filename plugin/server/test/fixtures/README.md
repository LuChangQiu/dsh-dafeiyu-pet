# Vendored contract fixtures

来源：`deliverables/pet-integration/docs/`（dsh-scout 契约交付物），逐字节复制，只读。
版本：state fixtures **v1.3 / schema 3 / 54 条**；performance fixtures **v1.1 / 32 条**。
测试默认读本目录（相对 `import.meta.url`），`STATE_FIXTURES` 环境变量仅用于显式覆盖/负例。

| file | sha256 |
|---|---|
| state-fixtures.v1.3.jsonl | 166215d0969ddc8aeac3f3d0398b3e30c0c3779fa4dd5dc8cfeff19de785928d |
| performance-fixtures.v1.1.jsonl | e7dd2f21a420573a6645ea30fc092582db3c2192eea7248cf71c6ad5967d1841 |

更新规则：契约升版时同步复制并更新本表 + 测试内 `EXPECTED_FIXTURES`；缺失/计数不符/JSON 非法 → 测试必须 FAIL。
