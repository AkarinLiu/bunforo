import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface ProbeResult {
  dir: string
  legacyGone: boolean
  moved: boolean
  content: string
  status: number
  contentType: string
  servedText: string
}

async function runProbe(overrides: Record<string, string> = {}): Promise<ProbeResult> {
  const cwd = mkdtempSync(join(tmpdir(), 'bunforo-uploaddir-'))
  mkdirSync(join(cwd, 'uploads'))
  writeFileSync(join(cwd, 'uploads/legacy.png'), 'old-image')

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  for (const key of [
    'UPLOAD_DIR',
    'STORAGE_DRIVER',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]) {
    delete env[key]
  }
  Object.assign(env, overrides)

  const proc = Bun.spawn({
    cmd: ['bun', join(import.meta.dir, 'upload-dir-probe.ts')],
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  expect(await proc.exited).toBe(0)
  expect(stderr).toBe('')
  // The migration itself logs a line to stdout before the probe's JSON.
  return JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as ProbeResult
}

function expectMigratedAndServed(r: ProbeResult): void {
  expect(r.dir).toBe('./public/assets/uploads')
  expect(r.legacyGone).toBe(true)
  expect(r.moved).toBe(true)
  expect(r.content).toBe('old-image')
  // The regression this guards: changing the directory must not make an
  // existing /uploads/<key> URL return 404.
  expect(r.status).toBe(200)
  expect(r.contentType).toBe('image/png')
  expect(r.servedText).toBe('old-image')
}

describe('default upload directory', () => {
  test('is public/assets/uploads and adopts a legacy ./uploads directory', async () => {
    expectMigratedAndServed(await runProbe())
  })

  test('still adopts the legacy directory when the default path is written explicitly', async () => {
    // Copying .env.example verbatim sets UPLOAD_DIR=./public/assets/uploads;
    // that must not be mistaken for a custom path and skip the move.
    expectMigratedAndServed(
      await runProbe({
        UPLOAD_DIR: './public/assets/uploads',
        PROBE_KEEP_UPLOAD_DIR: '1',
      }),
    )
  })
})
