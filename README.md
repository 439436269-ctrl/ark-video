# ark-video

火山方舟 **Seedance 文生视频**零依赖命令行（Node ≥ 18）。

**原子能力，单条为限**：只做「一条 prompt → 一条 mp4」的创建/查询/用量/估价。批量编排、时间轴剪辑、多平台发布都刻意不包含——需要编排请在外层脚本循环调用本工具。

## 安装

```bash
npm install -g @vfvrpq/ark-video
```

## Key 配置（三选一）

1. 环境变量 `ARK_API_KEY`（或 `ARK_STD_KEY`）
2. `~/.ark-video/config.json` → `{"apiKey": "..."}`

> 标准方舟 key 打 `/api/v3`；Agent Plan key 走 `/api/plan/v3`，混用必 401。

## 快速开始

```bash
# 生成一条 5 秒 720p 竖屏视频（创建 → 轮询 → 下载）
ark-video create --prompt "清晨轻舟从白帝城下解缆驶入彩云江面，镜头跟拍，古风写实电影感，无水印" --out clip.mp4

# 查任务状态
ark-video task cgt-xxxxxxxx

# 查某任务的真实 token 用量与金额
ark-video usage cgt-xxxxxxxx

# 不联网估价：5 秒多少 token、多少钱
ark-video price --seconds 5
```

### create 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `--prompt` | （必填） | 画面与镜头描述；文字不要写进画面 |
| `--duration` | 5 | 秒数（实测 5~14 OK，2 秒被 400 拒；上限以报错为准） |
| `--ratio` | 9:16 | `16:9` / `1:1` 可选 |
| `--resolution` | 720p | `480p` 可选 |
| `--model` | doubao-seedance-2-0-mini-260615 | 完整模型 id |
| `--out` | video-\<taskId\>.mp4 | 输出路径 |
| `--audio` | 关 | 附带生成音频 |
| `--timeout` | 1200 | 轮询超时（秒） |
| `--json` | 关 | 机器可读输出 |

## token 与价格

- **用量公式**（720p / 9:16 / mini 实测对账）：`tokens = 21600 × 秒数 + 900`
  准确值以 `ark-video usage <taskId>` 返回的 `usage.completion_tokens` 为准（官方同样以该字段为准）。
- **刊例价（2026-09-30，元/百万 token）**：`seedance-2.0-mini` **23**（≈0.5 元/秒@720p，企业用户限时 4 折至 2026-10-07）；`2.0-fast` 37（75 折）；`2.0` 46；`2.5` 70。
- **仅成功生成计费**，失败/审核不过不收费。
- 示例：5 秒 ≈ 108,900 tokens ≈ **¥2.50**（刊例）/ ¥1.00（4 折）；14 秒 ≈ 303,300 tokens ≈ ¥6.98 / ¥2.79。

## 范围声明（为什么没有批量命令）

npm 包保持**原子能力**：`create` / `task` / `usage` / `price` 四个动词，各做一件事。
批量出镜头、按时间轴合成成片、分发到多平台属于编排层，交给调用方脚本或上层工具（如成片流水线、发布总控），避免把易变的编排逻辑锁进底层包里。

## License

MIT © vfvrpq
