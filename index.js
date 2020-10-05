#!/usr/bin/env node

/* eslint-disable no-console */

const argv = process.argv.slice(2)

function printUsage() {
  console.error(
    'Usage: rerun <files, directories, glob patterns...> -- <command>'
  )
}

const doubleDash = argv.indexOf('--')
if (doubleDash < 0) {
  printUsage()
  process.exit(1)
}

const globPatterns = argv.slice(0, doubleDash)
const command = argv[doubleDash + 1]
const args = argv.slice(doubleDash + 2)

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
let retryCount = 3

function handleExit(code, signal) {
  cleanupChild()
  console.error(
    code || signal
      ? chalk`{red [rerun] {bold ${command}} ${
          signal
            ? `was killed with signal ${signal}`
            : `exited with code ${code}`
        }}, ${retryCount} retries remaining`
      : chalk`{green [rerun] {bold ${command}} exited with code ${code}}`
  )
  if (code) {
    if (retryCount--) {
      rerun()
    }
  } else {
    retryCount = 3
  }
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
  })
  child.on('error', handleError)
  child.on('exit', handleExit)
}

const watcher = chokidar.watch(globPatterns)

const handleChange = debounce(
  path => {
    console.error(chalk`{yellow [rerun] File changed: ${path}.  Restarting...}`)
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
