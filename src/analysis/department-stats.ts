import type {
  AcademicData,
  CourseStats,
  DepartmentStats,
} from "../types/academic.ts";

/**
 * Calculate comprehensive statistics for a department
 */
export function getDepartmentStatistics(
  departmentId: string,
  data: AcademicData,
): DepartmentStats {
  const department = data.departments.find((d) => d.id === departmentId);
  if (!department) {
    throw new Error(`Department not found: ${departmentId}`);
  }

  // Get students in department
  const deptStudents = data.students.filter(
    (s) => s.department_id === departmentId,
  );

  // Calculate average GPA
  const averageGPA = deptStudents.length > 0
    ? deptStudents.reduce((sum, s) => sum + s.gpa, 0) / deptStudents.length
    : 0;

  // Count at-risk and probation students
  const atRiskCount = deptStudents.filter(
    (s) => s.gpa < 2.0 || s.status === "warning",
  ).length;
  const probationCount = deptStudents.filter(
    (s) => s.status === "probation",
  ).length;

  // Calculate course statistics
  const deptCourses = data.courses.filter(
    (c) => c.department_id === departmentId,
  );
  const courseStats: CourseStats[] = deptCourses.map((course) =>
    calculateCourseStats(course.id, data)
  );

  return {
    departmentId,
    departmentName: department.name,
    totalStudents: deptStudents.length,
    averageGPA,
    atRiskCount,
    probationCount,
    courseStats,
  };
}

/**
 * Calculate statistics for a single course
 */
export function calculateCourseStats(
  courseId: string,
  data: AcademicData,
): CourseStats {
  const course = data.courses.find((c) => c.id === courseId);
  if (!course) {
    throw new Error(`Course not found: ${courseId}`);
  }

  // Get all enrollments for this course
  const enrollments = data.students.flatMap((s) =>
    s.enrollments.filter((e) => e.course_id === courseId)
  );

  // Separate completed and in-progress
  const completed = enrollments.filter((e) => e.status !== "in_progress");
  const current = enrollments.filter((e) => e.status === "in_progress");

  // Calculate pass/fail rates
  const passedCount = completed.filter((e) => e.status === "passed").length;
  const failedCount = completed.filter((e) => e.status === "failed").length;
  const totalCompleted = passedCount + failedCount;

  const passRate = totalCompleted > 0
    ? (passedCount / totalCompleted) * 100
    : 0;
  const failRate = totalCompleted > 0
    ? (failedCount / totalCompleted) * 100
    : 0;

  // Calculate average score
  const scoresWithValues = completed.filter((e) => e.weighted_average !== null);
  const averageScore = scoresWithValues.length > 0
    ? scoresWithValues.reduce((sum, e) => sum + (e.weighted_average ?? 0), 0) /
      scoresWithValues.length
    : 0;

  // Count currently at-risk students
  const atRiskCount = current.filter(
    (e) => e.midterm_score !== null && e.midterm_score < 60,
  ).length;

  return {
    courseId: course.id,
    courseName: course.name,
    totalEnrollments: completed.length,
    passRate,
    failRate,
    averageScore,
    atRiskCount,
  };
}

/**
 * Get institution-wide statistics
 */
export function getInstitutionOverview(data: AcademicData): {
  universityName: string;
  academicYear: string;
  currentSemester: string;
  totalStudents: number;
  averageGPA: number;
  statusDistribution: { active: number; warning: number; probation: number };
  departmentSummary: {
    id: string;
    name: string;
    studentCount: number;
    avgGPA: number;
  }[];
} {
  const totalStudents = data.students.length;
  const avgGPA = totalStudents > 0
    ? data.students.reduce((sum, s) => sum + s.gpa, 0) / totalStudents
    : 0;

  const statusDistribution = {
    active: data.students.filter((s) => s.status === "active").length,
    warning: data.students.filter((s) => s.status === "warning").length,
    probation: data.students.filter((s) => s.status === "probation").length,
  };

  const departmentSummary = data.departments.map((dept) => {
    const deptStudents = data.students.filter(
      (s) => s.department_id === dept.id,
    );
    const deptAvgGPA = deptStudents.length > 0
      ? deptStudents.reduce((sum, s) => sum + s.gpa, 0) / deptStudents.length
      : 0;
    return {
      id: dept.id,
      name: dept.name,
      studentCount: deptStudents.length,
      avgGPA: deptAvgGPA,
    };
  });

  const currentSemester = data.semesters.find((s) => s.is_current);

  return {
    universityName: data.university.name,
    academicYear: data.university.academic_year,
    currentSemester: currentSemester?.name ?? "Unknown",
    totalStudents,
    averageGPA: avgGPA,
    statusDistribution,
    departmentSummary,
  };
}

/**
 * Find courses with high failure rates (potential problem courses)
 */
export function getProblemCourses(
  data: AcademicData,
  failRateThreshold: number = 20,
): CourseStats[] {
  const allCourseStats = data.courses.map((course) =>
    calculateCourseStats(course.id, data)
  );

  return allCourseStats
    .filter((cs) => cs.failRate > failRateThreshold && cs.totalEnrollments > 2)
    .sort((a, b) => b.failRate - a.failRate);
}

/**
 * Get grade distribution for a course
 */
export function getCourseGradeDistribution(
  courseId: string,
  data: AcademicData,
): Record<string, number> {
  const enrollments = data.students.flatMap((s) =>
    s.enrollments.filter(
      (e) => e.course_id === courseId && e.status !== "in_progress",
    )
  );

  const distribution: Record<string, number> = {};
  for (const enrollment of enrollments) {
    if (enrollment.letter_grade) {
      distribution[enrollment.letter_grade] =
        (distribution[enrollment.letter_grade] ?? 0) + 1;
    }
  }

  return distribution;
}

/**
 * Compare department performance metrics
 */
export function compareDepartments(data: AcademicData): {
  comparison: {
    departmentId: string;
    departmentName: string;
    avgGPA: number;
    atRiskPercentage: number;
    avgPassRate: number;
  }[];
  bestPerforming: string;
  needsAttention: string;
} {
  const comparison = data.departments.map((dept) => {
    const stats = getDepartmentStatistics(dept.id, data);
    // A course nobody has finished has no pass rate, so it can't lower the average
    const coursesWithResults = stats.courseStats.filter(
      (cs) => cs.totalEnrollments > 0,
    );
    const avgPassRate = coursesWithResults.length > 0
      ? coursesWithResults.reduce((sum, cs) => sum + cs.passRate, 0) /
        coursesWithResults.length
      : 0;

    return {
      departmentId: dept.id,
      departmentName: dept.name,
      avgGPA: stats.averageGPA,
      atRiskPercentage: stats.totalStudents > 0
        ? (stats.atRiskCount / stats.totalStudents) * 100
        : 0,
      avgPassRate,
    };
  });

  // Sort by GPA to find best/worst performing
  const sorted = [...comparison].sort((a, b) => b.avgGPA - a.avgGPA);

  return {
    comparison,
    bestPerforming: sorted[0]?.departmentId ?? "",
    needsAttention: sorted[sorted.length - 1]?.departmentId ?? "",
  };
}
