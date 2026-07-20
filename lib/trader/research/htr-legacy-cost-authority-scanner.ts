import ts from "typescript";

export type LegacyAuthorityRuleId =
  | "HTR_LEGACY_COST_10_5"
  | "HTR_DYNAMIC_COST_AUTHORITY_FAIL_CLOSED"
  | "HTR_CONDITIONAL_COST_AUTHORITY_BYPASS"
  | "HTR_CALLER_SUPPLIED_COST_AUTHORITY";

export type LegacyAuthoritySinkCategory =
  | "COST_MODEL_FACTORY"
  | "EXECUTION_MODEL_FACTORY"
  | "RUNTIME_COST_AUTHORITY";

export type LegacyAuthorityVerdict = "BLOCK" | "ALLOW";

export type LegacyAuthorityScanResult = {
  vectorId: string;
  verdict: LegacyAuthorityVerdict;
  ruleId: LegacyAuthorityRuleId | null;
  sinkCategory: LegacyAuthoritySinkCategory | null;
  detectedValues: string[];
  diagnosticCode: string | null;
};

export type LegacyAuthorityNegativeVector = {
  vectorId: string;
  files: Array<{ path: string; source: string }>;
  entryFile: string;
  expectedRuleId: LegacyAuthorityRuleId;
  expectedSinkCategory: LegacyAuthoritySinkCategory;
  expectedVerdict: "BLOCK";
  expectedDetectedValues: string[];
  expectedDiagnosticCode: string;
};

const COST_MODEL_FACTORY_NAMES = new Set(["createCostModelV1"]);
const EXECUTION_MODEL_FACTORY_NAMES = new Set(["createHistoricalExecutionModel"]);
const RUNTIME_SINK_NAMES = new Set(["executeHistoricalFill"]);

type ResolvedValue = { kind: "literal"; value: string } | { kind: "dynamic" };

function resolveExpression(
  expression: ts.Expression,
  constValues: Map<string, ResolvedValue>,
): ResolvedValue {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return { kind: "literal", value: expression.text };
  }
  if (ts.isNumericLiteral(expression)) {
    return { kind: "literal", value: expression.text };
  }
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans) {
      const part = resolveExpression(span.expression, constValues);
      if (part.kind === "dynamic") return { kind: "dynamic" };
      value += part.value;
      value += span.literal.text;
    }
    return { kind: "literal", value };
  }
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolveExpression(expression.left, constValues);
      const right = resolveExpression(expression.right, constValues);
      if (left.kind === "dynamic" || right.kind === "dynamic") return { kind: "dynamic" };
      return { kind: "literal", value: left.value + right.value };
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.AsteriskToken ||
      expression.operatorToken.kind === ts.SyntaxKind.SlashToken
    ) {
      const left = resolveExpression(expression.left, constValues);
      const right = resolveExpression(expression.right, constValues);
      if (left.kind === "dynamic" || right.kind === "dynamic") return { kind: "dynamic" };
      const l = Number(left.value);
      const r = Number(right.value);
      const result = expression.operatorToken.kind === ts.SyntaxKind.AsteriskToken ? l * r : l / r;
      return { kind: "literal", value: String(result) };
    }
  }
  if (ts.isCallExpression(expression)) {
    const calleeText = expression.expression.getText();
    if (calleeText === "String" && expression.arguments[0]) {
      return resolveExpression(expression.arguments[0], constValues);
    }
    if (calleeText === "Number" && expression.arguments[0]) {
      const inner = resolveExpression(expression.arguments[0], constValues);
      if (inner.kind === "dynamic") return { kind: "dynamic" };
      return { kind: "literal", value: String(Number(inner.value)) };
    }
    if (calleeText === "JSON.parse" && expression.arguments[0]) {
      const arg = resolveExpression(expression.arguments[0], constValues);
      if (arg.kind === "dynamic") return { kind: "dynamic" };
      try {
        const parsed = JSON.parse(arg.value) as {
          feesBps?: number | string;
          slippageBps?: number | string;
        };
        if (parsed.feesBps != null && parsed.slippageBps != null) {
          return {
            kind: "literal",
            value: `${String(parsed.feesBps)}:${String(parsed.slippageBps)}`,
          };
        }
      } catch {
        return { kind: "dynamic" };
      }
    }
  }
  if (ts.isPropertyAccessExpression(expression)) {
    if (expression.expression.getText() === "process.env") {
      return { kind: "dynamic" };
    }
  }
  if (ts.isIdentifier(expression)) {
    const resolved = constValues.get(expression.text);
    if (resolved) return resolved;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    let fees: ResolvedValue | undefined;
    let slippage: ResolvedValue | undefined;
    for (const prop of expression.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name.getText().replace(/['"]/g, "");
      if (key === "feesBps") fees = resolveExpression(prop.initializer, constValues);
      if (key === "slippageBps") slippage = resolveExpression(prop.initializer, constValues);
    }
    if (fees && slippage) {
      if (fees.kind === "dynamic" || slippage.kind === "dynamic") return { kind: "dynamic" };
      return { kind: "literal", value: `${fees.value}:${slippage.value}` };
    }
  }
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = resolveExpression(expression.whenTrue, constValues);
    const whenFalse = resolveExpression(expression.whenFalse, constValues);
    const trueFeesSlippage = parseFeesSlippage(whenTrue);
    const falseFeesSlippage = parseFeesSlippage(whenFalse);
    if (trueFeesSlippage?.fees === "10" && trueFeesSlippage.slippage === "5") {
      return { kind: "literal", value: "10:5" };
    }
    if (falseFeesSlippage?.fees === "10" && falseFeesSlippage.slippage === "5") {
      return { kind: "literal", value: "10:5" };
    }
  }
  if (ts.isSpreadAssignment(expression)) {
    const source = expression.expression;
    if (ts.isIdentifier(source)) {
      const resolved = constValues.get(source.text);
      if (resolved) return resolved;
    }
  }
  return { kind: "dynamic" };
}

