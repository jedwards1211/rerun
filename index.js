#!/usr/bin/env node

/* eslint-disable no-console */

;(async function() {
  const argv = process.argv.slice(2)

  function printUsage() {
    console.error(
      'Usage: rerun <files, directories, glob patterns...> -- <command>'
    )
    console.error('   or: rerun <command>')
  }

  let globPatterns, command, args, ignored

  const doubleDash = argv.indexOf('--')
  if (doubleDash < 0) {
    globPatterns = ['**']
    command = argv[0]
    args = argv.slice(1)
    ignored = await require('./gitignoreToChokidar').loadIgnoreFiles()
  } else {
    globPatterns = argv.slice(0, doubleDash)
    command = argv[doubleDash + 1]
    args = argv.slice(doubleDash + 2)
  }

  if (!command || !globPatterns.length) {
    printUsage()
    process.exit(1)
  }

  let debug = () => {}
  if (process.env.RERUN_DEBUG_FILE) {
    const out = require('fs').createWriteStream(process.env.RERUN_DEBUG_FILE, {
      flags: 'a',
      encoding: 'utf8',
    })
    const { inspect } = require('util')
    debug = (...args) => {
      for (let i = 0; i < args.length; i++) {
        let arg = args[i]
        if (i > 0) out.write(' ')
        if (typeof arg === 'function') arg = arg()
        if (typeof arg !== 'string') arg = inspect(arg)
        out.write(arg)
      }
      out.write('\n')
    }
  }

  debug('\n======================= STARTING ========================\n')
  debug({ cwd: process.cwd(), argv, globPatterns, command, args, ignored })

  const { spawn } = require('child_process')
  const chalk = require('chalk')
  const ansiEscapes = require('ansi-escapes')
  const debounce = require('lodash/debounce')
  const chokidar = require('chokidar')

  const killSignal = 'SIGTERM'

  let child

  function handleExit(code, signal) {
    cleanupChild()
    const message =
      code || signal
        ? chalk`{red [rerun] {bold ${command}} ${
            signal
              ? `was killed with signal ${signal}`
              : `exited with code ${code}`
          }}`
        : chalk`{green [rerun] {bold ${command}} exited with code ${code}}`

    console.error(message)
    debug(message)
    // istanbul ignore next
    if (process.send) process.send({ code, signal })
  }
  function handleError(error) {
    cleanupChild()
    const message = chalk`{red [rerun] error spawning {bold ${command}}: ${
      error.message
    }}`
    console.error(message)
    debug(message)
    // istanbul ignore next
    if (process.send) process.send({ error: error.message })
  }

  function cleanupChild() {
    child.removeListener('exit', handleExit)
    child.removeListener('error', handleError)
    child = null
  }

  function rerun() {
    if (child) {
      child.kill(killSignal)
      cleanupChild()
    }

    process.stderr.write(ansiEscapes.clearTerminal)
    const message = chalk`{yellow [rerun] spawning {bold ${command}}...}`
    console.error(message)
    debug(message)

    child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
    })
    child.on('error', handleError)
    child.on('exit', handleExit)
  }
  const chokidarOptions = {}
  if (ignored) chokidarOptions.ignored = ignored

  const watcher = chokidar.watch(globPatterns, chokidarOptions)

  const handleChange = debounce(
    path => {
      const message = chalk`{yellow [rerun] File changed: ${path}.  Restarting...}`
      console.error(message)
      debug(message)
      rerun()
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
      watcher.on(event, file => debug('[chokidar]', event, file))
    }
  }

  watcher.on('ready', () => {
    watcher.on('add', handleChange)
    watcher.on('unlink', handleChange)
  })
  watcher.on('change', handleChange)

  rerun()
})()
