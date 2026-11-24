import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateLegacySqliteFile } from '../src/db/legacy'

const freshDir = () => mkdtempSync(join(tmpdir(), 'bunforo-legacy-'))

describe('buntalk.db → bunforo.db upgrade', () => {
  test('does nothing when neither file exists', () => {
    const dir = freshDir()
    migrateLegacySqliteFile(dir)
    expect(existsSync(join(dir, 'bunforo.db'))).toBe(false)
    expect(existsSync(join(dir, 'buntalk.db'))).toBe(false)
  })

  test('renames the legacy database and its WAL sidecars', () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'buntalk.db'), 'payload')
    writeFileSync(join(dir, 'buntalk.db-wal'), 'wal')
    writeFileSync(join(dir, 'buntalk.db-shm'), 'shm')

    migrateLegacySqliteFile(dir)

    expect(existsSync(join(dir, 'buntalk.db'))).toBe(false)
    expect(readFileSync(join(dir, 'bunforo.db'), 'utf8')).toBe('payload')
    expect(readFileSync(join(dir, 'bunforo.db-wal'), 'utf8')).toBe('wal')
    expect(readFileSync(join(dir, 'bunforo.db-shm'), 'utf8')).toBe('shm')
  })

  test('never overwrites an existing bunforo.db', () => {
    const dir = freshDir()
    writeFileSync(join(dir, 'buntalk.db'), 'old')
    writeFileSync(join(dir, 'bunforo.db'), 'new')

    migrateLegacySqliteFile(dir)

    expect(readFileSync(join(dir, 'bunforo.db'), 'utf8')).toBe('new')
    expect(readFileSync(join(dir, 'buntalk.db'), 'utf8')).toBe('old')
  })
})
