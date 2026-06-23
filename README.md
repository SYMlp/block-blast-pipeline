# Block Blast Pipeline — Spec-Driven A/B Variant Generation for Casual Games

[![harness](https://img.shields.io/badge/harness-unit%20%2B%20sim%20%2B%20verify-brightgreen)](.github/workflows/ci.yml)

> **一句话：** 把一句**人话假设**自动喷成一个**经 Harness 验证的 A/B 游戏变体**的 AI Coding 流水线。人写"想要什么感受",AI 翻译成参数 + 可测目标,Harness 验证那个翻译成没成,达标放行 / 否则打回重试。以方块消除(Block Blast 类)为负载。
>
> **One line:** a human writes a *feel hypothesis*; an AI translates it into parameters + measurable targets; a headless harness verifies whether the feel landed, and promotes or rejects. The game is the payload; the verifiable human→parameter loop is the product.

**🎮 玩玩 AI 生成的那个变体：** <https://symlp.github.io/block-blast-pipeline/?variant=ai-brisk>
　切 `?variant=control | compact | relaxed | hard-mode | ai-brisk` —— 同一引擎,五种行为。

**🏛️ 我们怎么一步步想到并造出来的(演进时间线)：** **<https://symlp.github.io/block-blast-pipeline/process.html>**

---

## 0. 怎么演化来的（先看这个）

这个 demo 不是一开始就长这样的。它经历了真实的撞墙→改：

1. 从 JD 原文拆技术名词当调研入口 →
2. 搭第一版,**红队抓出"死参数"**(说明里把引擎根本没读的参数当 A/B 维度)→ 立铁律"能做真就做真,做不成就删" →
3. "六个旋钮"被一个问题戳破:**人类感受↔程序参数到底怎么转换?** → 升级成**三层 DSL** →
4. 迁移我在另一个项目(等保 SOC 系统)里跑在 50+ 实体上的声明式 DSL 方法论,用它自带的"防注水闸"守住 →
5. 表面找不到"该测什么" → **认知推导到底层**(玩的本质→休闲特化→可测代理),挖出"两道悬崖" →
6. 凭直觉押的指标(占用率)**被真实数据淘汰**,换成实测强区分的三个 →
7. 闭环成真:门禁有牙齿(`relaxed` 被自动淘汰、一次失败的 AI 生成被自动删档)+ AI 真受约束(它给自己许的 band 兑现不了就被打回,见 §4 两次真实运行)。

完整图文见 **[process.html](https://symlp.github.io/block-blast-pipeline/process.html)**。

**两条同构(换 payload、不换架构):** 流水线的 **agent 回路**(生成→验证→反思重试)≈ 我的指标派单练手项目;声明式 **DSL** ≈ 我 SOC 项目的 `model.yaml` 元引擎(一源多投影 + 分层护栏)。两者都不是为这个 demo 从零现搭的。

---

## 1. 流水线全景

```
[一句人话假设] → [AI 生成] → [Harness 门禁] → [促 / 汰] →（survivors）真人 A/B
                 claude CLI    schema·sim·verify   PROMOTE/REJECT
                 params+targets  - - - - - - - -
                                 L3 LLM-judge（骨架/未接入）
```

实线 = 真跑通且进门禁。`reflect_and_fix` 自修复回环**现在是真的**(下面 §4 有两次真实运行:一次失败被自动丢弃、一次达标);唯一仍是骨架的是 L3 LLM-judge。节点图见 [`docs/pipeline.md`](docs/pipeline.md)。

## 2. 三层 DSL：把"人类感受↔参数"的转换显式化

这是作品的核心。普通 CRUD 里"名称必填→`required:true`"是无损 1:1 映射;游戏里"想要更紧张"对应**一束**参数、方向靠猜、**对不对只能事后测**——这正是休闲游戏一年跑上万次 A/B、成功率仅 ~3% 的根本原因。所以每个变体声明三层([`config/variants/control.json`](config/variants/control.json)):

```jsonc
{
  "intent": {                          // ① 意图层（人写人读）
    "hypothesis": "平衡基线:既不贴无聊崖也不贴挫败崖",
    "targets": [                       //    人话假设 → 可测代理 + 双边带
      { "proxy": "rescueRate",    "band": [0, 0.05],    "represents": "公平感" },
      { "proxy": "clearRate",     "band": [0.25, 0.55], "represents": "秩序节拍" },
      { "proxy": "rewardEntropy", "band": [0.2, null],  "represents": "惊喜供给" },
      { "proxy": "stepsP90",      "band": [15, 60],     "represents": "节奏/可中断" }
    ]
  },
  "board": { ... }, "spawn": { ... }, "scoring": { ... }, "difficulty": { ... }  // ② 参数层
}                                                              // ③ 验证层 = harness 拿 targets 比对 sim 实测
```

`harness/verify/check-targets.js` 读 `intent.targets`、比对 sim 实测代理,**全落带内 → PROMOTE,任一出带 → REJECT**。这把"翻译成没成"变成机器可判。schema 见 [`config/schema.json`](config/schema.json)。

## 3. Harness：三层，怎么自动证明变体是对的

**L1 — 属性测试(Vitest + fast-check)** · `harness/unit/` ·**13 用例全过**
6 条属性不变式(随机 play 下恒成立:棋盘恒 W×H、放置守恒、消行无残留、非 game-over 必有合法落点、score 单调、combo 仅连消递增)+ 5 条样例断言 + **2 条迁移奇偶校验**(见 §6:TS 核与 JS 引擎逐位一致)。

**L2 — headless 模拟(Node 跑 200 局/变体)** · `harness/sim/headless-sim.js`
确定性贪心 agent(非玩家技能模型,是探针/fuzzer)把每个变体玩到结束:(1) 门禁——0 崩溃 + 每步 < 16ms,不过 exit 1;(2) **行为指纹**——下表那些代理。

**L3 — LLM-as-Judge(骨架/未接入)** · `harness/eval/` —— prompt 装配与 claude 调用是真的,但未进门禁。

### 真实门禁裁决（200 局/变体,0 崩溃）

| 变体 | clearRate | rescue率 | rewEnt | stepP90 | 裁决 |
|---|--:|--:|--:|--:|:--|
| control 基线 | 0.333 | 0.018 | 0.29 | 29 | **PROMOTE** |
| compact 紧凑 | 0.476 | 0.057 | 0.56 | 31 | **PROMOTE** |
| hard-mode 高难 | 0.426 | 0.098 | 0.34 | 11 | **PROMOTE** |
| ai-brisk（AI 生成）| 0.492 | 0.112 | 0.44 | 17 | **PROMOTE** |
| **relaxed 宽松** | 0.254 | 0.001 | **0.12** | **170** | **REJECT** |

> `relaxed` 被自动淘汰才是门禁有牙齿的证据:一个"看似人畜无害的轻松版",harness 判它 `rewardEntropy 0.12 < 0.2`(太闷)+ `stepsP90 170 > 60`(拖沓)= 贴在无聊崖上,打回——不靠人肉试玩。全 PASS 的门禁等于没门禁。
>
> 代理是确定性的(seed 固定,任何机器逐位复现);完整 JSON 见 `harness/sim/last-run.json`。注:`avgEndOccupancy`(占用率)曾被押作"公平感"代理,但实测在各变体间是平的(0.60–0.66,被贪心 agent 抹平),**已淘汰**——指标不是猜的,是被数据筛出来的。
>
> CI 不止报告还**兜底**:每个变体声明 `intent.expect`(PROMOTE / REJECT),`npm run verify:ci` 在实测裁决偏离 expect 时 `exit 1`(裁决回归守护)。`relaxed` 声明 `expect: REJECT`,所以这个故意反例不会染红 CI——只有"本该 PROMOTE 的变体悄悄跑挂了自己的门禁"这种真回归才挂 CI。

## 4. AI 生成闭环：harness 是 AI 的裁判,不是 AI 的橡皮图章

`python scripts/build_variants.py --new "<假设>" --id <id> [--max-attempts N]` 跑真 agent loop(claude CLI 生成 params + 自己声明的 `intent.targets` → schema → sim → verify → 把**结构化失败反馈**喂回重试 → 耗尽次数则**删档不放行**)。claude 输出是非确定的,所以这是一条真闭环、不是录像。两次真实运行,同一句假设"给熟练玩家的明快变体:节奏快、消除频繁、惊喜足,但保持公平、单局仍碎片化":

**运行 A(`--max-attempts 3`)——失败被自动丢弃:** AI 把 `clearRate` 地板定到 `0.45`,但贪心 agent 在这套参数域里消除率顶到 ~0.44 就上不去了,三次都差一线 → 候选 `unlink` 删除,**没蒙混进仓**。这正是"做不成就删"铁律在 loop 里长出的牙齿。

**运行 B(`--max-attempts 6`)——attempt 1 即 PROMOTE:** 这次 AI 给自己定了**能兑现**的带(`clearRate ≥ 0.4`、`rewardEntropy [0.25,0.6]`、`rescueRate ≤ 0.12`、`stepsP90 ≤ 60`),并选 7×7 + extended + DDA 的参数把四项一次打进带内:

| proxy | measured | band | verdict |
|---|--:|:--|:--|
| rescueRate | 0.112 | [0, 0.12] | PASS |
| clearRate | 0.492 | [0.4, +∞] | PASS |
| rewardEntropy | 0.442 | [0.25, 0.6] | PASS |
| stepsP90 | 17 | [−∞, 60] | PASS |

两次对照才是重点:**门禁约束的不只是参数,还有 AI 给自己许下的承诺(band)。** A 里 AI 许了个兑现不了的承诺被门禁打回并丢弃;B 里 AI 学乖、许了能兑现的承诺并一次达标。产物 [`config/variants/ai-brisk.json`](config/variants/ai-brisk.json)(运行 B 的真实产物)现在可在线玩。复跑脚本会重新生成,结果随模型采样变化——失败的永远不会留在仓里。

## 5. 指标从哪来：认知推导,不是拍脑袋

"该测什么才代表好玩"这个问题,表面调研给不出答案,所以从根上推导(四轴,见 [`research/.../SYNTHESIS-feel-to-metric-derivation.md`](research/ai-coding-casual-game-pipeline-2026-06-22/notes/SYNTHESIS-feel-to-metric-derivation.md)):

- **玩的本质**(Koster):fun = 大脑掌握模式的快感;方块消除是近乎纯粹的"模式掌握引擎"。
- **休闲特化**:把胜任感打包成零摩擦、可中断的微剂量。
- **拱顶石**:难度 = 把玩家卡在**无聊崖**(模式被吃透)与**挫败崖**(模式装不起)之间的窄带 → 所以验证用**双边带**而非单向最大化。
- **可测边界**:胜任/心流 = 游戏状态空间的客观属性,headless 能测;**自主感/联结/真留存/付费必须真玩家**——headless 只是第一道粗筛闸。

## 6. TS 逻辑核 + Cocos 对齐

技术栈对齐 Cocos Creator 3.8 + TypeScript。`core/` 是**纯 TS 逻辑核(不 import `cc`)**,日后直接落进 `assets/scripts/core/`;Cocos Component 只做渲染壳。迁移零行为漂移由 L1 的**奇偶校验**守护:同 seed 下 TS 新核与原 JS 引擎跑遍 4 变体 × 50 种子 × 全程逐步,状态逐位一致。`tsc --noEmit` 类型干净。**渲染壳在搭(等本机 Cocos Creator 装好)。**

## 7. 怎么跑

```bash
npm install
npm test                 # L1 属性测试 + 奇偶校验（13 用例）
npm run typecheck        # tsc --noEmit（TS 逻辑核）
npm run sim              # L2 headless 模拟 + 行为指纹 → last-run.json
npm run verify           # 验证层门禁报告（PROMOTE / REJECT，只报告）
npm run verify:ci        # 裁决回归守护：实测裁决≠intent.expect 则 exit 1（CI 跑这条）
python scripts/build_variants.py --new "<假设>" --id myvar   # 真 AI 生成闭环（需 claude CLI）
npx serve .              # 可玩 demo：http://localhost:3000/index.html?variant=ai-brisk
```

## 8. 诚实的边界

- **真跑、可复现**:TS 逻辑核(奇偶校验)、13 属性测试、headless 门禁、三层 DSL + verify、claude 真生成的 ai-brisk。
- **进行中**:Cocos 渲染壳(逻辑核已就绪)。
- **刻意没做 / 测不了**:L3 LLM-judge 是骨架;Codebase RAG 当前代码量小不需要(扩到真实 Cocos 项目再上 repo map);CI 里 Cocos 引擎打包需 GUI 编辑器,托管 runner 跑不了(诚实标注,生产用自托管 runner);**真正的"好不好玩、留存、付费"必须真玩家 A/B**。
- **没接真实 Firebase / 玩家数据**:`ConfigLoader.js` 留了注释掉的 Remote Config 分桶接口,示意生产怎么用 `hash(expId+installId)` 下发同一份代码的不同行为。

## 9. 设计依据 / 参考

- 玩的本质:Huizinga《Homo Ludens》、Suits《The Grasshopper》、Koster《A Theory of Fun》、MDA 框架;动机:SDT(Ryan & Deci)、Flow(Csikszentmihalyi)。
- Spec-Driven Development:GitHub spec-kit、Amazon Kiro(EARS)、Tessl;DSL:Fowler《Domain-Specific Languages》。
- Harness Engineering:Mitchell Hashimoto(2026-02 命名);fast-check 属性测试;self-repair 反馈质量瓶颈(Olausson et al., ICLR 2024)。
- 玩法/数值:Block Blast / 1010! 计分逆向、DDA(Hunicke)、Random-bag 可解性保证;A/B:Firebase Remote Config 哈希分桶。
