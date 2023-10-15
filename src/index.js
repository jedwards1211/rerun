#!/usr/bin/env node

/* eslint-disable no-console */

;(async function () {
  const argv = process.argv.slice(2)

  function printUsage() {
    console.error(
      'Usage: rerun <files, directories, glob patterns...> -- <command>'
    )
    console.error('   or: rerun <command>')
  }

  const path = require('path')
  const fs = require('fs')
  const cwd = process.cwd()

  let debug = () => {}
  let debugOut
  if (process.env.RERUN_DEBUG_FILE) {
    debugOut = fs.createWriteStream(process.env.RERUN_DEBUG_FILE, {
      flags: 'a',
      encoding: 'utf8',
    })
    const { inspect } = require('util')
    debug = (...args) => {
      if (!debugOut) return
      for (let i = 0; i < args.length; i++) {
        let arg = args[i]
        if (i > 0) debugOut.write(' ')
        if (typeof arg === 'function') arg = arg()
        if (typeof arg !== 'string') arg = inspect(arg)
        debugOut.write(arg)
      }
      debugOut.write('\n')
    }
  }

  const errorAndDebug = (...args) => {
    debug(...args)
    console.error(...args)
  }

  let globPatterns, command, args, ignored

  const { spawn, spawnSync } = require('child_process')
  const Gitignore = require('gitignore-fs')
  const gitignore = new Gitignore()

  const doubleDash = argv.indexOf('--')
  if (doubleDash < 0) {
    globPatterns = ['**']
    command = argv[0]
    args = argv.slice(1)
    let projectRoot
    try {
      projectRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        maxBuffer: 100000,
      }).stdout.trim()
      debug('found parent git directory:', projectRoot)
    } catch (error) {
      errorAndDebug('failed to find parent git directory:', error.stack)
      projectRoot = process.cwd()
    }
    ignored = (path, stats) => {
      let result = false
      if (!/(^|[\\/])\*\*?([\\/]|$)/.test(path)) {
        try {
          if (!stats) stats = fs.statSync(path)
          result = gitignore.ignoresSync(
            stats.isDirectory() ? path + '/' : path
          )
        } catch (error) {
          // ignore
        }
      }
      debug('ignored', path, stats, result)
      return result
    }
  } else {
    globPatterns = argv
      .slice(0, doubleDash)
      .map((p) => path.relative(cwd, path.resolve(p)))
    command = argv[doubleDash + 1]
    args = argv.slice(doubleDash + 2)
  }

  if (!command || !globPatterns.length) {
    printUsage()
    process.exit(1)
  }

  debug('\n======================= STARTING ========================\n')
  debug({ cwd, argv, globPatterns, command, args, ignored })

  const chalk = require('chalk')
  const ansiEscapes = require('ansi-escapes')
  const debounce = require('lodash/debounce')
  const chokidar = require('chokidar')

  const STARTING = 'STARTING'
  const STARTING_FILE_CHANGED = 'STARTING_FILE_CHANGED'
  const RUNNING = 'RUNNING'
  const SUCCEEDED = 'SUCCEEDED'
  const FAILED = 'FAILED'
  const RESTARTING = 'RESTARTING'
  const KILLED = 'KILLED'
  let state = STARTING

  function setState(nextState) {
    if (state === nextState) return
    state = nextState
    if (process.send) process.send({ state })
  }

  let child

  const watcher = chokidar.watch(globPatterns, {
    cwd,
    ignored,
  })

  async function handleKill(signal) {
    if (state === KILLED || !child) {
      if (child) {
        errorAndDebug(
          chalk`{red [rerun] got second ${signal}, ${
            child
              ? `sending SIGKILL to {bold ${command}}`
              : `no child is running`
          }`
        )
        child.kill('SIGKILL')
      }
      process.exit(1)
    }

    errorAndDebug(
      chalk`{red [rerun] got ${signal}, ${
        child ? `sending ${signal} to {bold ${command}}` : `no child is running`
      }}`
    )
    setState(KILLED)
    if (child) child.kill(signal)
    watcher.removeAllListeners()
    watcher.close().catch((error) => {
      errorAndDebug(
        chalk`{yellow [rerun] error closing file watcher: ${error.message}}`
      )
    })
    if (debugOut) {
      const _debugOut = debugOut
      debugOut = undefined
      await Promise.all([
        new Promise((resolve) => {
          _debugOut.once('close', resolve)
          _debugOut.once('error', resolve)
        }),
        _debugOut.end(),
      ])
    }
  }

  process.on('SIGINT', () => handleKill('SIGINT'))
  process.on('SIGTERM', () => handleKill('SIGTERM'))

  function handleExit(code, signal) {
    cleanupChild()
    errorAndDebug(
      code || signal
        ? chalk`{red [rerun] {bold ${command}} ${
            signal
              ? `was killed with signal ${signal}`
              : `exited with code ${code}`
          }}`
        : chalk`{green [rerun] {bold ${command}} exited with code ${code}}`
    )
    // istanbul ignore next
    if (process.send) process.send({ code, signal })

    switch (state) {
      case KILLED:
        process.exit(1)
        break
      case RESTARTING:
      case STARTING_FILE_CHANGED:
        start()
        break
      case STARTING:
      case RUNNING:
        setState(code || signal ? FAILED : SUCCEEDED)
        break
    }
  }
  function handleError(error) {
    cleanupChild()
    errorAndDebug(
      chalk`{red [rerun] error spawning {bold ${command}}: ${error.message}}`
    )
    if (process.send) process.send({ error: error.message })

    switch (state) {
      case KILLED:
        if (child) child.kill('SIGKILL')
        process.exit(1)
        break
      case RESTARTING:
      case STARTING_FILE_CHANGED:
        start()
        break
      case STARTING:
        setState(FAILED)
        break
    }
  }
  function handleSpawn() {
    if (state === STARTING_FILE_CHANGED) {
      setState(RESTARTING)
      if (child) child.kill('SIGINT')
    } else {
      setState(RUNNING)
    }
  }

  function cleanupChild() {
    child.removeListener('exit', handleExit)
    child.removeListener('error', handleError)
    child = null
  }

  function start() {
    setState(STARTING)

    process.stderr.write(ansiEscapes.clearTerminal)
    errorAndDebug(chalk`{yellow [rerun] spawning {bold ${command}}...}`)

    child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
    })
    child.on('error', handleError)
    child.on('exit', handleExit)
    child.on('spawn', handleSpawn)
  }

  const handleFileChange = debounce(
    (p) => {
      if (state !== KILLED) {
        errorAndDebug(
          chalk`{yellow [rerun] File changed: ${p}.  Restarting...}`
        )
      }
      switch (state) {
        case STARTING:
          setState(STARTING_FILE_CHANGED)
          break
        case RUNNING:
          setState(RESTARTING)
          if (child) child.kill('SIGINT')
          break
        case SUCCEEDED:
        case FAILED:
          start()
          break
      }
    },
    100,
    { maxWait: 1000 }
  )

  if (process.env.RERUN_DEBUG_FILE) {
    for (const event of [
      'add',
      'change',
      'unlink',
      'addDir',
      'unlinkDir',
      'error',
      'ready',
      'raw',
    ]) {
      watcher.on(event, (file) => debug('[chokidar]', event, file))
    }
  }

  watcher.on('ready', () => {
    if (process.send) process.send({ ready: true })
    watcher.on('add', handleFileChange)
  })
  watcher.on('change', handleFileChange)
  watcher.on('unlink', handleFileChange)

  start()
})()
