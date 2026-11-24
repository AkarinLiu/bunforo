/**
 * Import GitHub Discussions into this BunForo instance.
 *
 *   GITHUB_TOKEN=... GITHUB_REPO=owner/name bun run import:github --dry-run
 *   GITHUB_TOKEN=... GITHUB_REPO=owner/name bun run import:github --limit 200
 *
 * Idempotent: a discussion is tracked by its GitHub node id, so running it again
 * only picks up new comments. Run the setup wizard first — the importer creates
 * placeholder accounts, and setup treats "any user exists" as already set up.
 */
// Everything below is imported dynamically, after argument and env validation:
// a static import of the db module would open (and possibly rename) the database
// even for `--help`.

const HELP = `用法: bun run import:github [选项]

环境变量:
  GITHUB_TOKEN      必填，需要 repo (私有仓库还需额外权限) 读取 Discussions
  GITHUB_REPO       必填，owner/name，可被 --repo 覆盖
  GITHUB_API_BASE   可选，默认 https://api.github.com（GitHub Enterprise）

选项:
  --dry-run         只读取和统计，不写数据库
  --limit <n>       最多处理 n 个 discussion（按创建时间从旧到新），默认 100
  --repo <o/n>      覆盖 GITHUB_REPO
  --help            显示本帮助`

interface Args {
  dryRun: boolean
  limit: number
  repo: string
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
    limit: 100,
    repo: process.env.GITHUB_REPO?.trim() ?? '',
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--limit') {
      const raw = argv[++i]
      const n = Number(raw)
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit 需要一个正整数')
      args.limit = n
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length))
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit 需要一个正整数')
      args.limit = n
    } else if (arg === '--repo') {
      args.repo = argv[++i] ?? ''
    } else if (arg.startsWith('--repo=')) {
      args.repo = arg.slice('--repo='.length)
    } else {
      throw new Error(`未知参数: ${arg}`)
    }
  }
  return args
}

const fail = (line: string): never => {
  console.error(`[import:github] ${line}`)
  process.exit(1)
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  console.log(HELP)
  process.exit(0)
}

const token = process.env.GITHUB_TOKEN?.trim() ?? ''
if (!token) fail('缺少 GITHUB_TOKEN')

const [owner = '', name = '', extra] = args.repo.split('/')
if (!owner || !name || extra !== undefined) {
  fail('仓库格式应为 owner/name（可用 GITHUB_REPO 或 --repo 指定）')
}

console.log(
  `[import:github] ${owner}/${name} · limit ${args.limit}${args.dryRun ? ' · dry-run' : ''}`,
)

const { dialect, ensureSchema } = await import('../src/db/index')
const { countUsers, ensureSystemUser } = await import('../src/db/repo')

await ensureSchema()
await ensureSystemUser()

// Import creates accounts; doing that before /setup would leave the site without
// an admin, because setup closes as soon as any user exists.
if ((await countUsers()) === 0) {
  fail('数据库还没有管理员，请先访问 /setup 完成站点初始化')
}

const { createGithubClient, GithubApiError } = await import('../src/import/github/client')
const { runImport } = await import('../src/import/github/importer')

const client = createGithubClient({
  token,
  owner,
  name,
  apiBase: process.env.GITHUB_API_BASE?.trim() || undefined,
})

try {
  const summary = await runImport({ client, dryRun: args.dryRun, limit: args.limit, token })
  console.log(
    `[import:github] 完成（${dialect}）: 讨论 ${summary.discussionsSeen}，新建主题 ${summary.threadsCreated}，` +
      `跳过已有主题 ${summary.threadsSkipped}，新增评论 ${summary.postsCreated}，` +
      `跳过已有评论 ${summary.postsSkipped}，新建分类 ${summary.categoriesCreated}，` +
      `新建占位用户 ${summary.usersCreated}，媒体引入 ${summary.mediaImported}/${summary.mediaFound}` +
      (summary.mediaSkipped || summary.mediaFailed
        ? `（跳过 ${summary.mediaSkipped}，失败 ${summary.mediaFailed}）`
        : ''),
  )
  if (summary.failures.length) {
    for (const failure of summary.failures) {
      console.error(`[import:github] 失败 ${failure.nodeId} ${failure.title}: ${failure.error}`)
    }
    process.exit(1)
  }
} catch (err) {
  if (err instanceof GithubApiError) fail(err.message)
  fail(err instanceof Error ? err.message : String(err))
}
