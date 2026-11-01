import { load } from "jsr:@std/dotenv";
import { loadAcademicData } from "./src/data/loader.ts";
import { createStudentAgent, getStudentInfo } from "./src/agents/student-agent.ts";
import { createDeanAgent } from "./src/agents/dean-agent.ts";
import { executeQuery, getLLMSelection } from "./src/agents/base-agent.ts";
import { generateDailyReports } from "./src/scheduler/report-generator.ts";
import { initializeCourseVectorStore } from "./src/rag/course-retriever.ts";
import { renderMarkdown } from "./src/utils/terminal-markdown.ts";
import type { AcademicData } from "./src/types/academic.ts";

// Load environment variables from .env file
await load({ export: true });

// CLI colors for styled output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

// CLI arguments interface
interface CLIArgs {
  mode: "menu" | "student" | "dean" | "report";
  studentId?: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CLIArgs {
  const args = Deno.args;
  let mode: CLIArgs["mode"] = "menu";
  let studentId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mode" && args[i + 1]) {
      const modeArg = args[i + 1].toLowerCase();
      if (["student", "dean", "report", "menu"].includes(modeArg)) {
        mode = modeArg as CLIArgs["mode"];
      }
      i++;
    } else if (arg.startsWith("--mode=")) {
      const modeArg = arg.split("=")[1].toLowerCase();
      if (["student", "dean", "report", "menu"].includes(modeArg)) {
        mode = modeArg as CLIArgs["mode"];
      }
    } else if (arg === "--student" && args[i + 1]) {
      studentId = args[i + 1];
      i++;
    } else if (arg.startsWith("--student=")) {
      studentId = arg.split("=")[1];
    }
  }

  return { mode, studentId };
}

/**
 * Display the welcome banner
 */
function showBanner(model: string): void {
  const poweredBy = `Powered by LangChain + ${model}`.padEnd(59);
  console.log(`${colors.cyan}
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║     ${colors.bright}Academic Advisor AI Agent${colors.reset}${colors.cyan}                             ║
║     ${colors.dim}Tech University - 2024-2025${colors.reset}${colors.cyan}                            ║
║                                                                ║
║     ${colors.yellow}${poweredBy}${colors.reset}${colors.cyan}║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
${colors.reset}`);
}

/**
 * Get user input from stdin
 */
