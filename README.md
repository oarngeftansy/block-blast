# Block Blast

A Block Blast game prototype built with React + Vite, focused on demonstrating difficulty-curve scheduling and an "experience roller-coaster" scoring system.

## 玩法 / Gameplay

- 拖动方块到 8×8 棋盘上放置，填满整行或整列即可消除。
- 真实 Block Blast 计分结构：落子保底分 + 多消递增倍率 + combo 乘法 + 断条机制。
- 道具：撤销 (Undo)、炸弹 (Bomb, 3×3)、行列清除 (Line)。

## 两条主线 / Two design tracks

1. **难度曲线调控 (Difficulty scheduling)**：ASS 分层 → 难度循环序列 →（层级 × 难度）查表选模板 → 展开 DG 序列 → 按当前 DG 等级发牌，控制可解路径数。
2. **体验过山车 (Experience roller-coaster)**：局内手感反馈 + 局间分数曲线。

顶部可切换「体验视图 / 难度调控视图」用于演示。

## 运行 / Run

```bash
npm install
npm run dev
```

然后在浏览器打开 Vite 提示的本地地址。
