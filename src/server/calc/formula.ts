// Minimal, dependency-free arithmetic expression evaluator for the
// per-row "custom" area formula. Deliberately NOT eval()/Function() based —
// it's a small hand-written tokenizer + recursive-descent parser that only
// understands numbers, named variables, + - * / ^, unary minus, parens,
// and a couple of whitelisted functions. There is no way for a formula
// string to reach outside this grammar.
//
// Supported: + - * / ^  ( )  PI()  sqrt(x)  abs(x)  and any variable name
// passed in via `vars` (case-insensitive), e.g. extW, extL, intW, intL, qty, thk.

export class FormulaError extends Error {}

type TokenType = "num" | "ident" | "op" | "lparen" | "rparen" | "comma";
interface Token {
  type: TokenType;
  value: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: "num", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ type: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^".includes(ch)) { tokens.push({ type: "op", value: ch }); i++; continue; }
    if (ch === "(") { tokens.push({ type: "lparen", value: ch }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen", value: ch }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "comma", value: ch }); i++; continue; }
    throw new FormulaError(`Unexpected character "${ch}" in formula`);
  }
  return tokens;
}

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  pi: () => Math.PI,
};

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private vars: Record<string, number>) {}

  private peek() { return this.tokens[this.pos]; }
  private next() { return this.tokens[this.pos++]; }

  parse(): number {
    const result = this.parseExpr();
    if (this.pos < this.tokens.length) {
      throw new FormulaError(`Unexpected token "${this.peek().value}" in formula`);
    }
    return result;
  }

  // expr := term (( + | - ) term)*
  private parseExpr(): number {
    let value = this.parseTerm();
    while (this.peek() && this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      const rhs = this.parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  // term := power (( * | / ) power)*
  private parseTerm(): number {
    let value = this.parsePower();
    while (this.peek() && this.peek().type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.next().value;
      const rhs = this.parsePower();
      if (op === "/") {
        if (rhs === 0) throw new FormulaError("Division by zero in formula");
        value = value / rhs;
      } else {
        value = value * rhs;
      }
    }
    return value;
  }

  // power := unary ( ^ power )?  (right-associative)
  private parsePower(): number {
    const base = this.parseUnary();
    if (this.peek() && this.peek().type === "op" && this.peek().value === "^") {
      this.next();
      const exp = this.parsePower();
      return Math.pow(base, exp);
    }
    return base;
  }

  // unary := ( + | - ) unary | atom
  private parseUnary(): number {
    if (this.peek() && this.peek().type === "op" && (this.peek().value === "-" || this.peek().value === "+")) {
      const op = this.next().value;
      const value = this.parseUnary();
      return op === "-" ? -value : value;
    }
    return this.parseAtom();
  }

  // atom := number | ident ( "(" args ")" )? | "(" expr ")"
  private parseAtom(): number {
    const tok = this.peek();
    if (!tok) throw new FormulaError("Unexpected end of formula");

    if (tok.type === "num") {
      this.next();
      return Number(tok.value);
    }

    if (tok.type === "ident") {
      this.next();
      const name = tok.value;
      if (this.peek() && this.peek().type === "lparen") {
        this.next(); // (
        const args: number[] = [];
        if (this.peek() && this.peek().type !== "rparen") {
          args.push(this.parseExpr());
          while (this.peek() && this.peek().type === "comma") {
            this.next();
            args.push(this.parseExpr());
          }
        }
        if (!this.peek() || this.peek().type !== "rparen") throw new FormulaError(`Missing ")" after ${name}(`);
        this.next(); // )
        const fn = FUNCTIONS[name.toLowerCase()];
        if (!fn) throw new FormulaError(`Unknown function "${name}"`);
        return fn(...args);
      }
      const lower = name.toLowerCase();
      if (lower === "pi") return Math.PI;
      const key = Object.keys(this.vars).find((k) => k.toLowerCase() === lower);
      if (key === undefined) throw new FormulaError(`Unknown variable "${name}"`);
      return this.vars[key];
    }

    if (tok.type === "lparen") {
      this.next();
      const value = this.parseExpr();
      if (!this.peek() || this.peek().type !== "rparen") throw new FormulaError('Missing ")" in formula');
      this.next();
      return value;
    }

    throw new FormulaError(`Unexpected token "${tok.value}" in formula`);
  }
}

// Evaluates a formula string against a fixed set of numeric variables.
// Throws FormulaError on any parse/eval problem — callers should catch
// this and surface it as a validation error rather than letting it crash.
export function evalFormula(formula: string, vars: Record<string, number>): number {
  const trimmed = formula.trim();
  if (!trimmed) throw new FormulaError("Formula is empty");
  if (trimmed.length > 300) throw new FormulaError("Formula is too long");
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new FormulaError("Formula is empty");
  const result = new Parser(tokens, vars).parse();
  if (!Number.isFinite(result)) throw new FormulaError("Formula did not evaluate to a finite number");
  return result;
}
