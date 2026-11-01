/**
 * Terminal Markdown Renderer
 * Converts markdown to ANSI-styled terminal output
 */

// ANSI escape codes for terminal styling
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  // Colors
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  // Background
  bgBlue: "\x1b[44m",
  bgCyan: "\x1b[46m",
};

/**
 * Render markdown text to ANSI-styled terminal output
 */
export function renderMarkdown(markdown: string): string {
  const result = markdown;

  // Process line by line for block elements
  const lines = result.split("\n");
  const processedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Headers (process before inline styles)
    if (line.startsWith("#### ")) {
      line = `${ANSI.bold}${ANSI.cyan}${line.slice(5)}${ANSI.reset}`;
    } else if (line.startsWith("### ")) {
      line = `\n${ANSI.bold}${ANSI.yellow}▸ ${line.slice(4)}${ANSI.reset}`;
    } else if (line.startsWith("## ")) {
      line = `\n${ANSI.bold}${ANSI.green}■ ${line.slice(3)}${ANSI.reset}\n`;
    } else if (line.startsWith("# ")) {
      line = `\n${ANSI.bold}${ANSI.cyan}╔═══ ${
        line.slice(2)
      } ═══╗${ANSI.reset}\n`;
    } // Horizontal rules
    else if (line.match(/^[-_*]{3,}$/)) {
      line = `${ANSI.dim}${"─".repeat(50)}${ANSI.reset}`;
    } // Unordered lists
    else if (line.match(/^\s*[-*]\s/)) {
      const indent = line.match(/^(\s*)/)?.[1] || "";
      const content = line.replace(/^\s*[-*]\s/, "");
      line = `${indent}${ANSI.cyan}•${ANSI.reset} ${content}`;
    } // Numbered lists
    else if (line.match(/^\s*\d+\.\s/)) {
      const match = line.match(/^(\s*)(\d+)\.\s(.*)$/);
      if (match) {
        const [, indent, num, content] = match;
        line = `${indent}${ANSI.yellow}${num}.${ANSI.reset} ${content}`;
      }
    } // Blockquotes
    else if (line.startsWith("> ")) {
      line = `${ANSI.dim}│${ANSI.reset} ${ANSI.italic}${
        line.slice(2)
      }${ANSI.reset}`;
    } // Code blocks (triple backticks)
    else if (line.startsWith("```")) {
      line = `${ANSI.dim}${"─".repeat(40)}${ANSI.reset}`;
    }

    // Apply inline styles
    line = applyInlineStyles(line);

    processedLines.push(line);
  }

  return processedLines.join("\n");
}

/**
 * Apply inline markdown styles (bold, italic, code, links)
 */
function applyInlineStyles(text: string): string {
  let result = text;

  // Bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, `${ANSI.bold}$1${ANSI.reset}`);
  result = result.replace(/__([^_]+)__/g, `${ANSI.bold}$1${ANSI.reset}`);

  // Italic: *text* or _text_ (but not inside words)
  result = result.replace(
    /(?<![*\w])\*([^*]+)\*(?![*\w])/g,
    `${ANSI.italic}$1${ANSI.reset}`,
  );
  result = result.replace(
    /(?<![_\w])_([^_]+)_(?![_\w])/g,
    `${ANSI.italic}$1${ANSI.reset}`,
  );

  // Inline code: `code`
  result = result.replace(
    /`([^`]+)`/g,
    `${ANSI.bgCyan}${ANSI.bold} $1 ${ANSI.reset}`,
  );

  // Links: [text](url) - show text underlined
  result = result.replace(
    /\[([^\]]+)\]\([^)]+\)/g,
    `${ANSI.underline}${ANSI.blue}$1${ANSI.reset}`,
  );

  // Strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, `${ANSI.dim}$1${ANSI.reset}`);

  return result;
}

/**
 * Render a table in markdown format to terminal
 */
export function renderTable(headers: string[], rows: string[][]): string {
  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const maxRowWidth = Math.max(...rows.map((r) => (r[i] || "").length));
    return Math.max(h.length, maxRowWidth);
  });

  // Build table
  const lines: string[] = [];

  // Header
  const headerLine = headers
    .map((h, i) => `${ANSI.bold}${h.padEnd(colWidths[i])}${ANSI.reset}`)
    .join(" │ ");
  lines.push(`┌─${"─".repeat(headerLine.length - 20)}─┐`);
  lines.push(`│ ${headerLine} │`);
  lines.push(`├─${"─".repeat(headerLine.length - 20)}─┤`);

  // Rows
  for (const row of rows) {
    const rowLine = row.map((cell, i) => (cell || "").padEnd(colWidths[i]))
      .join(" │ ");
    lines.push(`│ ${rowLine} │`);
  }

  lines.push(`└─${"─".repeat(headerLine.length - 20)}─┘`);

  return `${ANSI.cyan}${lines.join("\n")}${ANSI.reset}`;
}
