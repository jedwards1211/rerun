const path = require('path')
const { glob } = require('glob-gitignore')
const { readFile } = require('fs-extra')

function gitignoreToChokidar(lines) {
  const newLines = []
  lines.forEach(line => {
    line = line.trim()
    if (!line.length || line.startsWith('#')) return
    const slashPos = line.indexOf('/')
    if (slashPos < 0) {
      // something like "*.js" which we need to interpret as [
      //  "**/*.js",
      //  "*.js/**", (in case it is a directory)
      //  "*.js"
      // ]
      newLines.push(`**/${line}`)
      newLines.push(`**/${line}/**`)
      newLines.push(`${line}/**`)
      newLines.push(line)
      return
    }
    if (slashPos === 0) {
      // something like "/node_modules" so we need to remove
      // the leading slash
      line = line.substring(1)
    }
    if (line.charAt(line.length - 1) === '/') {
      newLines.push(line.slice(0, -1))
      newLines.push(`${line}**`)
    } else {
      newLines.push(line)
    }
  })
  return newLines
}

async function loadIgnoreFiles({
  projectRoot = process.cwd(),
  globPattern = '**/.gitignore',
} = {}) {
  const files = await glob(globPattern, {
    cwd: projectRoot,
    ignore: ['node_modules/**'],
  })
  return [].concat(
    ...(await Promise.all(
      files.map(async file => {
        const lines = (await readFile(
          path.resolve(projectRoot, file),
          'utf8'
        )).split(/\r\n?|\n/gm)
        const converted = gitignoreToChokidar(lines)
        const fileDir = path.dirname(file)
        if (file !== '.gitignore') {
          return converted.map(pattern => path.resolve(fileDir, pattern))
        }
        return converted
      })
    ))
  )
}

exports.loadIgnoreFiles = loadIgnoreFiles
