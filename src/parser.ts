import { dirname, resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

type Primitive = string | number | boolean | null

type ValueType = 'string' | 'number' | 'boolean' | 'color'

interface PackageJson {
  [key: string]: unknown
}

interface Variables {
  pkg: PackageJson
}

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
const PACKAGE_JSON = resolve('package.json')

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

function parseValue(
  type: string,
  rawValue: string,
  variables: Variables
): Node['value'] {
  if (type !== 'content' && type !== 'color') {
    throw new Error(`Unknown value type: ${type}`)
  }

  if (type === 'color') {
    if (!/^#[0-9a-fA-F]{6,8}$/.test(rawValue)) {
      throw new Error(`Invalid color: ${rawValue}`)
    }

    return {
      type: 'color',
      value: rawValue.toUpperCase(),
    }
  }

  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    const parsed = JSON.parse(rawValue)

    if (typeof parsed !== 'string') {
      throw new Error(`Content must contain a string`)
    }

    return {
      type: 'string',
      value: interpolate(parsed, variables),
    }
  }

  return {
    type: 'string',
    value: interpolate(rawValue, variables),
  }
}

function parse(source: string, variables: Variables): Node {
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
      const match = line.match(/^\[index="(\d+)"]$/)

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

    const type = valueMatch[1]
    const rawValue = valueMatch[2]

    if (type === undefined || rawValue === undefined) {
      throw new Error(`Line ${lineNumber + 1}: invalid value "${line}"`)
    }

    parent.value = parseValue(type, rawValue, variables)
  }

  return root
}

function resolveVariable(expression: string, variables: Variables): unknown {
  const parts = expression.split('.')

  const namespace = parts.shift()

  if (!namespace) {
    throw new Error(`Invalid variable "${expression}"`)
  }

  if (!(namespace in variables)) {
    throw new Error(`Unknown variable namespace "${namespace}"`)
  }

  let value: unknown = variables[namespace as keyof Variables]

  for (const part of parts) {
    if (typeof value !== 'object' || value === null || !(part in value)) {
      throw new Error(`Cannot resolve variable "${expression}"`)
    }

    value = (value as Record<string, unknown>)[part]
  }

  return value
}

function interpolate(value: string, variables: Variables): string {
  return value.replace(
    /\$\{([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)}/g,
    (_, expression: string) => {
      const resolved = resolveVariable(expression, variables)

      if (typeof resolved === 'object' && resolved !== null) {
        throw new Error(
          `Variable "${expression}" resolves to an object and cannot be used in a string`
        )
      }

      return String(resolved)
    }
  )
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
  const index = root.children.find(child => child.name === 'index')

  if (!index) {
    throw new Error('Theme must contain a ".index" root')
  }

  const result = convert(index)

  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('".index" must contain an object')
  }

  return result as Record<string, unknown>
}

async function main() {
  const source = await readFile(INPUT, 'utf8')

  const packageJson = JSON.parse(
    await readFile(PACKAGE_JSON, 'utf8')
  ) as PackageJson

  const variables: Variables = {
    pkg: packageJson,
  }

  const tree = parse(source, variables)
  const output = build(tree)

  await mkdir(dirname(OUTPUT), {
    recursive: true,
  })

  await writeFile(OUTPUT, JSON.stringify(output, null, 2) + '\n', 'utf8')

  console.log(`Built ${OUTPUT}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
