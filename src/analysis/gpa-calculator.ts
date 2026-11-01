import type {
  AcademicData,
  Enrollment,
  GradeScaleEntry,
  GradeWeights,
  Course,
} from "../types/academic.ts";

/**
 * Calculate weighted average from midterm and final scores
 * Formula: (midterm * 0.4) + (final * 0.6)
 */
export function calculateWeightedAverage(
  midterm: number,
  final: number,
  weights: GradeWeights
): number {
  return midterm * weights.midterm + final * weights.final;
}

/**
 * Get letter grade from numerical score
 */
export function getLetterGrade(
  score: number,
  gradingScale: Record<string, GradeScaleEntry>
): string {
  // Sort grades by min score descending to find correct bracket
  const sortedGrades = Object.entries(gradingScale).sort(
    ([, a], [, b]) => b.min - a.min
  );

  // Brackets are whole numbers with gaps between them, so match on min alone:
  // 89.4 is a BA even though BA's max is 89
  for (const [grade, range] of sortedGrades) {
    if (score >= range.min) {
      return grade;
    }
  }
  return "FF"; // Default to failing grade
}

/**
 * Get GPA points for a letter grade
 */
export function getGPAForGrade(
  letterGrade: string,
  gradingScale: Record<string, GradeScaleEntry>
): number {
  return gradingScale[letterGrade]?.gpa ?? 0.0;
}

/**
 * Calculate cumulative GPA from enrollments
 */
export function calculateGPA(
  enrollments: Enrollment[],
  courses: Course[],
  gradingScale: Record<string, GradeScaleEntry>
): number {
  // Only include completed courses with grades
  const completedEnrollments = enrollments.filter(
    (e) => e.status === "passed" && e.letter_grade
  );

  if (completedEnrollments.length === 0) return 0;

  let totalQualityPoints = 0;
  let totalCredits = 0;

  for (const enrollment of completedEnrollments) {
    const course = courses.find((c) => c.id === enrollment.course_id);
    if (!course || !enrollment.letter_grade) continue;

    const gradeInfo = gradingScale[enrollment.letter_grade];
    if (!gradeInfo) continue;

    // Quality points = GPA * credits
    totalQualityPoints += gradeInfo.gpa * course.credits;
    totalCredits += course.credits;
  }

  return totalCredits > 0 ? totalQualityPoints / totalCredits : 0;
}

/**
 * Predict required final exam score to achieve target grade
 */
export function predictFinalGrade(
  midtermScore: number,
  targetGrade: string,
  weights: GradeWeights,
  gradingScale: Record<string, GradeScaleEntry>
): { requiredFinal: number; achievable: boolean; message: string } {
  const targetMin = gradingScale[targetGrade]?.min;
  if (targetMin === undefined) {
    return {
      requiredFinal: 0,
      achievable: false,
      message: `Unknown grade: ${targetGrade}`,
    };
  }

  // Solve: targetMin = (midterm * weightMid) + (final * weightFinal)
  // final = (targetMin - midterm * weightMid) / weightFinal
  const requiredFinal =
    (targetMin - midtermScore * weights.midterm) / weights.final;
  // Tolerance stops float noise (82.00000000000001) asking for an extra point
  const roundedRequired = Math.ceil(requiredFinal - 1e-9);

  const achievable = roundedRequired <= 100 && roundedRequired >= 0;

  let message: string;
  if (achievable) {
    message = `Need ${roundedRequired}% on final exam to achieve ${targetGrade}`;
  } else if (roundedRequired > 100) {
    message = `Cannot achieve ${targetGrade} - would need ${roundedRequired}% on final (impossible)`;
  } else {
    message = `Already guaranteed better than ${targetGrade}`;
  }

  return {
    requiredFinal: roundedRequired,
    achievable,
    message,
  };
}

/**
 * Calculate semester GPA from current in-progress courses
 * Useful for projecting semester performance
 */
export function projectSemesterGPA(
  enrollments: Enrollment[],
  courses: Course[],
  gradingScale: Record<string, GradeScaleEntry>,
  weights: GradeWeights
): number | null {
  const currentEnrollments = enrollments.filter(
    (e) => e.status === "in_progress" && e.midterm_score !== null
  );

  if (currentEnrollments.length === 0) return null;

  let totalProjectedQP = 0;
  let totalCredits = 0;

  for (const enrollment of currentEnrollments) {
    const course = courses.find((c) => c.id === enrollment.course_id);
    if (!course || enrollment.midterm_score === null) continue;

    // Project final score assuming similar performance
    const projectedFinal = enrollment.midterm_score;
    const projectedAvg = calculateWeightedAverage(
      enrollment.midterm_score,
      projectedFinal,
      weights
    );

    const projectedGrade = getLetterGrade(projectedAvg, gradingScale);
    const gpaPoints = getGPAForGrade(projectedGrade, gradingScale);

    totalProjectedQP += gpaPoints * course.credits;
    totalCredits += course.credits;
  }

  return totalCredits > 0 ? totalProjectedQP / totalCredits : null;
}

/**
 * Calculate what final scores are needed to achieve a target semester GPA
 */
export function calculateRequiredScores(
  enrollments: Enrollment[],
  courses: Course[],
  targetGPA: number,
  gradingScale: Record<string, GradeScaleEntry>,
  weights: GradeWeights
): { courseId: string; requiredFinal: number; achievable: boolean }[] {
  const currentEnrollments = enrollments.filter(
    (e) => e.status === "in_progress" && e.midterm_score !== null
  );

  // Find the minimum grade that would give us our target GPA
  const targetGrade = Object.entries(gradingScale)
    .filter(([, entry]) => entry.gpa >= targetGPA)
    .sort(([, a], [, b]) => a.gpa - b.gpa)[0]?.[0] || "CC";

  return currentEnrollments.map((enrollment) => {
    const prediction = predictFinalGrade(
      enrollment.midterm_score!,
      targetGrade,
      weights,
      gradingScale
    );
    return {
      courseId: enrollment.course_id,
      requiredFinal: prediction.requiredFinal,
      achievable: prediction.achievable,
    };
  });
}