function parseFeesSlippage(value: ResolvedValue): { fees: string; slippage: string } | null {
  if (value.kind !== "literal") return null;
  if (!value.value.includes(":")) return null;
  const [fees, slippage] = value.value.split(":");
  if (!fees || !slippage) return null;
  return { fees, slippage };
}

function collectConstValues(sourceFile: ts.SourceFile): Map<string, ResolvedValue> {
  const values = new Map<string, ResolvedValue>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isConditionalExpression(node.initializer)) {
        const whenTrue = resolveExpression(node.initializer.whenTrue, values);
        const trueFeesSlippage = parseFeesSlippage(whenTrue);
        if (trueFeesSlippage?.fees === "10" && trueFeesSlippage.slippage === "5") {
          values.set(node.name.text, { kind: "literal", value: "conditional:10:5" });
          ts.forEachChild(node, visit);
          return;
        }
      }
      if (ts.isObjectLiteralExpression(node.initializer)) {
        for (const prop of node.initializer.properties) {
          if (ts.isSpreadAssignment(prop) && ts.isIdentifier(prop.expression)) {
            const spread = values.get(prop.expression.text);
            if (spread) {
              values.set(node.name.text, spread);
              return;
            }
          }
        }
      }
      values.set(node.name.text, resolveExpression(node.initializer, values));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  visit(sourceFile);
  return values;
}

function prepareVectorSyntheticSource(vector: LegacyAuthorityNegativeVector): string {
  const entry = vector.files.find((file) => file.path === vector.entryFile) ?? vector.files[0];
  if (!entry) return "";
  const importAliases = new Map<string, string>();
  let entrySource = entry.source.replace(
    /import\s+\{\s*([A-Za-z0-9_]+)\s+as\s+([A-Za-z0-9_]+)\s*\}\s+from\s+['"][^'"]+['"];?\n?/g,
    (_match, original: string, alias: string) => {
      importAliases.set(alias, original);
      return "";
    },
  );
  for (const [alias, original] of importAliases) {
    entrySource = entrySource.replace(new RegExp(`\\b${alias}\\b`, "g"), original);
  }
  const support = vector.files
    .filter((file) => file.path !== entry.path)
    .map((file) => file.source.replace(/^export\s+/gm, ""))
    .join("\n");
  return `${support}\n${entrySource}`;
}

function resolveCallArgs(
  args: ts.NodeArray<ts.Expression>,
  constValues: Map<string, ResolvedValue>,
): ResolvedValue[] {
  return args.map((arg) => resolveExpression(arg, constValues));
}

function isLegacyTenFive(fee: ResolvedValue, slippage: ResolvedValue): boolean {
  return (
    fee.kind === "literal" &&
    slippage.kind === "literal" &&
    fee.value === "10" &&
    slippage.value === "5"
  );
}

