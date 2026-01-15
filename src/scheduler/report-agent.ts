import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import type { AcademicData } from "../types/academic.ts";
import { getAtRiskStudents, summarizeRiskStatus } from "../analysis/risk-assessment.ts";
import { getDepartmentStatistics, getInstitutionOverview, getProblemCourses } from "../analysis/department-stats.ts";
import { getReportPrompt } from "./report-prompts.ts";

// Report types supported
export type ReportType = "at-risk" | "department" | "intervention";

/**
 * Create LLM instance configured for report generation
 */
function createReportLLM() {
  return new ChatOpenAI({
    model: "gpt-4o",
    temperature: 0.3, // Slightly creative for natural prose
    maxTokens: 4096,  // Enough for detailed reports
    apiKey: Deno.env.get("OPENAI_API_KEY"),
  });
}

/**
 * Prepare data context for at-risk students report
 */
function prepareAtRiskData(data: AcademicData) {
  const atRiskStudents = getAtRiskStudents(data);
  const summary = summarizeRiskStatus(data);

  // Enrich with full student details
  const enrichedStudents = atRiskStudents.map((assessment) => {
    const student = data.students.find((s) => s.id === assessment.studentId);
    if (!student) return assessment;

    // Get current enrollments with course names
    const currentCourses = student.enrollments
      .filter((e) => e.status === "in_progress")
      .map((e) => {
        const course = data.courses.find((c) => c.id === e.course_id);
        return {
          courseCode: course?.code ?? e.course_id,
          courseName: course?.name ?? "Unknown",
          midtermScore: e.midterm_score,
          attendance: e.attendance,
          homeworkAvg: e.homework_avg,
        };
      });

    // Get failed courses history
    const failedCourses = student.enrollments
      .filter((e) => e.status === "failed")
      .map((e) => {
        const course = data.courses.find((c) => c.id === e.course_id);
        return {
          courseCode: course?.code ?? e.course_id,
          semester: e.semester_id,
          score: e.weighted_average,
        };
      });

    return {
      ...assessment,
      gpa: student.gpa,
      status: student.status,
      currentSemester: student.current_semester,
      completedCredits: student.completed_credits,
      department: student.department_id,
      advisorNotes: student.advisor_notes,
      currentCourses,
      failedCourses,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    university: data.university,
    summary: {
      totalStudents: summary.total,
      criticalCount: summary.critical,
      warningCount: summary.warning,
      normalCount: summary.normal,
      atRiskPercentage: ((summary.critical + summary.warning) / summary.total * 100).toFixed(1),
    },
    students: enrichedStudents,
  };
}

/**
 * Prepare data context for department performance report
 */
function prepareDepartmentData(data: AcademicData) {
  const overview = getInstitutionOverview(data);
  const departmentStats = data.departments.map((dept) =>
    getDepartmentStatistics(dept.id, data)
  );

  return {
    generatedAt: new Date().toISOString(),
    institution: {
      name: overview.universityName,
      academicYear: overview.academicYear,
      currentSemester: overview.currentSemester,
      totalStudents: overview.totalStudents,
      averageGPA: overview.averageGPA.toFixed(2),
      statusDistribution: overview.statusDistribution,
    },
    departments: departmentStats.map((dept) => ({
      id: dept.departmentId,
      name: dept.departmentName,
      totalStudents: dept.totalStudents,
      averageGPA: dept.averageGPA.toFixed(2),
      atRiskCount: dept.atRiskCount,
      atRiskPercentage: ((dept.atRiskCount / dept.totalStudents) * 100).toFixed(1),
      probationCount: dept.probationCount,
      courses: dept.courseStats.map((cs) => ({
        id: cs.courseId,
        name: cs.courseName,
        passRate: cs.passRate.toFixed(1),
        failRate: cs.failRate.toFixed(1),
        averageScore: cs.averageScore.toFixed(1),
        currentlyAtRisk: cs.atRiskCount,
      })),
    })),
  };
}

/**
 * Prepare data context for intervention action plan
 */
function prepareInterventionData(data: AcademicData) {
  const atRiskStudents = getAtRiskStudents(data);
  const criticalStudents = atRiskStudents.filter((s) => s.riskLevel === "critical");
  const warningStudents = atRiskStudents.filter((s) => s.riskLevel === "warning");
  const problemCourses = getProblemCourses(data, 15);
  const summary = summarizeRiskStatus(data);

  // Enrich critical students with details
  const criticalDetails = criticalStudents.map((assessment) => {
    const student = data.students.find((s) => s.id === assessment.studentId);
    return {
      studentId: assessment.studentId,
      studentName: assessment.studentName,
      gpa: student?.gpa ?? 0,
      status: student?.status ?? "unknown",
      department: student?.department_id ?? "unknown",
      riskFactors: assessment.factors,
      recommendations: assessment.recommendations,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    university: data.university,
    summary: {
      totalAtRisk: atRiskStudents.length,
      criticalCount: criticalStudents.length,
      warningCount: warningStudents.length,
      problemCoursesCount: problemCourses.length,
      byDepartment: summary.byDepartment,
    },
    criticalStudents: criticalDetails,
    problemCourses: problemCourses.slice(0, 5).map((cs) => ({
      courseId: cs.courseId,
      courseName: cs.courseName,
      failRate: cs.failRate.toFixed(1),
      totalEnrollments: cs.totalEnrollments,
      currentlyAtRisk: cs.atRiskCount,
    })),
    warningStudents: warningStudents.map((s) => ({
      studentId: s.studentId,
      studentName: s.studentName,
      factors: s.factors,
    })),
  };
}

/**
 * Get the appropriate data context for a report type
 */
function prepareDataContext(reportType: ReportType, data: AcademicData) {
  switch (reportType) {
    case "at-risk":
      return prepareAtRiskData(data);
    case "department":
      return prepareDepartmentData(data);
    case "intervention":
      return prepareInterventionData(data);
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
}

/**
 * Generate an AI-powered report
 * Passes data and prompt to LLM, returns generated markdown content
 */
export async function generateAIReport(
  reportType: ReportType,
  data: AcademicData
): Promise<string> {
  const llm = createReportLLM();

  // Get the appropriate prompt for this report type
  const systemPrompt = getReportPrompt(reportType);

  // Prepare data context
  const dataContext = prepareDataContext(reportType, data);

  // Build the full prompt with data
  const fullPrompt = `${systemPrompt}

---

## Academic Data to Analyze

\`\`\`json
${JSON.stringify(dataContext, null, 2)}
\`\`\`

---

Now generate the complete report based on the above data:`;

  // Call the LLM
  const response = await llm.invoke([new HumanMessage(fullPrompt)]);

  // Extract content from response
  const content = response.content;
  if (typeof content === "string") {
    return content;
  }

  // Handle array content (shouldn't happen but be safe)
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === "string" ? c : JSON.stringify(c))).join("\n");
  }

  return String(content);
}

/**
 * Generate report header with metadata
 */
export function generateReportHeader(title: string): string {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toLocaleTimeString("en-US", { hour12: false });

  return `# ${title}

> **Generated:** ${dateStr} at ${timeStr}
> **System:** AI-Generated Report (GPT-4o)
> **University:** Tech University | Academic Year: 2024-2025

---

`;
}
