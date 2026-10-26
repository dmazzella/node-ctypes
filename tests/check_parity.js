import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.join(import.meta.dirname, "cpython_parity");
const mode = process.argv[2];
assert.ok(mode === undefined || mode === "--python" || mode === "--python-parity", "Expected no argument, --python, or --python-parity");
const pythonExecutable = process.env.PYTHON ?? "python";
const files = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "__pycache__") collect(fullPath);
    else if (entry.isFile() && /^test_.*\.(js|py)$/.test(entry.name)) files.push(fullPath);
  }
}
collect(root);
const pythonFiles = files.filter((file) => file.endsWith(".py")).sort();
const javascriptFiles = files.filter((file) => file.endsWith(".js")).sort();
assert.ok(pythonFiles.length > 0, "No CPython parity suites found");
assert.deepEqual(
  javascriptFiles.map((file) => file.slice(0, -3)),
  pythonFiles.map((file) => file.slice(0, -3)),
  "Every parity suite needs neighboring .py and .js files",
);

const python = spawnSync(
  pythonExecutable,
  [
    "-B",
    "-c",
    String.raw`
import ast, json, pathlib, sys
if sys.implementation.name != "cpython" or sys.version_info < (3, 14):
    raise SystemExit(
        f"CPython ctypes references require CPython 3.14+; selected "
        f"{sys.implementation.name} {sys.version.split()[0]} at {sys.executable}. "
        "Set PYTHON to a supported interpreter."
    )
root = pathlib.Path(sys.argv[1])
result = {}
for path in sorted(root.rglob("test_*.py")):
    for parent in [path.parent, *path.parent.parents]:
        if not (parent / "__init__.py").is_file():
            raise RuntimeError(f"{path}: missing package marker in {parent}")
        if parent == root:
            break
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    cases = []
    def visit(statements):
        for node in statements:
            if isinstance(node, ast.ClassDef):
                for method in node.body:
                    if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) and method.name.startswith("test_"):
                        cases.append(f"{node.name}.{method.name}")
            elif isinstance(node, ast.If):
                visit(node.body)
                visit(node.orelse)
    visit(tree.body)
    if not cases or len(cases) != len(set(cases)):
        raise RuntimeError(f"{path}: missing or duplicate case IDs")
    result[path.relative_to(root).with_suffix("").as_posix()] = sorted(cases)
print(json.dumps({"cases": result, "version": sys.version.split()[0], "executable": sys.executable}))
`,
    root,
  ],
  { encoding: "utf8" },
);
if (python.error) throw python.error;
assert.equal(python.status, 0, python.stderr || "Python parity inventory failed");
const reference = JSON.parse(python.stdout);
const expected = reference.cases;
let count = 0;
for (const file of javascriptFiles) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(source.parseDiagnostics.length, 0, `${file}: invalid JavaScript syntax`);
  const testBindings = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "node:test") continue;
    const imports = statement.importClause;
    if (imports?.name) testBindings.set(imports.name.text, "test");
    if (imports?.namedBindings && ts.isNamedImports(imports.namedBindings)) {
      for (const specifier of imports.namedBindings.elements) {
        const name = (specifier.propertyName ?? specifier.name).text;
        if (["describe", "it", "test"].includes(name)) testBindings.set(specifier.name.text, name);
      }
    }
  }
  const cases = [];
  function fail(node, message) {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    throw new Error(`${path.relative(root, file)}:${line + 1}: ${message}`);
  }
  function visit(node, suites = []) {
    if (ts.isImportSpecifier(node) && ["array", "struct", "union"].includes((node.propertyName ?? node.name).text)) {
      fail(node, "Use ARRAY or Structure/Union classes in parity; functional APIs belong in node_specific");
    }
    if (ts.isCallExpression(node)) {
      const call = node.expression;
      if (ts.isIdentifier(call) && testBindings.has(call.text)) {
        const [label] = node.arguments;
        const body = node.arguments.at(-1);
        if (!label || !ts.isStringLiteral(label) || !body || (!ts.isFunctionExpression(body) && !ts.isArrowFunction(body))) fail(node, "Suite and case IDs must be literal strings with inline test bodies");
        if (testBindings.get(call.text) === "describe") {
          ts.forEachChild(body, (child) => visit(child, [...suites, label.text]));
        } else {
          if (suites.length !== 1 || !label.text.startsWith("test_")) fail(node, "Use describe(PythonClassName) and it(PythonMethodName)");
          cases.push(`${suites[0]}.${label.text}`);
          ts.forEachChild(body, (child) => visit(child, suites));
        }
        return;
      }
      if (ts.isIdentifier(call) && ["array", "struct", "union"].includes(call.text)) fail(node, "Use Python-shaped type definitions in parity");
      if (ts.isPropertyAccessExpression(call)) {
        if (call.name.text === "callAsync") fail(node, "Async schedules belong in node_specific");
        if (["c", "ctypes"].includes(call.expression.getText(source)) && ["array", "struct", "union"].includes(call.name.text)) fail(node, "Use ARRAY or Structure/Union classes");
        if (call.name.text === "func" && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[0])) fail(node, "Bind library attributes with argtypes/restype or use CFUNCTYPE");
      }
    }
    if (ts.isPropertyAccessExpression(node) && ["_buffer", "_structDef"].includes(node.name.text)) fail(node, "Use public ctypes memory and layout APIs in parity");
    ts.forEachChild(node, (child) => visit(child, suites));
  }
  visit(source);
  const module = path.relative(root, file).slice(0, -3).split(path.sep).join("/");
  assert.equal(cases.length, new Set(cases).size, `${module}: duplicate JS case IDs`);
  assert.deepEqual(cases.sort(), expected[module], `${module}: Python and JavaScript class/method IDs differ`);
  count += cases.length;
}
console.log(`Parity structure: ${pythonFiles.length} paired suites, ${count} matching class/method IDs; Python-shaped JS APIs checked.`);
console.log(`Reference: CPython ${reference.version} (${reference.executable}).`);
if (mode !== undefined) {
  const result = spawnSync(pythonExecutable, ["-B", "-m", "unittest", "discover", "-s", mode === "--python-parity" ? "cpython_parity" : ".", "-t", ".", "-p", "test_*.py"], { cwd: import.meta.dirname, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Python reference process terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
}