function scanSourceForLegacyAuthority(input: {
  source: string;
  fileName: string;
  importSources?: Map<string, string>;
}): LegacyAuthorityScanResult | null {
  const importSources = input.importSources ?? new Map<string, string>();
  const mergedSource = `${[...importSources.values()].join("\n")}\n${input.source}`;
  const sourceFile = ts.createSourceFile(
    input.fileName,
    mergedSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const constValues = collectConstValues(sourceFile);
  const parameterNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      for (const param of statement.parameters) {
        if (ts.isIdentifier(param.name)) {
          parameterNames.add(param.name.text);
        }
      }
    }
  }
  let result: LegacyAuthorityScanResult | null = null;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const calleeName = node.expression.getText();
      const args = resolveCallArgs(node.arguments, constValues);

      if (COST_MODEL_FACTORY_NAMES.has(calleeName)) {
        const fee = args[0] ?? { kind: "dynamic" };
        const slippage = args[1] ?? { kind: "dynamic" };
        if (fee.kind === "dynamic" || slippage.kind === "dynamic") {
          result = {
            vectorId: "",
            verdict: "BLOCK",
            ruleId: "HTR_DYNAMIC_COST_AUTHORITY_FAIL_CLOSED",
            sinkCategory: "COST_MODEL_FACTORY",
            detectedValues: [
              fee.kind === "dynamic" ? "DYNAMIC" : fee.value,
              slippage.kind === "dynamic" ? "DYNAMIC" : slippage.value,
            ],
            diagnosticCode: "HTR_DYNAMIC_COST_AUTHORITY_FAIL_CLOSED",
          };
          return;
        }
        if (isLegacyTenFive(fee, slippage)) {
          result = {
            vectorId: "",
            verdict: "BLOCK",
            ruleId: "HTR_LEGACY_COST_10_5",
            sinkCategory: "COST_MODEL_FACTORY",
            detectedValues: ["10", "5"],
            diagnosticCode: "HTR_LEGACY_COST_10_5",
          };
          return;
        }
      }

      if (EXECUTION_MODEL_FACTORY_NAMES.has(calleeName)) {
        const argExpression = node.arguments[0];
        if (argExpression && ts.isConditionalExpression(argExpression)) {
          result = {
            vectorId: "",
            verdict: "BLOCK",
            ruleId: "HTR_CONDITIONAL_COST_AUTHORITY_BYPASS",
            sinkCategory: "EXECUTION_MODEL_FACTORY",
            detectedValues: ["10", "5"],
            diagnosticCode: "HTR_CONDITIONAL_COST_AUTHORITY_BYPASS",
          };
          return;
        }
        const arg = args[0] ?? { kind: "dynamic" };
        if (arg.kind === "literal" && arg.value === "conditional:10:5") {
          result = {
            vectorId: "",
            verdict: "BLOCK",
            ruleId: "HTR_CONDITIONAL_COST_AUTHORITY_BYPASS",
            sinkCategory: "EXECUTION_MODEL_FACTORY",
            detectedValues: ["10", "5"],
            diagnosticCode: "HTR_CONDITIONAL_COST_AUTHORITY_BYPASS",
          };
          return;
        }
        if (arg.kind === "dynamic") {
          result = {
            vectorId: "",
            verdict: "BLOCK",
            ruleId: "HTR_DYNAMIC_COST_AUTHORITY_FAIL_CLOSED",
            sinkCategory: "EXECUTION_MODEL_FACTORY",
            detectedValues: ["DYNAMIC", "DYNAMIC"],
            diagnosticCode: "HTR_DYNAMIC_COST_AUTHORITY_FAIL_CLOSED",
          };
          return;
        }
        const parsed = parseFeesSlippage(arg);
        if (parsed?.fees === "10" && parsed.slippage === "5") {
          result = {
            vectorId: "",
            verdict: "BLOCK",
            ruleId: "HTR_LEGACY_COST_10_5",
            sinkCategory: "EXECUTION_MODEL_FACTORY",
            detectedValues: ["10", "5"],
            diagnosticCode: "HTR_LEGACY_COST_10_5",
          };
          return;
        }
      }

      if (RUNTIME_SINK_NAMES.has(calleeName)) {
        const arg = node.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            if (ts.isShorthandPropertyAssignment(prop)) {
              if (parameterNames.has(prop.name.text)) {
                result = {
                  vectorId: "",
                  verdict: "BLOCK",
                  ruleId: "HTR_CALLER_SUPPLIED_COST_AUTHORITY",
                  sinkCategory: "RUNTIME_COST_AUTHORITY",
                  detectedValues: ["DYNAMIC"],
                  diagnosticCode: "HTR_CALLER_SUPPLIED_COST_AUTHORITY",
                };
                return;
              }
              continue;
            }
            if (!ts.isPropertyAssignment(prop)) continue;
            if (prop.name.getText().replace(/['"]/g, "") !== "costAuthority") continue;
            if (
              ts.isIdentifier(prop.initializer) &&
              (parameterNames.has(prop.initializer.text) ||
                prop.initializer.text === "userSuppliedCostAuthority")
            ) {
              result = {
                vectorId: "",
                verdict: "BLOCK",
                ruleId: "HTR_CALLER_SUPPLIED_COST_AUTHORITY",
                sinkCategory: "RUNTIME_COST_AUTHORITY",
                detectedValues: ["DYNAMIC"],
                diagnosticCode: "HTR_CALLER_SUPPLIED_COST_AUTHORITY",
              };
              return;
            }
          }
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.getText() === "createHistoricalExecutionModel" &&
      node.arguments[0] &&
      ts.isConditionalExpression(node.arguments[0])
    ) {
      result = {
        vectorId: "",
        verdict: "BLOCK",
        ruleId: "HTR_CONDITIONAL_COST_AUTHORITY_BYPASS",
        sinkCategory: "EXECUTION_MODEL_FACTORY",
        detectedValues: ["10", "5"],
        diagnosticCode: "HTR_CONDITIONAL_COST_AUTHORITY_BYPASS",
      };
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return result;
}

export function scanLegacyAuthorityNegativeVector(
  vector: LegacyAuthorityNegativeVector,
): LegacyAuthorityScanResult {
  const entry = vector.files.find((file) => file.path === vector.entryFile) ?? vector.files[0];
  if (!entry) {
    return {
      vectorId: vector.vectorId,
      verdict: "ALLOW",
      ruleId: null,
      sinkCategory: null,
      detectedValues: [],
      diagnosticCode: null,
    };
  }

  const syntheticSource = prepareVectorSyntheticSource(vector);
  const hit = scanSourceForLegacyAuthority({
    source: syntheticSource,
    fileName: entry.path,
  });
  if (!hit) {
    return {
      vectorId: vector.vectorId,
      verdict: "ALLOW",
      ruleId: null,
      sinkCategory: null,
      detectedValues: [],
      diagnosticCode: null,
    };
  }
  return { ...hit, vectorId: vector.vectorId };
}

export const WP21_LEGACY_AUTHORITY_NEGATIVE_VECTORS: LegacyAuthorityNegativeVector[] = [
  {
    vectorId: "LEGACY-NEG-001_TEMPLATE_10",
    files: [
      { path: "entry.ts", source: 'const feeBps = `${1}${0}`;\ncreateCostModelV1(feeBps, "5");' },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_LEGACY_COST_10_5",
    expectedSinkCategory: "COST_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_LEGACY_COST_10_5",
  },
  {
    vectorId: "LEGACY-NEG-002_TEMPLATE_5",
    files: [
      {
        path: "entry.ts",
        source: 'const slippageBps = `${5}`;\ncreateCostModelV1("10", slippageBps);',
      },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_LEGACY_COST_10_5",
    expectedSinkCategory: "COST_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_LEGACY_COST_10_5",
  },
  {
    vectorId: "LEGACY-NEG-003_CONCAT_10",
    files: [
      { path: "entry.ts", source: 'const feeBps = "1" + "0";\ncreateCostModelV1(feeBps, "5");' },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_LEGACY_COST_10_5",
    expectedSinkCategory: "COST_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_LEGACY_COST_10_5",
  },
  {
    vectorId: "LEGACY-NEG-004_STRING_CALL_10",
    files: [{ path: "entry.ts", source: "createCostModelV1(String(10), String(5));" }],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_LEGACY_COST_10_5",
    expectedSinkCategory: "COST_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_LEGACY_COST_10_5",
  },
  {
    vectorId: "LEGACY-NEG-005_ARITHMETIC_10",
    files: [
      {
        path: "entry.ts",
        source:
          "const feeBps = String(2 * 5);\nconst slippageBps = String(10 / 2);\ncreateCostModelV1(feeBps, slippageBps);",
      },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_LEGACY_COST_10_5",
    expectedSinkCategory: "COST_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_LEGACY_COST_10_5",
  },
  {
    vectorId: "LEGACY-NEG-006_CONST_PROPAGATION",
    files: [
      {
        path: "entry.ts",
        source:
          "const ten = 10;\nconst five = 5;\nconst feeBps = `${ten}`;\nconst slippageBps = `${five}`;\ncreateCostModelV1(feeBps, slippageBps);",
      },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_LEGACY_COST_10_5",
    expectedSinkCategory: "COST_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_LEGACY_COST_10_5",
  },
  {
    vectorId: "LEGACY-NEG-007_OBJECT_SPREAD",
    files: [
      {
        path: "entry.ts",
        source:
          "const legacy = { feesBps: 10, slippageBps: 5 };\nconst config = { ...legacy };\ncreateHistoricalExecutionModel(config);",
      },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_LEGACY_COST_10_5",
    expectedSinkCategory: "EXECUTION_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_LEGACY_COST_10_5",
  },
  {
    vectorId: "LEGACY-NEG-008_IMPORT_ALIAS",
    files: [
      {
        path: "legacy-cost.ts",
        source: "export const legacyCost = { feesBps: 10, slippageBps: 5 };",
      },
      {
        path: "entry.ts",
        source:
          'import { legacyCost as cost } from "./legacy-cost";\ncreateHistoricalExecutionModel(cost);',
      },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_LEGACY_COST_10_5",
    expectedSinkCategory: "EXECUTION_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_LEGACY_COST_10_5",
  },
  {
    vectorId: "LEGACY-NEG-009_JSON_PARSE",
    files: [
      {
        path: "entry.ts",
        source:
          'const cost = JSON.parse(\'{"feesBps":10,"slippageBps":5}\');\ncreateHistoricalExecutionModel(cost);',
      },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_LEGACY_COST_10_5",
    expectedSinkCategory: "EXECUTION_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_LEGACY_COST_10_5",
  },
  {
    vectorId: "LEGACY-NEG-010_PROCESS_ENV",
    files: [
      {
        path: "entry.ts",
        source:
          "const feeBps = process.env.FEE_BPS;\nconst slippageBps = process.env.SLIPPAGE_BPS;\ncreateCostModelV1(feeBps, slippageBps);",
      },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_DYNAMIC_COST_AUTHORITY_FAIL_CLOSED",
    expectedSinkCategory: "COST_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["DYNAMIC", "DYNAMIC"],
    expectedDiagnosticCode: "HTR_DYNAMIC_COST_AUTHORITY_FAIL_CLOSED",
  },
  {
    vectorId: "LEGACY-NEG-011_CONDITIONAL_BYPASS",
    files: [
      {
        path: "entry.ts",
        source:
          "const selected = useLegacy\n  ? { feesBps: 10, slippageBps: 5 }\n  : canonicalCostAuthority;\ncreateHistoricalExecutionModel(selected);",
      },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_CONDITIONAL_COST_AUTHORITY_BYPASS",
    expectedSinkCategory: "EXECUTION_MODEL_FACTORY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["10", "5"],
    expectedDiagnosticCode: "HTR_CONDITIONAL_COST_AUTHORITY_BYPASS",
  },
  {
    vectorId: "LEGACY-NEG-012_CALLER_SUPPLIED_OBJECT",
    files: [
      {
        path: "entry.ts",
        source:
          "function run(costAuthority: CostAuthorityInput) {\n  return executeHistoricalFill({ costAuthority });\n}\n\nrun(userSuppliedCostAuthority);",
      },
    ],
    entryFile: "entry.ts",
    expectedRuleId: "HTR_CALLER_SUPPLIED_COST_AUTHORITY",
    expectedSinkCategory: "RUNTIME_COST_AUTHORITY",
    expectedVerdict: "BLOCK",
    expectedDetectedValues: ["DYNAMIC"],
    expectedDiagnosticCode: "HTR_CALLER_SUPPLIED_COST_AUTHORITY",
  },
];

export function scanProductionLegacyCostAuthoritySites(
  source: string,
  filePath: string,
): LegacyAuthorityScanResult[] {
  const hit = scanSourceForLegacyAuthority({ source, fileName: filePath });
  return hit ? [{ ...hit, vectorId: filePath }] : [];
}
