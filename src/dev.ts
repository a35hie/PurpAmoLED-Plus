import { watch } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const theme = resolve('src/theme.sass')
const parser = resolve('src/parser.ts')

let running = false
let pending = false

function build() {
  if (running) {
    pending = true
    return
  }

  running = true

  console.log('\nBuilding theme...')

  const process = spawn('bun', ['run', parser], {
    stdio: 'inherit',
  })

  process.on('close', code => {
    running = false

    if (code === 0) {
      console.log('✓ Theme built')
    } else {
      console.error(`✗ Build failed with code ${code}`)
    }

    if (pending) {
      pending = false
      build()
    }
  })
}

console.log(`Watching ${theme}`)
console.log('Press Ctrl+C to stop.\n')

build()

watch(theme, event => {
  if (event === 'change') {
    console.log('\nTheme changed')
    build()
  }
})
