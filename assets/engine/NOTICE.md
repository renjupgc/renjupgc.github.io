# Rapfi 引擎（WebAssembly 构建）

本站打谱页的「分析」功能用的是 [Rapfi](https://github.com/dhbloo/rapfi) 的
WebAssembly 单线程构建，规则为连珠（renju，黑有禁手），即引擎的 `rule 4`。

| 文件 | 说明 |
| --- | --- |
| `rapfi-single.js` | Emscripten 胶水代码 |
| `rapfi-single.wasm` | 引擎本体（单线程） |
| `rapfi-single.data` | 打包进去的轻量评估数据 |
| `rapfi-worker.js` | 本站写的 Web Worker 封装：收发 Gomocup 协议、把候选点与胜率转给棋盘 |

版本与来源：Rapfi 官方 wasm 构建（单线程无 SIMD 版），取自其在线计算器
`https://gomocalc.com/build/fallback/`，文件未作改动。

许可：Rapfi 以 GPL-3.0 发布，源码见 https://github.com/dhbloo/rapfi 。
