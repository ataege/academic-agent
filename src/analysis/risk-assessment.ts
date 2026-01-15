import type {
  Student,
  AcademicData,
  RiskAssessment,
} from "../types/academic.ts";
import { findCourse } from "../data/loader.ts";

// Risk thresholds for academic assessment
const RISK_THRESHOLDS = {
  gpa: {
    critical: 1.5,  // GPA below this = critical risk
    warning: 2.0,   // GPA below this = warning
  },
  midterm: {
    failing: 50,    // Score below this = likely to fail
    atRisk: 60,     // Score below this = at risk
  },
  attendance: {
    critical: 70,   // Below 70% = serious concern
    warning: 80,    // Below 80% = needs attention
  },
};

/**
 * Assess academic risk level for a single student
 */
export function assessStudentRisk(
  student: Student,
  data: AcademicData
): RiskAssessment {
  const factors: string[] = [];
  const recommendations: string[] = [];
  let riskLevel: "critical" | "warning" | "normal" = "normal";

  // Check overall GPA
  if (student.gpa < RISK_THRESHOLDS.gpa.critical) {
    factors.push(
      `Critical GPA: ${student.gpa.toFixed(2)} (below ${RISK_THRESHOLDS.gpa.critical})`
    );
    recommendations.push("Immediate academic intervention required");
    recommendations.push("Schedule mandatory advisor meeting");
    riskLevel = "critical";
  } else if (student.gpa < RISK_THRESHOLDS.gpa.warning) {
    factors.push(
      `Low GPA: ${student.gpa.toFixed(2)} (below ${RISK_THRESHOLDS.gpa.warning})`
    );
    recommendations.push("Consider tutoring and academic support services");
    riskLevel = "warning";
  }

  // Check student status
  if (student.status === "probation") {
    factors.push("Currently on academic probation");
    recommendations.push("Must maintain minimum 2.0 GPA this semester to avoid dismissal");
    riskLevel = "critical";
  } else if (student.status === "warning") {
    factors.push("Academic warning status");
    if (riskLevel === "normal") riskLevel = "warning";
  }

  // Check current semester courses
  const currentEnrollments = student.enrollments.filter(
    (e) => e.status === "in_progress"
  );

  let failingCourseCount = 0;
  let atRiskCourseCount = 0;

  for (const enrollment of currentEnrollments) {
    const course = findCourse(data, enrollment.course_id);
    if (!course) continue;

    // Check midterm scores
    if (enrollment.midterm_score !== null) {
      if (enrollment.midterm_score < RISK_THRESHOLDS.midterm.failing) {
        failingCourseCount++;
        factors.push(
          `Failing midterm in ${course.code}: ${enrollment.midterm_score}%`
        );
        recommendations.push(
          `Focus on improving ${course.name} - seek immediate help from professor/TA`
        );
      } else if (enrollment.midterm_score < RISK_THRESHOLDS.midterm.atRisk) {
        atRiskCourseCount++;
        factors.push(
          `At-risk midterm in ${course.code}: ${enrollment.midterm_score}%`
        );
      }
    }

    // Check attendance
    if (enrollment.attendance < RISK_THRESHOLDS.attendance.critical) {
      factors.push(
        `Critical attendance in ${course.code}: ${enrollment.attendance}%`
      );
      recommendations.push(`Improve attendance in ${course.name} immediately`);
    } else if (enrollment.attendance < RISK_THRESHOLDS.attendance.warning) {
      factors.push(
        `Low attendance in ${course.code}: ${enrollment.attendance}%`
      );
    }
  }

  // Update risk level based on course performance
  if (failingCourseCount >= 2) {
    riskLevel = "critical";
    recommendations.push(
      `Failing ${failingCourseCount} courses - consider reduced course load`
    );
  } else if (failingCourseCount === 1 && riskLevel === "normal") {
    riskLevel = "warning";
  }

  // Add general recommendations based on risk level
  if (riskLevel === "critical" && recommendations.length === 0) {
    recommendations.push("Meet with academic advisor urgently");
    recommendations.push("Explore academic support resources");
  } else if (riskLevel === "warning" && recommendations.length === 0) {
    recommendations.push("Schedule academic advisor check-in");
    recommendations.push("Consider study group participation");
  }

  return {
    studentId: student.id,
    studentName: student.name,
    riskLevel,
    factors,
    recommendations,
  };
}

/**
 * Get all at-risk students across the institution
 * Returns students sorted by risk severity (critical first)
 */
export function getAtRiskStudents(data: AcademicData): RiskAssessment[] {
  return data.students
    .map((student) => assessStudentRisk(student, data))
    .filter((assessment) => assessment.riskLevel !== "normal")
    .sort((a, b) => {
      // Sort by severity: critical first
      if (a.riskLevel === "critical" && b.riskLevel !== "critical") return -1;
      if (b.riskLevel === "critical" && a.riskLevel !== "critical") return 1;
      return 0;
    });
}

/**
 * Get at-risk students for a specific department
 */
export function getAtRiskStudentsByDepartment(
  data: AcademicData,
  departmentId: string
): RiskAssessment[] {
  return data.students
    .filter((s) => s.department_id === departmentId)
    .map((student) => assessStudentRisk(student, data))
    .filter((assessment) => assessment.riskLevel !== "normal")
    .sort((a, b) => {
      if (a.riskLevel === "critical" && b.riskLevel !== "critical") return -1;
      if (b.riskLevel === "critical" && a.riskLevel !== "critical") return 1;
      return 0;
    });
}

/**
 * Summarize at-risk students for reporting
 */
export function summarizeRiskStatus(data: AcademicData): {
  total: number;
  critical: number;
  warning: number;
  normal: number;
  byDepartment: Record<string, { critical: number; warning: number }>;
} {
  const assessments = data.students.map((s) => assessStudentRisk(s, data));

  const byDepartment: Record<string, { critical: number; warning: number }> = {};

  for (const dept of data.departments) {
    byDepartment[dept.id] = { critical: 0, warning: 0 };
  }

  for (const student of data.students) {
    const assessment = assessStudentRisk(student, data);
    if (assessment.riskLevel === "critical") {
      byDepartment[student.department_id].critical++;
    } else if (assessment.riskLevel === "warning") {
      byDepartment[student.department_id].warning++;
    }
  }

  return {
    total: data.students.length,
    critical: assessments.filter((a) => a.riskLevel === "critical").length,
    warning: assessments.filter((a) => a.riskLevel === "warning").length,
    normal: assessments.filter((a) => a.riskLevel === "normal").length,
    byDepartment,
  };
}
