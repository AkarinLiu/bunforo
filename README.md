# BunForo

> [!WARNING]
>此项目未准备好用于生产环境，请勿直接拿去用于搭建网站！

一个跑在 [Bun](https://bun.sh) + [Hono](https://hono.dev) 上的论坛框架，前端用
Vue 3 + Vite，组件基于 [Reka UI](https://reka-ui.com)，同一套代码可运行在
**SQLite / PostgreSQL / MySQL** 之上。

视觉风格参考 [bun.com](https://bun.com)：近黑画布、暖黄到橙的强调色、终端质感的
代码块与克制的分隔线。

## 功能

- 注册 / 登录（会话为签名 httpOnly Cookie，密码用 `Bun.password` 的 argon2id 哈希）
- 版块（分类）管理与排序
- 发主题、无限层级嵌套回复
- Markdown 编辑器：工具栏、快捷键、实时预览 / 分栏预览（原始 HTML 一律转义）
- 上传：发帖、回复与头像可上传图片、PDF 与 MP4 / WebM / MOV 视频，落本地磁盘或任意 S3 兼容对象存储
- 点赞（每人每帖一次，可取消）
- 个人主页：资料编辑、主题与回复计数、发表过的主题
- 管理后台：版块增删改、用户封禁与角色调整、主题置顶 / 锁定 / 删除
- 内置「管理员」用户组：加入该组即成为管理员，移出即降为普通用户；名称与删除受保护
- 封禁提示：被封禁账号的资料页会显示封禁理由与期限（临时封禁自动到期解除）
- 封禁限制：被封禁账号仍可登录浏览，但只能与管理员私信；发主题、回复、私信普通成员都会被拒绝
- 管理员警告：后台可对违规用户发送警告（记录次数），警告与封禁都会进入对方的通知箱
- 黑名单：在设置里拉黑用户后，对方无法 @ 你，也无法给你发私信（单向，随时解除）
- 私信信用分门槛：后台上设置最低信用分，低于门槛的账号不能发起或发送私信（0 表示不限制；管理员与封禁申诉不受限）
- 信用分上限：后台可设置最高信用分（0 表示不限制）；加分不会超过上限，扣分照常，已超标的账号不被回溯
- 信用分自动恢复：后台设置恢复间隔（分钟），每隔一段时间所有低于上限的账号 +1 分；0 关闭，重启后重新计时
- 邮箱：绑定 / 更换 / 解绑账号邮箱，用邮件验证码确认；已验证邮箱可**代替用户名登录**
- 找回密码：用已验证邮箱接收验证码重设密码（验证码 15 分钟有效、限次、发信限流）；**重置成功即踢掉该账号的全部旧会话**
- 强制绑定邮箱：环境变量 `REQUIRE_EMAIL_BINDING=true` 时，未验证邮箱的账号登录后只能待在绑定页
- 邮件：内置 SMTP 发信（上面几条业务流 + 管理后台发送测试邮件）
- 首次启动的初始化向导：站点名称 / 简介、创建管理员、初始版块与标签一次配齐
- 非首次安装（已有账号）时，首个注册的账号自动成为管理员
- 从 GitHub Discussions 导入主题与评论，保留原时间与作者（CLI，可重复执行）
- GitHub OAuth 登录：导入产生的占位账号可由作者本人授权后认领
- 亮色 / 暗色主题：跟随系统的 `prefers-color-scheme` 自动切换，全站共用一套颜色变量
- 实时更新：SSE 推送新主题、新回复、私信与通知
- 通知中心：回复 / @提及 / 点赞 / 私信提醒，导航栏铃铛与通知页
- RSS 订阅：全站 `/feed.xml`，单个版块 `/c/:id/feed.xml`（父版块含子版块）；`/feeds` 列出全部订阅源（公开、无需登录）
- 用户设置：个人资料（昵称 / 简介 / 头像）、邮箱绑定、修改密码、通知偏好（回复 / 提及 / 点赞 / 私信可分别关闭）
- 自动清理上传：超过 24 小时仍未被主题 / 回复 / 草稿 / 私信 / 头像 / 站点公告引用的上传文件会被定期删除

## Markdown 渲染

帖子正文以原始 Markdown 存储，在浏览器端渲染。渲染器是按「结构性安全」配置的：

- `html: false` —— 正文里的原始 HTML 被转义为文本，输出中的每个标签都由
  markdown-it 自己生成
- 未覆盖 markdown-it 默认的 `validateLink`，因此 `javascript:` / `vbscript:` /
  非图片的 `data:` 链接会被丢弃

正因如此，不需要再引入 DOMPurify 之类的消毒库（那还会把 jsdom 拖进来）。`bun test`
里有针对这些注入载荷的用例 —— 它们断言的是「输出里不存在可执行的标签」，而不是
字符串包含关系，因为被转义的载荷本来就会以文本形式出现。

## 上传与对象存储

发帖、回复与头像支持上传图片、PDF 和 MP4 / WebM / MOV 视频。默认写入
`./public/assets/uploads`（可用 `UPLOAD_DIR` 覆盖），文件写入后返回 `/uploads/<key>`,
**这个路径在所有存储后端下都相同** —— 本地磁盘时由 Hono 直接返回字节，S3 时由 Hono
返回 302 跳转到对象（公开桶给直链，私有桶给预签名 URL）。

这一点正是迁移的关键：帖子正文和头像里存的一直是 `/uploads/<key>`，所以从本地搬到 S3
只是复制文件，用户内容一个字都不用改，带宽则完全交给对象存储。

### 接入 S3

支持 AWS S3、Cloudflare R2、MinIO、Backblaze B2、DigitalOcean Spaces。在 `.env` 里
填好桶和凭证就会自动切换驱动，不需要额外的开关。客户端用的是 Bun 原生
`Bun.S3Client`，不引入 AWS SDK：

```bash
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com   # 非 AWS 才需要
S3_REGION=auto
S3_BUCKET=bunforo
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
#S3_SESSION_TOKEN=…            # 仅临时凭证需要
# 桶可公开读取时填；不填则走预签名 URL
S3_PUBLIC_URL=https://cdn.example.com
```

设置了 `S3_ENDPOINT` 时按 path-style 寻址（MinIO 要求这样，R2 也接受）；不填则使用
AWS 的 virtual-host 形式。

### 迁移已有文件到 S3

```bash
bun run migrate:s3
```

脚本先列出桶里已有的 key，再遍历 `UPLOAD_DIR`，只上传缺失的文件（用 Bun 原生
`S3Client.list`），并对每个对象再做一次 HEAD 校验 —— 静默的部分失败会变成几周后
莫名其妙的坏图，所以这里宁可失败得响亮。可以重复执行，**不会删除本地文件**；确认无误后
自行清理本地目录，然后打开 `STORAGE_DRIVER=s3` 重启即可。

只要有一个文件失败，脚本就以非 0 退出，方便放进 CI 或部署流程。

### 上传安全

请求里的 `Content-Type` 和文件名都是不可信的。一个**内容是 HTML** 的文件，如果被标成
`image/png` 并按请求声称的类型回传，就是本站点上的存储型 XSS。因此扩展名与回传的
Content-Type 都取自**文件字节本身**（`src/server/filetype.ts` 的魔数嗅探），只接受
PNG / JPEG / GIF / WebP / AVIF / PDF，并且响应带 `X-Content-Type-Options: nosniff`。

SVG 是刻意排除的：它是合法图片，但能携带脚本，被当作文档打开时浏览器会执行它。

key 由服务端生成（UUID + 服务端选定的扩展名），客户端文件名从不进入路径。

## 从 GitHub Discussions 导入

> 先完成站点初始化（`/setup`）再导入：导入会创建占位账号，而初始化向导以「已有任何账号」
> 作为已完成，先导入会让站点永远没有管理员。CLI 会直接拒绝这种情况。

```bash
GITHUB_TOKEN=… GITHUB_REPO=owner/name bun run import:github --dry-run --limit 5
GITHUB_TOKEN=… GITHUB_REPO=owner/name bun run import:github --limit 200
```

- **映射**：discussion → 主题（保留 `createdAt` 与 `locked`），顶层 comment → 开楼帖下的回复，
  comment 的 reply → 该 comment 下的回复。论坛只有两层，所以 GitHub 的更深回复会被压平到
  所属顶层 comment 下。
- **分类**：按名称匹配论坛版块（顶层优先），找不到就用 GitHub 的分类名自动新建。
- **作者**：每个 GitHub login 建一个不可登录的占位账号，保留昵称与头像；作者本人之后用
  GitHub OAuth 登录即可认领（见下节）。
- **幂等**：主题按 `github:<discussion node id>`、评论按 `github:<comment node id>` 识别。
  重复执行只补新评论，不会重复导入；中途失败后重跑即可修复。
- **参数**：`--dry-run` 只统计不写库；`--limit n` 按创建时间从旧到新处理 n 个 discussion
  （默认 100）。遇到限流会打印可重试时间并退出，重跑是安全的。
- **媒体**：正文里的 GitHub 图片和视频会下载到 `UPLOAD_DIR`（默认
  `public/assets/uploads`）并改写为 `/uploads/<key>`；HTML `<img>` 转成 Markdown
  图片，`<video>` 转成链接。只下载 GitHub 自己的域名（防止把导入当成 SSRF 跳板），
  单文件上限为 `MAX_VIDEO_MB`；下载失败会保留原链接并计入汇总。
- **限制**：GitHub 正文里的原始 HTML（如 `<details>`）会被安全渲染器转义为文本；
  外站图片不下载，只保留原始链接；私有仓库附件需要 token 有读取权限；GitHub 侧分类改名
  会新建一个版块。

## GitHub OAuth 登录

用于让导入内容的作者认领自己的占位账号。只有 `GITHUB_CLIENT_ID` 与
`GITHUB_CLIENT_SECRET` 都设置时登录按钮才出现。

```bash
GITHUB_CLIENT_ID=…
GITHUB_CLIENT_SECRET=…
PUBLIC_BASE_URL=https://forum.example.com   # 反代后面必填
```

在 GitHub OAuth App 里把回调地址设为 `<站点>/api/auth/github/callback`，scope 为
`read:user user:email`。登录时：

1. 已有同 login 的占位账号 → 直接认领并补全邮箱；
2. 没有占位账号、但邮箱已属于某个已验证账号 → 绑定到该账号，不建重复用户；
3. 都没有 → 新建账号。

GitHub 的 numeric id 不一致（login 被回收）或邮箱已属于其他账号时会拒绝登录，避免账号被
劫持。GitHub 不提供其他用户的邮箱，因此导入阶段无法按邮箱匹配历史作者 —— 这正是需要
OAuth 认领的原因。

## 邮件（SMTP）

服务端内置 SMTP 发信能力（`src/server/mailer.ts`，基于 nodemailer）。不设置
`SMTP_HOST` 时**完全不会构造客户端**，未配置邮件的安装不产生任何网络行为。

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587            # 默认 587（STARTTLS）；465 自动使用隐式 TLS
SMTP_USER=bot@example.com
SMTP_PASS=…
SMTP_FROM=论坛 <no-reply@example.com>   # 缺省时回退到 SMTP_USER 或 no-reply@<host>
# SMTP_SECURE=true                       # 显式覆盖端口推断
# SMTP_TLS_REJECT_UNAUTHORIZED=false     # 仅开发：接受自签名证书
```

配置后重启服务，在管理后台「邮件」页签里填一个收件地址、点「发送测试邮件」即可验证。

邮件已接入两条业务流：**邮箱绑定验证**与**找回密码**，两者都发送 6 位验证码。未配置
SMTP 时它们优雅降级——邮箱仍可作为未验证地址保存，但既不能用于登录、也不能收码验证，
找回密码入口会明确提示未配置。绑定页与找回页的可用性由公开的 `GET /api/meta` 反映。

### 强制绑定邮箱

```bash
REQUIRE_EMAIL_BINDING=true
```

开启后，未验证邮箱的已登录用户会被路由守卫送到 `/bind-email`，服务端也会拒绝除
`/auth/me`、`/auth/logout`、`/meta` 与 `/users/me*` 之外的一切 `/api` 请求（403
`EMAIL_REQUIRED`），所以直接调接口也绕不过去。该开关**仅在已配置可用 SMTP 时生效**：
否则用户根本无法收码验证，开关会被忽略并在启动时打印警告，避免把所有人锁死。

## 快速开始

```bash
bun install
bun run dev
```

打开 http://localhost:5173 。API 跑在 :3000，Vite 会把 `/api` 代理过去。

**默认零配置**：不设置 `DATABASE_URL` 时使用本地 SQLite 文件 `./bunforo.db`，
表结构在首次启动时自动创建，没有需要手动执行的迁移命令。

从旧版本（buntalk）升级时，**先停掉旧进程**再启动新版本：只要 `DATABASE_URL` 未显式设置，
启动时会把 `./buntalk.db`（连同 `-wal`/`-shm`）自动改名为 `./bunforo.db`。改名失败会直接
中止启动，而不是悄悄连到一个空库。显式写了 `DATABASE_URL` 的部署按原路径运行，不会被改动。

首次打开会进入**初始化向导**：填站点名称与简介、创建管理员账号、添加初始版块与标签。
向导只在数据库里还没有任何账号时出现，完成后即锁定；之后再注册的账号为普通用户。

如果不想走向导，直接调 `POST /api/auth/register` 注册的第一个账号同样会成为管理员。

## 配置

复制 `.env.example` 为 `.env`（Bun 会自动加载）：

```bash
# 三选一
DATABASE_URL=./bunforo.db
DATABASE_URL=postgres://user:password@localhost:5432/bunforo
DATABASE_URL=mysql://user:password@localhost:3306/bunforo

PORT=3000
SESSION_SECRET=…   # 生产环境必填（openssl rand -hex 32）
NODE_ENV=production
```

驱动是按需加载的 —— 用 SQLite 时不会加载 `pg` / `mysql2`。

## 生产部署

```bash
bun run build     # 前端产物输出到 public/（页面与 assets/）
bun run start     # 同时提供 /api 与 public/ 静态文件
```

生产环境通过 `.env` 设置（Bun 会自动加载，且不依赖 shell 语法，Windows 上同样有效）：

```bash
NODE_ENV=production
SESSION_SECRET=<openssl rand -hex 32 的输出>
```

`NODE_ENV=production` 时若缺少 `SESSION_SECRET`，服务会直接拒绝启动，而不是悄悄
回退到开发用的默认值。

`bun run start` 会把 `public/` 当作网站根目录：`/api` 之外，`public/index.html`、`public/assets/` 与上传目录都由 Hono 直接提供，SPA 路由
回退到 `index.html`，未知的 `/api/*` 仍然返回 JSON 404。

## 项目结构

```
index.ts                 服务入口：建表后 Bun.serve
src/shared/types.ts      数据行契约，db 与 web 共用（无任何依赖）
src/db/ddl.ts            手写的建表语句，每种数据库一份
src/db/schema/*.ts       Drizzle 表定义，按方言分成三个文件
src/db/index.ts          按 DATABASE_URL 选择驱动，导出 db / tables
src/db/legacy.ts         buntalk.db → bunforo.db 的一次性升级改名
src/db/repo.ts           全部查询，三种数据库共用同一份实现
src/import/github/       GitHub Discussions 导入（映射 + GraphQL 客户端 + 媒体下载 + 写入）
src/server/legacy-uploads.ts  ./uploads → ./public/assets/uploads 的升级搬迁
src/server/github.ts     GitHub OAuth 登录与占位账号认领
src/server/app.ts        Hono 应用：先 /api，再 /uploads，最后静态资源
src/server/routes.ts     全部 API 路由
src/server/auth.ts       会话与权限
src/server/storage.ts    本地 / S3 对象存储
src/server/mailer.ts     SMTP 发信（nodemailer，未配置则不建客户端）
src/server/filetype.ts   魔数嗅探（上传的安全边界）
scripts/migrate-to-s3.ts 本地文件 → 桶 的一次性迁移
scripts/import-github.ts GitHub Discussions 导入 CLI
src/web/                 Vue 应用（pages/ 为路由页面，components/ 为组件）
src/web/markdown.ts      Markdown 渲染器（安全边界，见下）
test/                    bun test 检查
bunfig.toml              测试预加载，保证测试不碰真实的库与上传目录
```

## API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/register` · `/api/auth/login` · `/api/auth/logout` | 会话（登录的 `username` 字段也接受已验证邮箱） |
| `GET` | `/api/auth/me` | 当前用户（含自己的邮箱，公开资料不含） |
| `POST` | `/api/auth/forgot-password` · `/api/auth/reset-password` | 邮箱验证码找回密码 |
| `GET` | `/api/meta` | 公开能力开关（`mailConfigured` / `requireEmail` / `githubOAuth`） |
| `GET` | `/api/auth/github` · `/api/auth/github/callback` | GitHub OAuth 登录（未配置时重定向回 `/login?oauth=disabled`） |
| `GET` | `/api/setup/status` | 是否需要初始化 + 站点信息（公开） |
| `POST` | `/api/setup` | 首次初始化：管理员 / 站点信息 / 版块 / 标签（仅无账号时可用） |
| `GET` | `/api/categories` | 版块列表（含主题数） |
| `GET` | `/feed.xml` · `/c/:id/feed.xml` | RSS 2.0 订阅（全站 / 单个版块，父版块含子版块；公开，`/rss.xml` 会跳转） |
| `GET` | `/api/categories/:id/threads` | 版块内主题（`?limit&offset`） |
| `GET` | `/api/threads/:id` | 主题与其全部回复 |
| `POST` | `/api/threads` | 发主题 |
| `POST` | `/api/threads/:id/posts` | 回复 |
| `POST` | `/api/posts/:id/like` | 点赞 / 取消 |
| `DELETE` | `/api/posts/:id` · `/api/threads/:id` | 删除（作者或管理员） |
| `GET` | `/api/users/:username` · `/api/users/:username/threads` | 个人主页 |
| `PATCH` | `/api/users/me` | 编辑资料 |
| `GET` · `PATCH` | `/api/users/me/settings` | 个人通知偏好（需登录） |
| `GET` · `POST` · `DELETE` | `/api/users/me/blocks` | 黑名单：列表 / 按用户名拉黑 / 解除（需登录） |
| `POST` | `/api/users/me/password` | 修改密码（需验证当前密码，其他会话失效） |
| `POST` · `DELETE` | `/api/users/me/email` | 绑定 / 更换 / 解绑邮箱（需登录） |
| `POST` | `/api/users/me/email/verify` | 用 6 位验证码确认邮箱（需登录，body `{ code }`） |
| `POST` | `/api/uploads` | 上传图片 / PDF / 视频（需登录，multipart 的 `file` 字段） |
| `GET` | `/api/admin/mail` | 邮件配置状态（需管理员） |
| `POST` | `/api/admin/mail-test` | 发送测试邮件（需管理员，body `{ to }`） |
| — | `/api/admin/*` | 管理员接口（版块 / 用户 / 主题 / 标签 / 举报） |

错误统一为 `{ "error": "…" }`。

## 测试

```bash
bun test
```

覆盖数据库层（建表幂等、增删改查、级联删除、点赞开关）、回复树构建、Markdown 注入
载荷，上传路径（含视频魔数、HTML 伪装成图片、路径穿越），以及媒体导入的 URL 发现、
下载与正文改写，
另有一组通过子进程驱动的 S3 分支用例（URL 构造与预签名，不需要真实桶）。

`bunfig.toml` 会预加载 `test/setup.ts`，把数据库指到 `:memory:`、存储指到临时目录，
因此测试不会碰到你的真实数据。

## 已知取舍

- Markdown 代码块没有语法高亮（需要 highlighter 与配套主题）
- Markdown 在浏览器端渲染，所以 markdown-it 会进前端包（gzip 后约 44 KB）
- 上传只接受固定白名单（图片 / PDF / MP4 / WebM / MOV），加格式就要在 `filetype.ts` 里加魔数签名
- 上传目录默认是 `public/assets/uploads`；从旧版升级时会自动从 `./uploads` 搬过来（目标已存在则合并缺失文件，避免旧 URL 404）。显式设了其他 `UPLOAD_DIR` 的部署保持原路径
- 视频以链接形式插入正文，论坛没有内置播放器；大文件通过 Hono 直接返回，不保证可拖动进度
- 上传的文件不会在帖子或账号删除时回收，也没有孤儿文件清理任务
- 迁移脚本不列出桶内已有对象（不解析 S3 的 XML 列表响应），所以重跑是覆盖重传
- 没有站内搜索、通知、@ 提及与审核队列
- 强制绑定邮箱依赖已配置的 SMTP；未配置时开关被忽略（启动告警），因为用户无法完成验证
- 外站图片/视频保持远程链接；视频导入为链接而不是内嵌播放器
- 媒体下载失败后该帖子已落库，重跑不会重试失败项（只会补新评论）
- 导入中途失败会留下半个 discussion，重跑会补齐（没有跨行事务）
- 自动改名旧数据库要求升级前停掉旧进程；WAL 文件在运行中改名会不一致
- 登录、注册与上传都没有限流，公网部署前建议在反向代理层加上
- 用户主页的主题列表按作者过滤，接口上限 50 条
- 没有 `vue-tsc`：`bun run build` 能发现导入与模板错误，但不会校验组件 props
