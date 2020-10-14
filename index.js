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

  const { spawn } = require('child_process')
  const chalk = require('chalk')
  const ansiEscapes = require('ansi-escapes')
  const debounce = require('lodash/debounce')
  const chokidar = require('chokidar')

  const killSignal = 'SIGTERM'

  let child

  function handleExit(code, signal) {
    cleanupChild()
    console.error(
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
  }
  function handleError(error) {
    cleanupChild()
    console.error(
      chalk`{red [rerun] error spawning {bold ${command}}: ${error.message}}`
    )
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
    console.error(chalk`{yellow [rerun] spawning {bold ${command}}...}`)

    child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
    })
    child.on('error', handleError)
    child.on('exit', handleExit)
  }

  const watcher = chokidar.watch(globPatterns, { ignored })

  const handleChange = debounce(
    path => {
      console.error(
        chalk`{yellow [rerun] File changed: ${path}.  Restarting...}`
      )
      rerun()
    },
    100,
    { maxWait: 1000 }
  )

  watcher.on('ready', () => {
    watcher.on('add', handleChange)
    watcher.on('unlink', handleChange)
  })
  watcher.on('change', handleChange)

  rerun()
})()
