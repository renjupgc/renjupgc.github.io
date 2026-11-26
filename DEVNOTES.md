# 连珠杂箱

连珠（五子棋）爱好者的资料站点：赛事报道与赛后记、比赛成绩与对局记录、等级分，外加几个自己用得上的小工具。

纯静态站，托管在 GitHub Pages，直接以 `main` 分支根目录发布。没有框架、没有打包步骤，页面是手写的 HTML，重复的部分（页头、导航、页脚、音乐盒、无刷新跳转）由 `assets/layout.js` 在运行时注入。

在线地址：<https://renjupgc.github.io/>

## 目录

```
index.html            首页：棋手搜索、公告、最近更新
zalun.html  zashi.html  zaxiang.html  zayu.html  zaji.html   五个栏目页（杂论 / 杂史 / 杂想 / 杂豫 / 杂技）
yuce.html             胜率与落子预测（挂在杂技栏目下，独立一级页面）
404.html              找不到页面时的兜底

posts/                文章页（38 篇），自成一体，只有正文在 HTML 里
zayu/                 杂豫：赛事、成绩与棋手
  t{id}.html          每场赛事一页：赛事信息 + 成绩表；名称含「高校」「大学生」的
                      页头再标「选手平均等级分 + 等级」两个徽标（只给平均分与对应等级，
                      不列个人档位）
  p/{姓名}.html       每位棋手一页：等级分走势、参赛记录、逐局战绩、成绩卡
                      （只给 data/public_players.txt 名单里的人出页，现 595 页）
  rating.html         等级分总表（页角挂时光机入口）
  shiguang.html       等级分时光机：拖时间轴看每个比赛日的先验榜单
                      不单独列出，也不进 sitemap：只从 rating.html 的页角进
  renwu.html          人物小传
zaji/                 杂技：工具页
  dapu.html           打谱（含开局命名、同型局、图片认谱）
  molun.html          末轮计算器（含成绩单 OCR）
  predict.html        胜率预测
  jinzhao.html        棋形判断与禁手找茬（两种玩法共用一块盘，答对有动效，每题计时）
  vcf.html            VCF 做题
  duoguan.html        绝对冠感：十人单循环的夺冠概率与现场出题的小测验
                      暗门，只敲地址（不进导航、不进 sitemap，页头 noindex）
  katago.html         KataGomo 分析：拿 renju/ 里的模型与 onnxruntime 做局面分析
                      同上，暗门，只敲地址
  shida.html          开局综合判断
  english.html        连珠英语：四级词汇 + 连珠术语、五子棋阅读题，进度可备份
bisai/index.html      单届选拔赛成绩表（现为「暂不公开」占位），浏览器里用 sql.js 读 bisai.db
bisai/data/           预测模型的历史版本（model_*.json）与训练用的中间结果，页面不读
api/duiju/            只读 JSON 接口（Actions 定时生成并提交，Pages 直接发）
  index.json          赛事与轮次索引
  shanhai/r1.json     山海杯第 1 轮：逐台对局与预测概率

admin/index.html      访问统计面板（暗门，需密码）
admin/duiju.html      赛果录入：逐台点黑胜 / 和 / 白胜，提交即触发 Actions（暗门）
admin/ops.html        运维控制台（暗门）
admin/zayu.html       杂豫内容管理（暗门）
admin/zalun.html      杂论词云：给 data/zalun-words.json 里的词条开开关，决定哪些进词云（暗门）
assets/
  style.css           全站样式（唯一一份）
  layout.js           页头/页脚/音乐盒/无刷新跳转，顺带注入访问统计
  visit-log.js        访问统计埋点：浏览 / 点击 / 搜索 / 停留，发到 ntfy 通道
  account.js          全站账号：右上角登录 / 注册 / 会话 / 进度，后端是 Supabase
  supabase-config.js  Supabase 的 url 与 anon key（唯一需要填的配置）
  supabase-client.js  从 CDN 加载 supabase-js，建单例客户端
  progress.js         各工具的分数与进度、错题本，按账号同步到云端
  wrongbook.js        错题本面板（三个做题页共用：列条目、重做、删一条）
  board.js            棋盘渲染与交互
  players.js          棋手搜索索引（脚本生成）
  rating-history.js   等级分时序，时光机与棋手曲线共用（脚本生成）
  openings-data.js    有手顺的对局语料，开局与同型检索用（脚本生成）
  openings.js         26 开局命名 + 225 维向量同型检索
  timemachine.js      时光机页面逻辑
  playercard.js  qr.js  棋手成绩卡（Canvas 出图，二维码自研编码）
  qipu.js  qipu/      棋谱数据与复盘（脚本生成）
  predict.js          预测模型参数与交手记录（脚本生成）
  words-cet4.js  words-renju.js   连珠英语词库（脚本生成）
  reading-articles.js 五子棋英语阅读文章与题目（脚本生成）
  zalun-cloud.js      杂论词云：读云端入选词表（后台保存的那份），本地排布成 SVG
  english-app.js      连珠英语：账号、记忆排期、学习/复习/拼写/阅读/词表、进度备份
  jinzhao-app.mjs     棋形判断与禁手找茬：出题、判点、找全判定、本题计时、答对动效（canvas 粒子）
  jinzhao-gen.mjs     禁手找茬出题器（骨架 + 干扰子，密集档摆两三处禁手，复用 vcf-gen 的规则）
  qixing-gen.mjs      棋形判断出题器（连五 / 活四 / 冲四 / 活三 / 眠三，按档位收 1–5 处答案；
                      五种棋形的定义与条款号照《中国五子棋竞赛规则》（2025 年版）第 7 条，
                      禁手照第 8 条（含四三三 / 四四三、五连优先），判红线型也按条文在整
                      条线上算，不截 9 格窗口）
  engine/             Rapfi 引擎 wasm
  vendor/sqljs/       浏览器端 SQLite
  img/  audio/        配图与音乐

data/
  renju.db            赛事主库：tournaments / matches / ratings / players
  manual.db           手工补丁：补录赛事与对局、改名、弃权、隐藏赛事、名次修正
  public_players.txt  可公开的棋手名单：名册之外不出页、不进搜索、不挂内链
  rating_excluded.txt 不计等级分的赛事（非公开进行）：公示表与时光机都按它排除
  adult_players.txt   成人（非高校）棋手：照算等级分、不衰减，但不进榜单，只给预估名次
  duiju.db            对局库：逐台对局 + 预测概率（山海杯等），api/duiju/ 由它导出
  shanhai/2026-r1.json  山海杯第 1 轮的录入源文件（一轮一份）
  visits.ndjson       访问日志：一行一个事件，Actions 定时从通道归档
  english/            连珠英语素材：cet4.txt（四级大纲）＋ renju_terms.json（术语）
                      ＋ reading.json（18 篇五子棋英语阅读、105 道题）
  rif_players.json    renju.net 抓下来的 RIF 档案（编号、段位、等级分、开局偏好、赛事与逐局记录）
  zalun-words.json    杂论正文分词结果（1200 余条：词、次数、覆盖篇数、词性、分类、默认是否入云）

tools/                构建脚本（见下）
  build_all.py        按固定顺序重出全站，末尾跑 check.py
  check.py            只读校验：死链 / 布局结构 / sitemap / canonical / 图片属性
renju/                第三方 Otter Renju 的静态构建（原样放在这里，页面只取其中的
                      ort/ 运行时与 katagomo_renju15.onnx 模型给 zaji/katago.html 用）
labs/                 未上线的试验页，不进导航也不进 sitemap
  allie.html          Renju Allie：浏览器内跑 allie_renju.onnx 的局面分析（早期实验）
docs/ROADMAP.md       改进建议与创意清单
docs/SUPABASE_SETUP.md  账号后端接入指南（建项目 / 跑 SQL / 填配置 / 报错对照）
docs/final_state_stats.txt  末轮状态分档的统计底稿（一次性分析产物）
supabase/schema.sql   账号与进度的建表脚本，在 Supabase SQL Editor 里执行一次
```

