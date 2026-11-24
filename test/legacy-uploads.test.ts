import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacyUploadDir } from '../src/server/legacy-uploads'

const freshDir = () => mkdtempSync(join(tmpdir(), 'bunforo-uploads-'))

describe('./uploads → ./public/assets/uploads', () => {
  test('does nothing when neither directory exists', () => {
    const dir = freshDir()
    migrateLegacyUploadDir(dir)
    expect(existsSync(join(dir, 'public/assets/uploads'))).toBe(false)
  })

  test('moves the legacy directory into place', () => {
    const dir = freshDir()
    mkdirSync(join(dir, 'uploads'))
    writeFileSync(join(dir, 'uploads/a.png'), 'png')
    migrateLegacyUploadDir(dir)
    expect(existsSync(join(dir, 'uploads'))).toBe(false)
    expect(existsSync(join(dir, 'public/assets/uploads/a.png'))).toBe(true)
  })

  test('merges missing files instead of leaving them to 404', () => {
    const dir = freshDir()
    mkdirSync(join(dir, 'uploads'))
    writeFileSync(join(dir, 'uploads/a.png'), 'old')
    writeFileSync(join(dir, 'uploads/b.png'), 'only-old')
    mkdirSync(join(dir, 'public/assets/uploads'), { recursive: true })
    writeFileSync(join(dir, 'public/assets/uploads/a.png'), 'new')

    migrateLegacyUploadDir(dir)

    // A key that already exists keeps the newer copy; a key that was only in
    // the legacy dir is adopted, so its /uploads/<key> URL keeps resolving.
    expect(readFileSync(join(dir, 'public/assets/uploads/a.png'), 'utf8')).toBe('new')
    expect(readFileSync(join(dir, 'public/assets/uploads/b.png'), 'utf8')).toBe('only-old')
    expect(existsSync(join(dir, 'uploads/a.png'))).toBe(true)
    expect(existsSync(join(dir, 'uploads/b.png'))).toBe(false)
  })
})
