import { dirname, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

type Primitive = string | number | boolean | null

type ValueType = 'string' | 'number' | 'boolean' | 'color'

interface Annotation {
  type?: ValueType
  override?: string
}

interface Node {
  name: string
  children: Node[]
  index?: number
  value?: {
    type: ValueType
    value: string
  }
  annotation?: Annotation
}

const INPUT = resolve('src/theme.sass')
const OUTPUT = resolve('dist/theme.json')

await mkdir(dirname(OUTPUT), { recursive: true })

function indentation(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0
}

function parseAnnotation(line: string): Annotation | null {
  const typeMatch = line.match(/^\/\/\s*@type\s+(\w+)$/)

  if (typeMatch) {
    const type = typeMatch[1] as ValueType

    if (!['string', 'number', 'boolean', 'color'].includes(type)) {
      throw new Error(`Unknown type annotation: ${type}`)
    }

    return { type }
  }

  const overrideMatch = line.match(/^\/\/\s*@override\s+(.+?)\s+(.+)$/)

  if (overrideMatch) {
    return {
      override: `${overrideMatch[1]} ${overrideMatch[2]}`,
    }
  }

  return null
}

function parseValue(type: string, rawValue: string): Node['value'] {
  if (type !== 'content' && type !== 'color') {
    throw new Error(`Unknown value type: ${type}`)
  }

  if (type === 'color') {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(rawValue)) {
      throw new Error(`Invalid color: ${rawValue}`)
    }

    return {
      type: 'color',
      value: rawValue,
    }
  }

  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return {
      type: 'string',
      value: JSON.parse(rawValue),
    }
  }

  return {
    type: 'string',
    value: rawValue,
  }
}

function parse(source: string): Node {
  const root: Node = {
    name: 'root',
    children: [],
  }

  const stack: {
    indent: number
    node: Node
  }[] = [
    {
      indent: -1,
      node: root,
    },
  ]

  let pendingAnnotation: Annotation | undefined

  for (const [lineNumber, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim()

    if (!line) {
      continue
    }

    if (line.startsWith('//')) {
      const annotation = parseAnnotation(line)

      if (annotation) {
        pendingAnnotation = {
          ...pendingAnnotation,
          ...annotation,
        }
      }

      continue
    }

    const indent = indentation(rawLine)

    while (stack.length > 1 && indent <= stack.at(-1)!.indent) {
      stack.pop()
    }

    const parent = stack.at(-1)!.node

    if (line.startsWith('[')) {
      const match = line.match(/^\[index="(\d+)"\]$/)

      if (!match) {
        throw new Error(`Line ${lineNumber + 1}: invalid array index "${line}"`)
      }

      const node: Node = {
        name: '',
        index: Number(match[1]),
        children: [],
        annotation: pendingAnnotation,
      }

      parent.children.push(node)
      stack.push({
        indent,
        node,
      })

      pendingAnnotation = undefined

      continue
    }

    if (line.startsWith('.')) {
      const name = line.slice(1)

      if (!name) {
        throw new Error(`Line ${lineNumber + 1}: empty property name`)
      }

      const node: Node = {
        name,
        children: [],
        annotation: pendingAnnotation,
      }

      parent.children.push(node)
      stack.push({
        indent,
        node,
      })

      pendingAnnotation = undefined

      continue
    }

    const valueMatch = line.match(/^([a-zA-Z][\w-]*):\s*(.+)$/)

    if (!valueMatch) {
      throw new Error(`Line ${lineNumber + 1}: invalid syntax "${line}"`)
    }

    const [, type, rawValue] = valueMatch

    parent.value = parseValue(type, rawValue)

    continue
  }

  return root
}

function applyType(value: Primitive, type?: ValueType): Primitive {
  if (!type || type === 'string' || type === 'color') {
    return value
  }

  if (type === 'number') {
    const number = Number(value)

    if (!Number.isFinite(number)) {
      throw new Error(`Cannot convert "${value}" to a number`)
    }

    return number
  }

  if (type === 'boolean') {
    if (value === 'true' || value === true) {
      return true
    }

    if (value === 'false' || value === false) {
      return false
    }

    throw new Error(`Cannot convert "${value}" to a boolean`)
  }

  return value
}

function convertValue(node: Node): Primitive {
  if (!node.value) {
    throw new Error(`Node "${node.name}" has no value`)
  }

  const raw = node.value.value

  return applyType(raw, node.annotation?.type)
}

function hasArrayChildren(node: Node): boolean {
  return node.children.some(child => child.index !== undefined)
}

function convert(node: Node): unknown {
  if (node.value) {
    return convertValue(node)
  }

  if (hasArrayChildren(node)) {
    const result: unknown[] = []

    for (const child of node.children) {
      if (child.index === undefined) {
        throw new Error(`Node "${node.name}" mixes array and object children`)
      }

      result[child.index - 1] = convert(child)
    }

    return result
  }

  const result: Record<string, unknown> = {}

  for (const child of node.children) {
    if (!child.name) {
      throw new Error(`Object "${node.name}" contains an unnamed child`)
    }

    result[child.name] = convert(child)
  }

  // Apply annotations to this node's children.
  if (node.annotation?.override === 'children[*] Array<string>') {
    for (const key of Object.keys(result)) {
      result[key] = [result[key]]
    }
  }

  return result
}

function build(root: Node): Record<string, unknown> {
  const result = convert(root)

  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('Theme root must be an object')
  }

  return result as Record<string, unknown>
}

async function main() {
  const source = await readFile(INPUT, 'utf8')

  const tree = parse(source)
  const output = build(tree)

  await writeFile(OUTPUT, JSON.stringify(output, null, 2) + '\n', 'utf8')

  console.log(`Built ${OUTPUT}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