## 本地预览

页面用了 `fetch` 做站内无刷新跳转，`bisai/` 还要读 `.db`，所以必须走 http，不能直接双击打开：

```bash
python -m http.server 8000
# 打开 http://localhost:8000/
```

## 构建

页面分两类：手写的（首页、栏目页、文章页、工具页）和生成的（赛事页、棋手页、索引数据）。改完内容最省事的是跑统一入口，顺序已经写死，末尾自动做一致性校验：

```bash
python tools/build_all.py
```

可选开关：`--with-english`（连词库/阅读文章）、`--with-zalun`（杂论词云，需 jieba）、`--with-eval`（棋谱复盘跑引擎，需要 node）、`--no-check`（只生成不校验）。

单独校验（只读，不改文件）：

```bash
python tools/check.py          # 死链、布局结构、sitemap、canonical/og、图片属性
python tools/check.py --strict # 有警告也返回非零，适合放进 CI
```

想手工分步时，按下面顺序跑（`build_all.py` 就是这串命令）：

```bash
python tools/build_zayu.py --rebuild  # 赛事页 + 等级分表 + zayu.html
python tools/build_rating_history.py  # 按比赛日先验重放，导出等级分时序 JSON
python tools/build_players.py         # 棋手主页（含走势图），并给等级分表里的姓名补内链
python tools/build_qipu.py            # 从 matches.board_record 导出棋谱 JSON（--no-eval 跳过引擎）
python tools/build_openings.py        # 导出有手顺的对局语料（开局命名 / 同型检索）
python tools/build_predict.py    # 预测页的模型参数与交手记录
python tools/build_seo.py        # canonical / og: / sitemap / robots / feed / 分享图
python tools/build_img_attrs.py  # 图片尺寸、懒加载
```

