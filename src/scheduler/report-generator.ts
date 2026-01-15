import { loadAcademicData } from "../data/loader.ts";
import { generateAIReport, generateReportHeader, type ReportType } from "./report-agent.ts";

// Report output directory
const REPORTS_DIR = "./reports";

/**
 * Ensure the reports directory exists
 */
async function ensureReportsDir(dateStr: string): Promise<string> {
  const reportPath = `${REPORTS_DIR}/${dateStr}`;
  await Deno.mkdir(reportPath, { recursive: true });
  return reportPath;
}

/**
 * Generate a single AI-powered report
 * Uses LLM to analyze data and produce natural language insights
 */
async function generateReport(
  reportType: ReportType,
  title: string,
  filename: string,
  data: Awaited<ReturnType<typeof loadAcademicData>>,
  outputDir: string
): Promise<void> {
  console.log(`  Generating ${title} (AI-powered)...`);

  // Generate header with metadata
  const header = generateReportHeader(title);

  // Call LLM to generate the full report
  const aiContent = await generateAIReport(reportType, data);

  // Combine header and AI-generated content
  const reportContent = header + aiContent;

  const outputPath = `${outputDir}/${filename}`;
  await Deno.writeTextFile(outputPath, reportContent);

  console.log(`  ✓ Saved: ${outputPath}`);
}


// Report configurations for AI generation
const REPORT_CONFIGS: Array<{
  type: ReportType;
  title: string;
  filename: string;
}> = [
  { type: "at-risk", title: "At-Risk Students Report", filename: "at-risk-students.md" },
  { type: "department", title: "Department Performance Report", filename: "department-summary.md" },
  { type: "intervention", title: "Intervention Action Plan", filename: "intervention-plan.md" },
];

/**
 * Generate all daily reports using AI
 * This is the main entry point for scheduled report generation
 */
export async function generateDailyReports(
  dataPath?: string
): Promise<{ outputDir: string; reports: string[] }> {
  console.log("\n📊 Starting AI-powered report generation...\n");

  // Load academic data
  const data = await loadAcademicData(dataPath);
  console.log(
    `Loaded data: ${data.students.length} students, ${data.courses.length} courses\n`
  );

  // Create date-stamped output directory
  const dateStr = new Date().toISOString().split("T")[0];
  const outputDir = await ensureReportsDir(dateStr);
  console.log(`Output directory: ${outputDir}\n`);

  // Generate all reports using AI
  const reports: string[] = [];

  for (const config of REPORT_CONFIGS) {
    try {
      await generateReport(config.type, config.title, config.filename, data, outputDir);
      reports.push(config.filename);
    } catch (error) {
      console.error(`  ✗ Failed to generate ${config.title}:`, error);
    }
  }

  console.log(`\n✅ AI report generation complete!`);
  console.log(`   Generated ${reports.length} report(s) in ${outputDir}`);

  return { outputDir, reports };
}

/**
 * Run report generation if this file is executed directly
 */
if (import.meta.main) {
  generateDailyReports()
    .then(({ outputDir, reports }) => {
      console.log(`\nReports available at: ${outputDir}`);
      for (const report of reports) {
        console.log(`  - ${report}`);
      }
    })
    .catch((error) => {
      console.error("Report generation failed:", error);
      Deno.exit(1);
    });
}