async function prompt(message: string): Promise<string> {
  const buf = new Uint8Array(1024);
  await Deno.stdout.write(new TextEncoder().encode(`${colors.green}${message}${colors.reset}`));
  const n = await Deno.stdin.read(buf);
  // Closed input (Ctrl-D or the end of a pipe) would otherwise loop on empty answers forever
  if (n === null) {
    console.log();
    Deno.exit(0);
  }
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

/**
 * Display the main menu
 */
async function showMainMenu(): Promise<string> {
  console.log(`\n${colors.bright}Select Mode:${colors.reset}`);
  console.log(`  ${colors.cyan}1.${colors.reset} Student Mode ${colors.dim}(personalized academic advice)${colors.reset}`);
  console.log(`  ${colors.cyan}2.${colors.reset} Dean Mode ${colors.dim}(institutional analysis)${colors.reset}`);
  console.log(`  ${colors.cyan}3.${colors.reset} Generate Reports ${colors.dim}(daily analysis reports)${colors.reset}`);
  console.log(`  ${colors.cyan}4.${colors.reset} Exit`);

  return await prompt("\nEnter choice (1-4): ");
}

/**
 * Display student selection menu
 */
async function selectStudent(data: AcademicData): Promise<string | null> {
  console.log(`\n${colors.bright}Available Students:${colors.reset}`);

  data.students.forEach((student, index) => {
    const statusColor =
      student.status === "active"
        ? colors.green
        : student.status === "warning"
        ? colors.yellow
        : colors.red;
    const gpaColor = student.gpa >= 3.0 ? colors.green : student.gpa >= 2.0 ? colors.yellow : colors.red;

    console.log(
      `  ${colors.cyan}${index + 1}.${colors.reset} ${student.name} (${student.id}) ` +
        `- ${statusColor}${student.status}${colors.reset} ` +
        `- GPA: ${gpaColor}${student.gpa.toFixed(2)}${colors.reset}`
    );
  });

  const choice = await prompt("\nSelect student number (0 to go back): ");
  const index = parseInt(choice) - 1;

  if (index === -1) return null;
  if (index >= 0 && index < data.students.length) {
    return data.students[index].id;
  }
  console.log(`${colors.red}Invalid selection${colors.reset}`);
  return null;
}

/**
 * Run the interactive chat loop
 */
async function chatLoop(
  // deno-lint-ignore no-explicit-any
  agent: any,
  mode: string,
  studentInfo?: { name: string; gpa: number } | null
): Promise<void> {
  console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}${mode} Mode Active${colors.reset}`);
  if (studentInfo) {
    console.log(`${colors.dim}Student: ${studentInfo.name} | GPA: ${studentInfo.gpa.toFixed(2)}${colors.reset}`);
  }
  console.log(`${colors.dim}Type 'exit' to return to menu, 'help' for example queries${colors.reset}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  // Show example queries
  showExampleQueries(mode);

  while (true) {
    const query = await prompt("\n💬 You: ");

    if (query.toLowerCase() === "exit") {
      console.log(`${colors.dim}Returning to menu...${colors.reset}`);
      break;
    }

    if (query.toLowerCase() === "help") {
      showExampleQueries(mode);
      continue;
    }

    if (!query.trim()) {
      continue;
    }

    console.log(`\n${colors.yellow}🔄 Analyzing...${colors.reset}`);

    try {
      const response = await executeQuery(agent, query);
      const styledResponse = renderMarkdown(response);
      console.log(`\n${colors.bright}🤖 Advisor:${colors.reset}\n${styledResponse}`);
    } catch (error) {
      if (error instanceof Error) {
        console.log(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
        if (error.message.includes("API key")) {
          console.log(`${colors.yellow}💡 Tip: Make sure ${getLLMSelection().apiKeyEnvVar} is set in your .env file${colors.reset}`);
        }
      }
    }
  }
}

/**
 * Show example queries for the current mode
 */
function showExampleQueries(mode: string): void {
  console.log(`${colors.dim}Example queries:${colors.reset}`);

  if (mode === "Student") {
    console.log(`  ${colors.dim}• "What is my current academic standing?"${colors.reset}`);
    console.log(`  ${colors.dim}• "Which courses am I at risk of failing?"${colors.reset}`);
    console.log(`  ${colors.dim}• "What are my graduation requirements?"${colors.reset}`);
    console.log(`  ${colors.dim}• "What courses should I take next semester?"${colors.reset}`);
    console.log(`  ${colors.dim}• "I'm interested in AI - what courses are available?"${colors.reset}`);
  } else {
    console.log(`  ${colors.dim}• "Show all at-risk students"${colors.reset}`);
    console.log(`  ${colors.dim}• "What is the performance of CENG department?"${colors.reset}`);
    console.log(`  ${colors.dim}• "Which courses have the highest failure rates?"${colors.reset}`);
    console.log(`  ${colors.dim}• "What interventions do you recommend?"${colors.reset}`);
    console.log(`  ${colors.dim}• "Give me an overview of the institution"${colors.reset}`);
  }
}

/**
 * Run report generation mode
 */
async function runReportMode(): Promise<void> {
  console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}Report Generation Mode${colors.reset}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  try {
    const { outputDir, reports } = await generateDailyReports();

    console.log(`\n${colors.green}✅ Reports generated successfully!${colors.reset}`);
    console.log(`\n${colors.bright}Reports available at:${colors.reset} ${outputDir}`);
    for (const report of reports) {
      console.log(`  ${colors.cyan}•${colors.reset} ${report}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.log(`${colors.red}❌ Report generation failed: ${error.message}${colors.reset}`);
    }
  }
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  const { model, apiKeyEnvVar } = getLLMSelection();
  showBanner(model);

  // Check for the selected provider's API key
  if (!Deno.env.get(apiKeyEnvVar)) {
    console.log(`${colors.yellow}⚠️  Warning: ${apiKeyEnvVar} not found in environment${colors.reset}`);
    console.log(`${colors.dim}   Set it in .env file or export ${apiKeyEnvVar}=your_key${colors.reset}\n`);
  }

  // Load academic data
  console.log(`${colors.dim}Loading academic data...${colors.reset}`);
  let data: AcademicData;
  try {
    data = await loadAcademicData();
    console.log(
      `${colors.green}✓${colors.reset} Loaded ${data.students.length} students, ${data.courses.length} courses\n`
    );
  } catch (error) {
    if (error instanceof Error) {
      console.log(`${colors.red}❌ Failed to load data: ${error.message}${colors.reset}`);
    }
    Deno.exit(1);
  }

  // Initialize RAG vector store in background
  console.log(`${colors.dim}Initializing course search...${colors.reset}`);
  try {
    await initializeCourseVectorStore(data);
    console.log(`${colors.green}✓${colors.reset} Course search ready\n`);
  } catch (error) {
    console.log(`${colors.yellow}⚠️  Course search initialization skipped (needs OPENAI_API_KEY for embeddings)${colors.reset}\n`);
  }

  // Parse CLI arguments
  const args = parseArgs();

  // Handle direct mode execution from CLI
  if (args.mode === "report") {
    await runReportMode();
    return;
  }

  if (args.mode === "student" && args.studentId) {
    const studentInfo = getStudentInfo(data, args.studentId);
    if (!studentInfo) {
      console.log(`${colors.red}Student not found: ${args.studentId}${colors.reset}`);
      Deno.exit(1);
    }
    const agent = createStudentAgent(data, args.studentId);
    await chatLoop(agent, "Student", studentInfo);
    return;
  }

  if (args.mode === "dean") {
    const agent = createDeanAgent(data);
    await chatLoop(agent, "Dean");
    return;
  }

  // Interactive menu mode
  while (true) {
    const choice = await showMainMenu();

    switch (choice) {
      case "1": {
        // Student mode
        const studentId = await selectStudent(data);
        if (studentId) {
          const studentInfo = getStudentInfo(data, studentId);
          console.log(`\n${colors.dim}Creating student advisor agent...${colors.reset}`);
          const agent = createStudentAgent(data, studentId);
          await chatLoop(agent, "Student", studentInfo);
        }
        break;
      }
      case "2": {
        // Dean mode
        console.log(`\n${colors.dim}Creating institutional analysis agent...${colors.reset}`);
        const agent = createDeanAgent(data);
        await chatLoop(agent, "Dean");
        break;
      }
      case "3": {
        // Report generation
        await runReportMode();
        break;
      }
      case "4": {
        console.log(`\n${colors.cyan}Goodbye! 👋${colors.reset}\n`);
        Deno.exit(0);
      }
      default:
        console.log(`${colors.red}Invalid choice. Please enter 1-4.${colors.reset}`);
    }
  }
}

// Run the application
main().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  Deno.exit(1);
});