连珠英语的词库另走一条：

```bash
python tools/build_english_words.py   # data/english/ -> assets/words-cet4.js、words-renju.js、reading-articles.js
```

杂论词云也另走一条（栏目页加文章之后才需要重跑；它读的是 `zalun.html` 的文章清单，
所以新增一篇不用改脚本，只要跑一次）：

```bash
python tools/build_zalun_words.py      # 13 篇文章 -> data/zalun-words.json（需要 jieba）
```

后台 `/admin/zalun.html` 拿这份词表开开关，保存进云数据库；访客页由 `assets/zalun-cloud.js`
读云端配置现排 SVG，读不到就用词表里 `on=1` 的那批默认词兜底。

下面两个是历次比赛一次性用的生成脚本，输入写死在脚本顶部（本机路径、WHR 数据包），
换机器要改常量：

```bash
python tools/generate_standings_and_r7.py   # 山海杯名次表 + 第 7 轮页面
python tools/build_exact_shanhai.py         # 山海杯逐台页（骨架取 tools/predict-page.template.html）
```

棋手的 RIF 档案（国际连珠联盟那一套编号、等级分与开局偏好）从 renju.net 抓；页面上只登「人」这一层的数字，赛事清单与逐局记录仍以本站成绩表为准：

```bash
python tools/fetch_rif_player.py 102247          # 按 RIF 编号抓，写进 data/rif_players.json
python tools/fetch_rif_player.py --name Pan      # 只按英文名搜，列出候选编号
python tools/build_players.py                    # 重跑棋手页，档案挂到「RIF 国际档案」一节
```

后两个是「全站扫一遍」的脚本，可反复执行（幂等）：手写页面加了新文章、换了配图之后单独跑它们就行。


## 账号与进度（Supabase）

站点是纯静态的，没有自建后端。账号和进度放在 **Supabase**：登录用右上角的「登录 / 注册」，
只要用户名和密码（内部把用户名拼成 `用户名@zbx.example.com` 当账号标识，不需要邮箱验证），
进度按账号存在云端 `user_progress` 表里，换设备登录同一账号就能接着用。

- 前端只有 `anon public` key，权限靠数据库 RLS 把关，登录用户只能读写自己那一行；
- 本地 `localStorage` 仍然留一份缓存（`zbx.progress.v2`），断网也能用，联网后自动同步；
- 配置只改 `assets/supabase-config.js` 一个文件，建表 SQL 在 `supabase/schema.sql`。

**全新部署或想搞清楚每一步在做什么，看 [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)。**

