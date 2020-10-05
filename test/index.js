const path = require('path')
const { describe, it, beforeEach } = require('mocha')
const { expect } = require('chai')
const { spawn } = require('promisify-child-process')
const fs = require('fs-extra')
const delay = require('waait')
const stripAnsi = require('strip-ansi')
const emitted = require('p-event')
const dedent = require('dedent')

const temp = path.resolve(__dirname, '..', 'temp')

describe('rerun', function() {
  this.timeout(3000)

  let proc
  const rerun = (...args) => {
    proc = spawn('rerun', args, {
      cwd: __dirname,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    })
    proc.catch(e => e)
    return proc
  }
  beforeEach(async function() {
    await fs.remove(temp)
    await fs.mkdir(temp)
  })
  afterEach(async function() {
    if (proc) proc.kill()
    proc = null
  })
  after(async function() {
    if (this.currentTest.state === 'passed') {
      await fs.remove(temp)
    }
  })
  it('runs once when no files change', async function() {
    const proc = rerun(path.join(temp, '**.{js,json}'), '--', 'echo', 'test')
    await emitted(proc, 'message')
    const [{ stdout, stderr }] = await Promise.all([
      proc.catch(e => e),
      proc.kill(),
    ])
    expect(stdout).to.equal('test\n')
    expect(stripAnsi(stderr)).to.equal(
      '[rerun] spawning echo...\n[rerun] echo exited with code 0\n'
    )
  })
  it('restarts when watched files change, but not when unwatched files change', async function() {
    await fs.mkdir(path.join(temp, 'subdir'))

    const proc = rerun(path.join(temp, '**/*.{js,json}'), '--', 'echo', 'test')
    await emitted(proc, 'message')

    await Promise.all([
      emitted(proc, 'message'),
      fs.writeJson(path.join(temp, 'a.json'), { foo: 'bar' }),
    ])

    await Promise.all([
      emitted(proc, 'message'),
      fs.writeFile(path.join(temp, 'subdir', 'b.js'), 'blah', 'utf8'),
    ])

    await fs.writeFile(path.join(temp, 'b.txt'), 'blah', 'utf8')
    await delay(500)

    const [{ stdout, stderr }] = await Promise.all([
      proc.catch(e => e),
      proc.kill(),
    ])
    expect(stdout).to.equal('test\ntest\ntest\n')
    expect(stripAnsi(stderr)).to.equal(
      dedent`
        [rerun] spawning echo...
        [rerun] echo exited with code 0
        [rerun] File changed: /Users/andy/rerun/temp/a.json.  Restarting...
        [rerun] spawning echo...
        [rerun] echo exited with code 0
        [rerun] File changed: /Users/andy/rerun/temp/subdir/b.js.  Restarting...
        [rerun] spawning echo...
        [rerun] echo exited with code 0\n`
    )
  })
})
