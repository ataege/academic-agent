import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { AcademicData } from "../types/academic.ts";
import { findStudent, findCourse } from "../data/loader.ts";
import { getAtRiskStudents, summarizeRiskStatus } from "../analysis/risk-assessment.ts";
import {
  getDepartmentStatistics,
  getInstitutionOverview,
  calculateCourseStats,
  getProblemCourses,
  getCourseGradeDistribution,
  compareDepartments,
} from "../analysis/department-stats.ts";

/**
 * Create dean-level analysis tools for institutional oversight
 * These tools provide aggregate data and intervention recommendations
 */
export function createDeanTools(data: AcademicData) {
  // Tool 1: Get all at-risk students
  const getAllAtRiskStudents = tool(
    async () => {
      const atRiskStudents = getAtRiskStudents(data);
      const summary = summarizeRiskStatus(data);

      return JSON.stringify({
        summary: {
          totalStudents: summary.total,
          criticalCount: summary.critical,
          warningCount: summary.warning,
          normalCount: summary.normal,
          byDepartment: summary.byDepartment,
        },
        students: atRiskStudents.map((assessment) => {
          const student = data.students.find(
            (s) => s.id === assessment.studentId
          );
          return {
            studentId: assessment.studentId,
            name: assessment.studentName,
            department: student?.department_id,
            gpa: student?.gpa,
            riskLevel: assessment.riskLevel,
            factors: assessment.factors,
            recommendations: assessment.recommendations,
          };
        }),
      });
    },
    {
      name: "get_all_at_risk_students",
      description:
        "Get a comprehensive list of all at-risk students across the institution, including their risk levels, factors, and recommended interventions. Use this for institution-wide risk assessment.",
    }
  );

  // Tool 2: Get department statistics
  const getDepartmentStats = tool(
    async ({ departmentId }) => {
      const stats = getDepartmentStatistics(departmentId, data);

      return JSON.stringify({
        departmentId: stats.departmentId,
        departmentName: stats.departmentName,
        totalStudents: stats.totalStudents,
        averageGPA: stats.averageGPA.toFixed(2),
        atRiskStudents: stats.atRiskCount,
        studentsOnProbation: stats.probationCount,
        atRiskPercentage:
          stats.totalStudents > 0
            ? ((stats.atRiskCount / stats.totalStudents) * 100).toFixed(1)
            : 0,
        coursePerformance: stats.courseStats.map((cs) => ({
          courseId: cs.courseId,
          courseName: cs.courseName,
          passRate: cs.passRate.toFixed(1) + "%",
          failRate: cs.failRate.toFixed(1) + "%",
          averageScore: cs.averageScore.toFixed(1),
          currentlyAtRisk: cs.atRiskCount,
        })),
      });
    },
    {
      name: "get_department_statistics",
      description:
        "Get comprehensive statistics for a specific department including student counts, GPA averages, course pass/fail rates, and at-risk metrics. Use departmentId 'CENG' for Computer Engineering or 'SENG' for Software Engineering.",
      schema: z.object({
        departmentId: z
          .enum(["CENG", "SENG"])
          .describe("Department ID: CENG (Computer Engineering) or SENG (Software Engineering)"),
      }),
    }
  );

  // Tool 3: Get institution overview
  const getInstitutionOverviewTool = tool(
    async () => {
      const overview = getInstitutionOverview(data);
      const comparison = compareDepartments(data);

      return JSON.stringify({
        university: overview.universityName,
        academicYear: overview.academicYear,
        currentSemester: overview.currentSemester,
        totalStudents: overview.totalStudents,
        averageGPA: overview.averageGPA.toFixed(2),
        statusDistribution: overview.statusDistribution,
        departments: overview.departmentSummary.map((d) => ({
          ...d,
          avgGPA: d.avgGPA.toFixed(2),
        })),
        departmentComparison: {
          bestPerforming: comparison.bestPerforming,
          needsAttention: comparison.needsAttention,
        },
      });
    },
    {
      name: "get_institution_overview",
      description:
        "Get a high-level overview of the entire institution including total students, average GPA, status distribution, and department comparisons. Use this for executive summaries.",
    }
  );

  // Tool 4: Get course performance report
  const getCoursePerformanceReport = tool(
    async ({ courseId }) => {
      const course = findCourse(data, courseId);
      if (!course) {
        return JSON.stringify({ error: `Course not found: ${courseId}` });
      }

      const stats = calculateCourseStats(course.id, data);
      const gradeDistribution = getCourseGradeDistribution(course.id, data);

      // Get current enrollments with details
      const currentEnrollments = data.students.flatMap((s) =>
        s.enrollments.filter(
          (e) => e.course_id === course.id && e.status === "in_progress"
        )
      );

      const atRiskStudents = currentEnrollments
        .filter((e) => e.midterm_score !== null && e.midterm_score < 60)
        .map((e) => {
          const student = data.students.find((s) =>
            s.enrollments.includes(e)
          );
          return {
            studentId: student?.id,
            studentName: student?.name,
            midtermScore: e.midterm_score,
          };
        });

      return JSON.stringify({
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        credits: course.credits,
        department: course.department_id,
        type: course.type,
        historicalData: {
          totalEnrollments: stats.totalEnrollments,
          passRate: stats.passRate.toFixed(1) + "%",
          failRate: stats.failRate.toFixed(1) + "%",
          averageScore: stats.averageScore.toFixed(1),
          gradeDistribution,
        },
        currentSemester: {
          enrolled: currentEnrollments.length,
          atRiskCount: atRiskStudents.length,
          atRiskStudents,
        },
      });
    },
    {
      name: "get_course_performance_report",
      description:
        "Get a detailed performance report for a specific course including historical pass/fail rates, grade distribution, and currently at-risk students. Use course codes like 'CENG101', 'MATH201', etc.",
      schema: z.object({
        courseId: z
          .string()
          .describe("Course ID or code (e.g., 'CENG101', 'MATH201', 'SENG202')"),
      }),
    }
  );

  // Tool 5: Get student details
  const getStudentDetails = tool(
    async ({ studentId }) => {
      const student = findStudent(data, studentId);
      if (!student) {
        return JSON.stringify({ error: `Student not found: ${studentId}` });
      }

      const department = data.departments.find(
        (d) => d.id === student.department_id
      );

      const currentCourses = student.enrollments
        .filter((e) => e.status === "in_progress")
        .map((e) => {
          const course = findCourse(data, e.course_id);
          return {
            courseCode: course?.code,
            courseName: course?.name,
            midterm: e.midterm_score,
            homework: e.homework_avg,
            attendance: e.attendance,
          };
        });

      const failedCourses = student.enrollments
        .filter((e) => e.status === "failed")
        .map((e) => {
          const course = findCourse(data, e.course_id);
          return {
            courseCode: course?.code,
            semester: e.semester_id,
            score: e.weighted_average,
          };
        });

      return JSON.stringify({
        id: student.id,
        name: student.name,
        email: student.email,
        department: department?.name ?? student.department_id,
        enrollmentYear: student.enrollment_year,
        currentSemester: student.current_semester,
        status: student.status,
        gpa: student.gpa,
        completedCredits: student.completed_credits,
        advisorNotes: student.advisor_notes,
        currentCourses,
        failedCoursesHistory: failedCourses,
      });
    },
    {
      name: "get_student_details",
      description:
        "Get detailed information about a specific student including their current courses, GPA, status, and history of failed courses. Search by student ID (e.g., 'STU001') or partial name.",
      schema: z.object({
        studentId: z
          .string()
          .describe("Student ID (e.g., 'STU001') or partial name (e.g., 'Emily')"),
      }),
    }
  );

  // Tool 6: Generate intervention recommendations
  const getInterventionRecommendations = tool(
    async () => {
      const atRiskStudents = getAtRiskStudents(data);
      const criticalStudents = atRiskStudents.filter(
        (s) => s.riskLevel === "critical"
      );
      const warningStudents = atRiskStudents.filter(
        (s) => s.riskLevel === "warning"
      );

      // Find problem courses
      const problemCourses = getProblemCourses(data, 15);

      // Build intervention plan
      const immediateInterventions = criticalStudents.map((assessment) => {
        const student = data.students.find(
          (s) => s.id === assessment.studentId
        );
        return {
          studentId: assessment.studentId,
          studentName: assessment.studentName,
          department: student?.department_id,
          gpa: student?.gpa,
          status: student?.status,
          requiredActions: assessment.recommendations,
        };
      });

      const courseInterventions = problemCourses.slice(0, 3).map((cs) => ({
        courseId: cs.courseId,
        courseName: cs.courseName,
        failRate: cs.failRate.toFixed(1) + "%",
        recommendation:
          cs.failRate > 30
            ? "Review course difficulty and teaching methods; consider additional support resources"
            : "Monitor closely; provide study groups and tutoring",
      }));

      const institutionalRecommendations: string[] = [];

      if (criticalStudents.length > 0) {
        institutionalRecommendations.push(
          `URGENT: ${criticalStudents.length} students require immediate academic intervention`
        );
      }
      if (problemCourses.length > 0) {
        institutionalRecommendations.push(
          `Review curriculum for ${problemCourses[0].courseName} (${problemCourses[0].failRate.toFixed(1)}% fail rate)`
        );
      }
      institutionalRecommendations.push(
        "Implement early warning system for students with midterm scores below 60%"
      );
      institutionalRecommendations.push(
        "Consider peer tutoring program for high-risk courses"
      );

      return JSON.stringify({
        summary: {
          totalAtRisk: atRiskStudents.length,
          criticalCount: criticalStudents.length,
          warningCount: warningStudents.length,
          problemCoursesCount: problemCourses.length,
        },
        immediateStudentInterventions: immediateInterventions,
        courseInterventions,
        institutionalRecommendations,
        priorityActions: [
          criticalStudents.length > 0
            ? `Schedule mandatory advisor meetings for ${criticalStudents.length} critical students this week`
            : "No critical student interventions needed",
          problemCourses.length > 0
            ? `Department heads to review ${problemCourses[0].courseName} teaching effectiveness`
            : "Course performance within acceptable ranges",
          "Send early warning notices to all students with midterm < 60%",
        ],
      });
    },
    {
      name: "get_intervention_recommendations",
      description:
        "Generate comprehensive intervention recommendations including priority actions for critical students, problem courses needing curriculum review, and institutional improvement suggestions.",
    }
  );

  return [
    getAllAtRiskStudents,
    getDepartmentStats,
    getInstitutionOverviewTool,
    getCoursePerformanceReport,
    getStudentDetails,
    getInterventionRecommendations,
  ];
}