没登录也能用这些工具：打谱、末轮计算、胜率预测、VCF 等不依赖账号；只有背词进度、
四项分数和错题本需要登录才能跨设备同步。

### 计分只结一次账 / 错题本

每道题都有一个 `pid`（VCF 是落子序列 + 胜手数 + 攻方；禁手找茬与棋形判断是局面 +
答案点 + 题型 + 玩法；开局综合判断是书页 + 第五手 + 第几问）。`progress.js` 的
`commit()` 认 pid：同一道题第二次结算直接返回 `dup`，不加分也不扣分——「重来」、
错题本里「重做」做对以后都不再涨分，这是原来的漏洞（重做同一题可以反复刷分），
现在由 `seen` 表挡在计分之前。

`book` / `seen` 都存在进度档案里，跟分数同一个云端 JSON，换设备登录还是这一本。
每个模块最多留 80 条错题、600 个见过的 pid，多的按时间从旧到新丢。

- 做错（VCF 走错手、禁手找茬点错或看答案、开局综合判断答错）就 `bookAdd` 记一条，
  同一 pid 只占一条，重做时把时间往前挪；
- 答对（含错题本里重做对）就 `bookDel` 出本；
- 「擦边 / 半对」不进错题本（开局综合判断的擦边档）。

错题本只在登录后可用：`bookAdd` 拿不到档案就返回 false，面板提示先登录。

还想手动备份的话，连珠英语侧栏的「备份进度」仍然可用，下载 `连珠英语-用户名-日期.json`；
「恢复进度」的合并规则是：记忆卡按「记得更牢」取一条（盒号大的优先，同盒取复习时间更近的，
再取次数多的），每日统计各项取最大值，阅读成绩取最好成绩与最多尝试次数。

将来若真要接后端，`exportData()` 产出的 `{app, v, user, exported, data}` 就是现成的同步载荷，
`importData()` 里的合并逻辑可以原样搬到服务端。

## 连珠英语的阅读题型

- **仔细阅读**（`type: careful`）：一篇 300–375 词短文配 5 道四选一，对应四级 Section C。
- **长篇阅读·信息匹配**（`type: matching`）：一篇 800 词以上的文章分 A–J 段，十个句子（36–45）
  各选一个段落，一次交卷判分，对应四级 Section B。

文章写在 `data/english/reading.json`，改完跑 `python tools/build_english_words.py` 重建
`assets/reading-articles.js`。共 18 篇 105 题：15 篇仔细阅读、3 篇长篇匹配，其中 11 篇由本栏
「杂论」的赛后记、棋评、裁判记改写（生成脚本：`tools/gen_reading_zalun.py`，`--check`
只校验长度不写盘）。脚本里的 `EXPAND` / `SECT_ADD` 负责把旧篇目补到规定长度并各补一道题，
`NEW` 放新增篇目，重复运行不会产生重复条目。

