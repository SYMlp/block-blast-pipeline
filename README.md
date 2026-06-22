# Block Blast Pipeline — Spec-Driven A/B Variant Generation for Casual Games

[![harness](https://img.shields.io/badge/harness-unit%20%2B%20sim-brightgreen)](.github/workflows/ci.yml)

> **一句话定位：** 一条把"一份参数化 Spec"自动喷成"多个经 Harness 验证的 A/B 游戏变体"的 AI Coding 流水线，把单变体交付从天级压到分钟级。以方块消除（Block Blast 类）为负载演示。
>
> **One line:** an AI-coding pipeline that turns *one parameterized spec* into *many Harness-verified A/B game variants*. The game is the payload; the verifiable generation pipeline is the product.

## TL;DR（给 30 秒读者 / 机器初筛）

- **问题：** 休闲游戏一年跑上万次 A/B 实验、日均 300+，人手写变体到不了这个量级。
- **方案：** Spec(YAML) → AI 生成 → Harness 三层验证 → N 个 config 变体 → CI/CD。
- **技术栈：** 纯 JS 引擎（零依赖、可 headless 测）+ Vitest/fast-check 属性测试 + Node headless AI 玩家 + LangGraph 编排 + claude CLI。
- **可玩 demo：** 起本地静态服务后打开 `index.html`，切 `?variant=control|compact|relaxed|hard-mode` 看**同一份引擎跑出不同行为**。

---

## 1. 流水线全景（一张图）

```
[Spec(spec.yaml)] → [AI 生成] → [Harness L1/L2/L3] → [N 个变体 config] → [CI/CD] → [A/B 上线]
   变体矩阵          parse_spec     属性测试/headless     同引擎不同行为      push 门禁    Firebase 分桶
   EARS 验收         generate_code  AI玩家/LLM judge       config-driven
   三层 Guardrail    reflect_and_fix（失败回环 ≤3）
```

完整工位说明 + LangGraph 节点图见 [`docs/pipeline.md`](docs/pipeline.md)。

## 2. Spec-Driven：一份 Spec 长什么样

代码（变体 config）是 Spec 的**派生物**，不是 Spec 是代码的注释。[`spec.yaml`](spec.yaml) 里有：

- **变体矩阵** — 4 个 A/B 臂（control / compact / relaxed / hard-mode），每个声明 `intent` + `overrides`。
- **EARS 验收标准** — `WHEN … THE SYSTEM SHALL …` + few-shot 样例（消行、可解性保证、game over、确定性、差异性）。
- **三层 Guardrail** — Always / Ask-first / Never，生成前喂给 agent（引擎零 DOM、变体必过 schema、放置逻辑禁用 `Math.random()` 等）。

参数收敛进一张 JSON Schema（[`config/schema.json`](config/schema.json)）——board / spawn / scoring / difficulty / juice 五段，每个字段就是一个 A/B 维度。

## 3. Harness：怎么自动证明生成的变体是对的

这是作品的硬度来源。三层，全部可跑：

**Layer 1 — 属性测试（Vitest + fast-check，6 条不变式）** · `harness/unit/invariants.test.js`
随机play下恒成立的契约，而非挑好的样例：① 棋盘恒 W×H ② 放置后格子非半态 ③ 消行后无残留满行 ④ 非 game-over 必有合法落点 ⑤ score 单调不减 ⑥ combo 仅在连续消行递增。

**Layer 2 — headless AI 玩家（Node 跑 200 局/变体）** · `harness/sim/headless-sim.js`
确定性贪心 agent（每步选消行最多的放置，seed 可复现）。这是迦游 Block AI Robot 的**最简版**——同一架构（自动玩家上线前预筛变体），贪心策略约 60% 对齐 vs 其深度模型 80%。门禁：0 崩溃 + 单步 < 16ms。

**Layer 3 — LLM-as-Judge（加分项）** · `harness/eval/`
`claude -p` 读 rubric + 变体 config + sim 指标，五维度 10 分制打分，门禁每维 ≥7。走 OAuth 订阅登录，非 SDK。

### 本次真实 sim 输出（200 局/变体，0 崩溃）

```
Headless sim — greedy agent, 200 games/variant

variant     games  crashes  avgScore   avgSteps   avgLines   maxStep(ms)
------------------------------------------------------------------------
control     200    0        297.5      51.4       17.4       1.42
compact     200    0        377.7      41.2       16.4       0.35
relaxed     200    0        799.3      166.7      44.1       0.50
hard-mode   200    0        355.9      33.0       11.9       0.43
------------------------------------------------------------------------

GATE PASSED: 0 crashes across 4 variant(s).
```

读这张表（这才是 Harness 的价值——变体差异是被**测出来的**，不是嘴上说的）：

- **relaxed**（10×10 大棋盘、低密度）存活 ~167 步、均分 ~799——明显比 control 喘息更多、跑得更久。
- **hard-mode**（大片为主、无 DDA 救援）只活 ~33 步——最短最残暴，符合声明意图。
- **compact**（7×7 小棋盘、二次连击）每步得分最高、节奏最快。

四个变体的行为**显著不同**，证明 config-driven 变体是真的在改游戏行为，不是换皮。

## 4. Config-Driven 变体：同一引擎，N 种行为

| 维度 | control | compact | relaxed | hard-mode |
|---|---|---|---|---|
| 棋盘 | 8×8 | 7×7 | 10×10 | 8×8 |
| 生成密度 | 0.5 | 0.7 | 0.3 | 0.65 |
| 片库 | standard | standard | minimal | extended |
| 大片权重 | 1.0 | 1.2 | 0.7 | 2.0 |
| 计分系数 | 5 | 6 | 5 | 8 |
| 连击曲线 | stepped | quadratic | linear | quadratic |
| DDA | 开 | 开 | 开 | 关 |
| 震屏/粒子 | 0.3 / 10 | 0.4 / 12 | 0.25 / 8 | 0.6 / 18 |

切换不刷页面（`ConfigLoader.loadVariant(id)` → fetch → 失败回退 control → `new GameEngine(config)`）。**浏览器运行时零依赖**（不依赖 CDN，断网也能开）；schema 校验是 **Node 侧的流水线门禁**（`config/validate.js` + 上面 Layer 1 的「变体符合 schema」检查），把校验放在 AI 生成新 config 的关口、而非玩家设备上。`ConfigLoader.js` 里留了**注释掉的 Firebase Remote Config 覆盖分支**，明示生产怎么用 `hash(expId+installId)` 分桶下发同一份代码的不同行为。

## 5. Agent 编排（LangGraph）

`scripts/build_variants.py` 是节点图收敛成的可读脚本：`parse_spec → generate_code → run_harness →（失败）reflect_and_fix（≤3 次）→ git_commit`。默认 dry-run（只跑门禁、不调 AI、零凭据）；`--live` 才调 `claude` 生成。

**这条 Spec-生成-验证-自修复状态机，与我的企业级 Agent 项目 incident-dispatch-agent（指标告警自动派单，LangGraph）同构**——告警分类=parse_spec、派单=generate_code、核验=run_harness、重派=reflect_and_fix，护栏/HITL/断路器/可观测性五件套整套可迁。对我来说这不是新东西，是换了个 payload。映射详见 [`docs/pipeline.md`](docs/pipeline.md)。

## 6. 怎么跑起来

```bash
git clone <repo> && cd block-blast-pipeline
npm install

# Layer 1 — 属性测试（< 1 秒）
npm test                 # 等价 npx vitest run harness/unit

# Layer 2 — headless AI 玩家
npm run sim              # 200 局/变体；--games N / --variant id 可调
node harness/sim/headless-sim.js --variant relaxed --games 500

# 流水线 dry-run（跑门禁、不调 AI）
python scripts/build_variants.py

# 可玩 demo（需起静态服务，因为用了 fetch 加载 config）
npx serve .              # 然后浏览器开 http://localhost:3000/index.html?variant=compact
```

## 7. 诚实的边界

- **用纯 JS Canvas 不用 Cocos**：为让流水线逻辑纯粹可测、不被引擎生命周期干扰。Cocos 概念对应关系 + 迁移成本见 [`docs/cocos-mapping.md`](docs/cocos-mapping.md)（render 层要重写，流水线架构不变）。
- **没接真实 Firebase / 真实玩家数据**：用本地 JSON 变体 + headless 模拟代理留存指标；`ConfigLoader` 留了远程覆盖接口。
- **AI 玩家是贪心 agent（约 60% 对齐）**，非深度模型（迦游 Block AI Robot ~80%）——**架构同，精度差**。这是诚实的，也是可升级的：策略层换掉，流水线不动。
- **Layer 3 judge 是骨架**，prompt 装配与 claude 调用是真的，但未接入 CI、默认不在门禁里跑。

## 8. 设计依据 / 参考

- Game Juice：Vlambeer《The Art of Screenshake》、Jonasson & Purho《Juice it or lose it》(GDC 2012)、Penner easing。
- Spec-Driven Development：GitHub spec-kit、Amazon Kiro（EARS 语法）、Tessl。
- Harness Engineering：Mitchell Hashimoto 2026-02 命名；fast-check 属性测试；LLM-as-Judge / DeepEval。
- 玩法/数值：Block Blast / 1010! 计分逆向（消除 r 行 += factor·r·(r+1)/2）、DDA、Random-bag 可解性保证。
- A/B 落地：Firebase Remote Config 哈希分桶、Statsig、Metaplay config archive。