术语表与阅读文章中涉及规则的英文表述，参照 renju.net 上的
[RIF 国际规则](https://www.renju.net/rifrules/)与 [What is Renju?](https://www.renju.net/rules/)。

## 杂论词云

`zalun.html` 页面顶部那张词云不是写死在 HTML 里的：词条在 `data/zalun-words.json`，
入选名单在云数据库，排布在浏览器里算。

1. `tools/build_zalun_words.py` 读 `zalun.html` 列出的 13 篇文章，jieba 分词后按词性分类，
   写进 `data/zalun-words.json`（每条给词、次数、覆盖篇数、词性、分类、默认是否入云）；
2. `/admin/zalun.html` 把词表摊成表格，逐条开关，保存时写 `zayu_docs`
   （`kind=zalun_word`、`doc_id=cloud`，`data.words=[{w,c,k}]`）；
3. `assets/zalun-cloud.js` 在访客页读这一行，按次数映射字号，用螺旋排布 + 栅格碰撞
   在本地画成内联 SVG（不引第三方词云库）。读不到云端配置时退回词表里 `on=1` 的默认词。

字号只看次数：最多的一词约 79px，最少 15px；词少（< 34 个）时画布会自动压扁，
免得四周留一大片空白。悬停可看该词的具体次数。

## 对局库与预测接口（duiju.db）

山海杯这类「逐台预测」的页面不再把数据写进 HTML。库里只放对局（台次、双方编号与姓名、
赛果）和预测概率；等级分只留在录入源文件里，分数按前几轮赛果现算，两者都不入库。
`tools/manage_duiju.py` 负责把一轮对局录进去、再摊成站点上的 JSON。页面读的
`api/duiju/` 由 GitHub Actions 定时从库里重出并提交，仓库里没有服务器进程。

```
data/shanhai/2026-r1.json   一轮的录入源文件：台号、黑白双方、等级分、预测概率
        │  record
        ▼
data/duiju.db              唯一的数据源（tournaments / rounds / games）
        │  export
        ▼
api/duiju/index.json       赛事与轮次索引
api/duiju/shanhai/r1.json  单轮：赛事信息 + 23 台对局 + 预测
        │  fetch
        ▼
posts/2026-shanhai.html   照接口画表格；同一页用 ?r=N 换轮，不再一轮一个文件
```

```bash
python tools/manage_duiju.py all data/shanhai/2026-r1.json   # 录入 + 导出
python tools/manage_duiju.py sync                            # 重录 data/ 下所有轮次 + 导出
python tools/manage_duiju.py export                          # 只导出
python tools/manage_duiju.py result --tid 2026-shanhai --round 1 --table 3 --value "#3"
python tools/manage_duiju.py apply --tid 2026-shanhai --round 1 --results "1=#3,2=@李四,5=D,7=-"
python tools/manage_duiju.py show                            # 库里有什么
```

一台对局一旦记了赛果，它的概率就定死了：`record` / `sync` 再跑时，JSON 里的
`prediction` 不会覆盖这些台（赛果为 `null` 的台照常更新），所以补录结果不会把已经
公布的预测改掉。`result ... --value -` 或 `apply ... 7=-` 可以把一台退回未出结果。

赛果按「谁赢了」记，不按色位记：`#编号` 或 `@姓名` 都行，落库时再按这一台的黑白
换算成 `B`/`W`。塔拉山口这类规则里先后手会交换，名单上的黑白未必是实际执黑执白，
按姓名录就不会把胜方记到对手头上；`B`/`W`/`D` 的老写法仍然认。

**暗门页**：<https://renjupgc.github.io/admin/duiju.html> —— 不在导航、不进 sitemap
（`tools/build_seo.py` 的 `ADMIN_PAGES` 跳过它），只能直接敲地址。页面上逐台点
「棋手姓名 胜 / 和棋 / 对手姓名 胜 / ×」，按钮上是姓名不是黑白，换先也不会点错；
填一次 GitHub token（存浏览器本地），提交即调
`workflow_dispatch`，把 `tid / round / results` 交给 `update-duiju` 工作流执行
`manage_duiju.py apply`，随后照常 sync、导出、提交。token 用 fine-grained 的
`Actions: Read and write` 即可（classic token 要 `repo` + `workflow`）。

**后端就是 Actions，不是服务器。** `.github/workflows/update-duiju.yml` 每 30 分钟
（另外在推送 `data/shanhai/`、`tools/manage_duiju.py` 或手动触发时）跑一次
`python tools/manage_duiju.py sync`，把仓库里的轮次 JSON 重录进 `duiju.db`、重出
`api/duiju/`，有变化就由 `github-actions[bot]` 提交回 main；Pages 随即把新的 JSON 发出去。
`sync` 只把 `data/<目录>/` 里带 `tournament` 与 `games` 的 JSON 当轮次（`data/english/`
下的词库会被跳过），否则一个不相干的 JSON 就会让整条流水线中断、赛果写不进库。
做法照搬 renju4433.github.io 的 `update-bisai.yml`：定时 + 手动 + 路径触发，`contents: write`，
同一个 concurrency 组防并发。

`record` / `sync` / `export` 都是幂等的：数据没变时库和 `api/` 下的文件一个字节都不动
（导出不写时间戳），定时任务不会刷空提交；JSON 里 `result` 为 `null` 时不覆盖库里已经
记下的赛果，所以赛果既可以写在 JSON 里，也可以事后用 `result` 命令补。

`record` 整轮覆盖写库，可反复执行；一轮的 JSON（`rating` 只是给源文件留个底，
不入库、不进接口）：

```json
{
  "tournament": {"id": "2026-shanhai", "name": "「山海杯」2026 年全国五子棋业余棋王争霸赛线下总决赛",
                 "year": 2026, "group": "公开组", "rule": "塔拉山口-10", "slug": "shanhai"},
  "round": 1,
  "predicted_at": "2026-11-14 01:29:38",
  "model": "gbdt-20260704",
  "games": [
    {"table": 1,
     "black": {"no": 1, "name": "王俊锴", "rating": 2347.3},
     "white": {"no": 24, "name": "马子轩", "rating": 2164.7},
     "prediction": {"black": 65.6, "draw": 9.3, "white": 25.2},
     "result": null}
  ]
}
```

`prediction` 缺省表示这一轮还没跑预测；`result` 取 `B`（黑胜）/`W`（白胜）/`D`（和），
有值后页面会在概率块上方挂一个比分标签。台次旁的「N 分」是这一轮开赛前的累计分，
由库里前几轮的 `result` 现算，不进库。

页面：<https://renjupgc.github.io/posts/2026-shanhai.html>，`?r=2` 之类切到别的轮次。
旧的 `posts/2026-shanhai-r1.html` 已改名到此页；更早的 `posts/2026-shanhai-cup-r1.html` 已删除。
`data/duiju.db` 和 `api/duiju/` 都要提交：前者是源，后者才是线上被读的那份。

**名次表（详情）接口**：导出时按每轮的赛果各算一份名次表，写到
`api/duiju/shanhai/standings/r<N>.json`（`index.json` 每轮的 `standings` 字段给出路径；
有几轮就有几份）。破同分规则是山海杯的：**积分 → 对手分 → 中间对手分 → 胜局数，
仍相同则并列名次**。

- 积分：胜 1、和 0.5；
- 对手分：所有对手积分之和（未出结果的台不计，也不算对手）；
- 中间对手分：对手分去掉最高、最低各一个后求和，对手不足 3 人时等于对手分；
- 胜局数：真正赢下来的盘数；
- 四项全相同则并列，名次取并列里的最好名次。

分数依旧不入库：库里只有对局与概率，名次表是导出时按 `result` 现算的。
页面：<https://renjupgc.github.io/posts/2026-shanhai-details.html>，`?r=N` 切轮次，
对阵页右上角有「名次表 ↗」入口。

**新对局自动预测**：预测单独做成接口 `tools/predict_api.py`，`sync`（以及 `all`）
录完新对局后就调它。把一个赛事的一组对局交给它，返回每台的
`p_black / p_draw / p_white`。

```python
from predict_api import predict_tournament, predict_round
predict_tournament(conn, '2026-shanhai')            # 全赛事：所有还没出赛果的台
predict_round(conn, '2026-shanhai', 2, write=True)  # 只算某一轮
```

```bash
python tools/predict_api.py --tid 2026-shanhai --round 2   # 打印每台概率
python tools/predict_api.py --tid 2026-shanhai --write     # 写回 duiju.db
```

**WHR 滚动与 GBDT 预测**：预测第 N 轮时，把这场赛事第 1..N-1 轮的赛果纳入官方 WHR
（Whole-History Rating，`w2=19.3`，`virtual_games=2`）进行全历史等级分动态滚动计算，
得到每位棋手开赛前的最新 `rating` 与不确定度 `rd`，再由官方 GBDT 决策树模型（`model_20260704.json`）
精准输出黑胜 / 和棋 / 白胜概率。

对于赛果已出的对局，对阵表最前方自动标注绿勾（✔，预测命中）或红叉（✘，预测失误）。
概率写进库后不会被 JSON 空值覆盖；一台有了 `result`，它的概率定死、不再重算。

**模型评估**：导出时把「有概率又有赛果」的台汇总成
`api/duiju/shanhai/metrics.json`（每轮一份 + 整体）：命中率、平均 Brier 值、对数损失、
平均置信度。页面 <https://renjupgc.github.io/posts/2026-shanhai-metrics.html>，
对阵页与名次表右上角都有「模型评估 ↗」入口。

补录赛事与对局（源备份库不在手边时也走这条路）：在 `data/manual.db` 的 `tournaments_extra`、
`matches_extra` 各插一行——只收录部分对局时，`total_rounds` 填规程里的总轮数，页面靠它显示「共几轮」；
再往 `data/renju.db` 补同一条，然后

```bash
python tools/recompute_ratings.py     # 重算全表：WHR 是全历史拟合，多一场早期赛事会牵动所有人
python tools/build_zayu.py --rebuild  # 重出赛事页（沿用库内快照，不重算等级分）
```

`zayu.html` 的赛事名单是手工挑的，新赛事要自己加一行 `<li>`，`build_zayu.py` 只照这份名单出页。

`data/public_players.txt` 是可公开的棋手名单：`zayu/p/` 只给名单里的人出页，站内搜索与等级分表的
内链也只认这份名单。名单之外的人照旧出现在成绩表里（那是赛事记录），但不单独出页、不进搜索。
补人时确认后往名单里加一行，重跑 `build_players.py`。

`data/rating_excluded.txt` 是不计等级分的赛事：非公开进行的比赛（不对外报名、不公示成绩、站上
不出赛事页）留在库里备查，但不进 WHR 计算。`build_zayu.py`、`recompute_ratings.py`、
`build_rating_history.py` 读的是同一份名单，所以公示表与时光机末帧逐人相等；改完重跑
`build_rating_history.py` 与 `build_players.py` 即可。

`data/adult_players.txt` 是成人（非高校）棋手：站上的榜叫「河南高校爱好者等级分」，只排高校
棋手，所以这批人照样参与 WHR 计算、照样有等级分，但不进公示表、不占榜上位次，时光机也不给他们
排名，而且**等级分不随时间衰减**（不靠高校赛维持出场，按同一把尺子掉分不公平）。名单之外的
默认按高校棋手处理。

入榜门槛（只约束高校棋手）：河南选手须下满 4 局，外省选手须至少 2 场比赛；**上次参赛在
2023 年 12 月以前的，还要再打满两场**（`RATING_STALE_BEFORE` / `RATING_STALE_EVENTS`）——
隔了几年只凭一场旧成绩上榜单，说明不了眼下的水平。

未入榜的人（成人、没够门槛的高校棋手）一律不在榜上出现，只在个人主页给「预估名次」——
所有算得出分的棋手并在一起排序时的名义位次（`ratings.est_rank`），榜上名次 `ratings.rank`
留空。等级分照算、照常更新。改完重跑
`recompute_ratings.py` → `build_rating_history.py` → `build_players.py`。

依赖只有 Python 3 标准库，没有第三方包。

## 3D 对局（zaji/duiju.html）

三维对局室。不是二维棋盘点一下就冒子，而是坐进座位、从棋盒里捏子、落到木盘上响一声、
走完一手自己拍钟。两人报同一个房间号就各坐一边。

- 文件：`zaji/duiju.html`（结构与页面样式都在这一个文件里）、`assets/duiju3d/` 下
  `table.js`（场景、棋子、棋盒、棋钟、那只手）、`net.js`（房间）、`audio.js`（声音，
  全部现场合成，不带音频文件）、`app.js`（规则、棋钟、界面、消息分发）。
  三维引擎是 `assets/vendor/three.min.js`（r128，UMD，本地放，不吃 CDN）。
- 联机不落库：房间号就是 Supabase 实时频道名 `zbx-duiju3d-<房间号>`，public 频道只发
  broadcast，不需要建表，也不需要登录。实时服务连不上会自动降级成 `BroadcastChannel`，
  同一个浏览器开两个标签页也能对下（标签页 id 存在 `sessionStorage`，两页才是两个人）。
- 座位：先进房间的（id 小的）当房主，按两人的意愿排座并广播 `assign`；两张椅子都有人后，
  第三个人进来自动回 `full`。
- 棋钟按真下棋的顺序：落子不交时间，得自己拍钟（点「拍钟」、点桌上那块钟、或按空格）。
  六秒不拍，钟替你拍。时间按真实流逝算，切到别的窗口不会白赚时间。
- 规则是无禁手五子棋（黑先，连成五个或更多即胜），没做连珠禁手判定——那套判定错了
  比没有更糟，宁可不写。
- 站内换页只换 `<main>` 且脚本只注入一次，所以 `app.js` 自己监听 `zbx:navigate`：
  换回这一页时重新挂载（画布是新的一枚），离开时收掉渲染循环与实时通道。
- 画面上的坑：r128 没有色彩管理，材质的十六进制会被当成线性值，深色一律偏灰。
  `table.js` 建完场景后统一把颜色 `convertSRGBToLinear()` 一次，深色才压得住。

## 写页面的约定

- `<body data-nav="杂论" data-base="../">`：`data-nav` 决定导航高亮，`data-base` 是到站点根的相对前缀（根目录页面留空，子目录写 `../`）。
- 每页保留 `<div id="site-header"></div>` 和 `<main>`，`layout.js` 依赖它们。
- 站内跳转不整页刷新，只换 `<main>`。因此：
  - 页面专属样式要写在 `<head>` 的 `<style>` 里（会被带过去），不要写在 `<main>` 内联。
  - 页面自己的 `<script>` 会被补跑一次，代码要能重复执行而不出错。
- 文章页的日期只写在栏目页的列表里（`<span class="date">`），`build_seo.py` 从那里反查，无需在文章页另立字段。

## 访问统计（admin）

站点是纯静态，没有服务端，所以分成三段：

1. `assets/visit-log.js`（由 `layout.js` 全站注入）记录每次浏览、点击的文字与去向、
   搜索词、停留秒数与滚动深度，连同访客号（localStorage 随机串）、IP（`api.ipify.org`
   回显）一起 POST 到 ntfy 公共通道，通道只保留 12 小时。
2. `.github/workflows/snapshot-visits.yml` 每 3 小时跑 `tools/snapshot_visits.py`，
   把通道里的消息搬进 `data/visits.ndjson`（按消息 id 去重，留 400 天）。
3. `admin/index.html`（`/admin` 或 `/admin/`）输密码后读这个文件，出每日访客 / IP /
   交互明细，并把通道里尚未归档的实时记录一并算上。

- 密码只挡界面：页面源码里能看到密码与通道名，静态站无法做到真正鉴权。
- 不想被统计：设 `localStorage['zbx.notrack']='1'`，或浏览器开启 Do Not Track。
- 统计按北京时间（UTC+8）切日；`admin` 页自身不统计（`robots.txt` 也已屏蔽）。
- 补抓历史：`python tools/snapshot_visits.py --all`（只能取到通道里现存的 12 小时）。

## 部署

推到 `main` 即发布，GitHub Pages 一两分钟内生效。

## 版本

站点没有打包步骤，版本号是记账式的：`0.x.y`，最前面的 `0` 不动；新增页面、新增系统这类
大改动进 `x`、`y` 归零，修 bug、改文案、调样式这类小改动进 `y`。唯一来源是根目录 `VERSION`。

- 自动抬号：`.github/workflows/bump-version.yml` 在每次推 `main` 之后把 `VERSION` 抬一次
  （小改动 `y+1`）。提交说明里写 `[x]` 表示这次是大改动，抬 `x`、`y` 归零。机器提交带
  `[skip version]`，加之 `GITHUB_TOKEN` 推的提交不会再触发工作流，所以不会自己套自己。
- 显示：页脚由 `assets/layout.js` 读 `/VERSION`，显示成「· v0.28.2」。带时间戳绕开 Pages 的
  CDN 缓存，推完刷新即可见；读不到就整段隐藏，本地 `file://` 打开也不会留空档。
- 手工改 `VERSION` 只在初始化或回滚时用，平时交给工作流。

- `0.28.2` 页脚显示版本号；此后每次推送由工作流自动抬号。
- `0.28.1` 后台录赛果一律按「谁赢了」：杂豫内容管理的胜负下拉由「黑方（先手）胜 /
  白方（后手）胜」改成棋手姓名，改姓名时选项跟着变；对局临时换先也不会把胜方记到
  对手头上。
- `0.28.0` 基线：按提交记录里 28 个页面级大改动定 `x`（本站 20 天、649 次提交）。
