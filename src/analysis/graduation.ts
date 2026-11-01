import type {
  Student,
  AcademicData,
  GraduationProgress,
  Course,
} from "../types/academic.ts";
import { getDepartment, findCourse } from "../data/loader.ts";

/**
 * Calculate graduation progress for a student
 */
export function calculateGraduationProgress(
  student: Student,
  data: AcademicData
): GraduationProgress {
  const department = getDepartment(data, student.department_id);
  if (!department) {
    throw new Error(`Department not found: ${student.department_id}`);
  }

  const requirements = department.graduation_requirements;

  // Get passed course IDs
  const passedCourseIds = student.enrollments
    .filter((e) => e.status === "passed")
    .map((e) => e.course_id);

  // Calculate required courses progress
  const completedRequired = requirements.required_courses.filter((courseId) =>
    passedCourseIds.includes(courseId)
  );
  const remainingRequired = requirements.required_courses.filter(
    (courseId) => !passedCourseIds.includes(courseId)
  );

  // Calculate elective credits
  // De-duplicated because passing a course twice earns its credits once
  const electiveCourseIds = [...new Set(passedCourseIds)].filter(
    (id) => !requirements.required_courses.includes(id)
  );
  const electiveCredits = electiveCourseIds.reduce((sum, courseId) => {
    const course = findCourse(data, courseId);
    return sum + (course?.credits ?? 0);
  }, 0);

  const electiveCreditsNeeded = Math.max(
    0,
    requirements.min_elective_credits - electiveCredits
  );

  // Calculate credits remaining
  const creditsRemaining = Math.max(
    0,
    requirements.min_credits - student.completed_credits
  );

  // Estimate semesters remaining (assuming ~18 credits/semester)
  const avgCreditsPerSemester = 18;
  const estimatedSemesters = Math.ceil(creditsRemaining / avgCreditsPerSemester);

  // Determine if on track (within 10% of expected progress).
  // The current semester isn't finished, so only earlier ones count.
  const expectedProgress =
    ((student.current_semester - 1) / 8) * requirements.min_credits;
  const isOnTrack = student.completed_credits >= expectedProgress * 0.9;

  // Check GPA status
  const gpaStatus = student.gpa >= requirements.min_gpa ? "meets" : "below";

  return {
    studentId: student.id,
    department: department.name,
    completedCredits: student.completed_credits,
    requiredCredits: requirements.min_credits,
    creditsRemaining,
    completedRequired,
    remainingRequired,
    electiveCredits,
    electiveCreditsNeeded,
    gpaStatus,
    estimatedSemesters,
    isOnTrack,
  };
}

/**
 * Get next recommended courses for a student
 * Considers prerequisites, remaining requirements, and semester recommendations
 */
export function getRecommendedNextCourses(
  student: Student,
  data: AcademicData,
  maxCourses: number = 4
): Course[] {
  const progress = calculateGraduationProgress(student, data);

  // Get all courses the student can take (prerequisites met, not completed)
  const passedCourseIds = new Set(
    student.enrollments
      .filter((e) => e.status === "passed")
      .map((e) => e.course_id)
  );

  const currentlyEnrolledIds = new Set(
    student.enrollments
      .filter((e) => e.status === "in_progress")
      .map((e) => e.course_id)
  );

  const availableCourses = data.courses.filter((course) => {
    // Skip if already passed or currently enrolled
    if (passedCourseIds.has(course.id) || currentlyEnrolledIds.has(course.id)) {
      return false;
    }

    // Check prerequisites
    const prereqsMet = course.prerequisites.every((prereq) =>
      passedCourseIds.has(prereq)
    );
    if (!prereqsMet) return false;

    // Only include relevant courses (student's department or required math)
    return (
      course.department_id === student.department_id ||
      progress.remainingRequired.includes(course.id)
    );
  });

  // Prioritize courses
  const prioritized = availableCourses.sort((a, b) => {
    // Required courses first
    const aRequired = progress.remainingRequired.includes(a.id);
    const bRequired = progress.remainingRequired.includes(b.id);
    if (aRequired && !bRequired) return -1;
    if (bRequired && !aRequired) return 1;

    // Then by recommended semester (closer to current semester)
    const aSemDiff = Math.abs(a.semester - student.current_semester);
    const bSemDiff = Math.abs(b.semester - student.current_semester);
    if (aSemDiff !== bSemDiff) return aSemDiff - bSemDiff;

    // Then by credits (more credits = more progress)
    return b.credits - a.credits;
  });

  return prioritized.slice(0, maxCourses);
}

/**
 * Check if student is eligible for graduation
 */
export function checkGraduationEligibility(
  student: Student,
  data: AcademicData
): {
  eligible: boolean;
  missingRequirements: string[];
} {
  const progress = calculateGraduationProgress(student, data);
  const missingRequirements: string[] = [];

  // Check credits
  if (progress.creditsRemaining > 0) {
    missingRequirements.push(
      `Need ${progress.creditsRemaining} more credits (have ${progress.completedCredits}/${progress.requiredCredits})`
    );
  }

  // Check required courses
  if (progress.remainingRequired.length > 0) {
    const courseNames = progress.remainingRequired
      .map((id) => findCourse(data, id)?.name || id)
      .join(", ");
    missingRequirements.push(`Missing required courses: ${courseNames}`);
  }

  // Check elective credits
  if (progress.electiveCreditsNeeded > 0) {
    missingRequirements.push(
      `Need ${progress.electiveCreditsNeeded} more elective credits`
    );
  }

  // Check GPA
  if (progress.gpaStatus === "below") {
    const department = getDepartment(data, student.department_id);
    missingRequirements.push(
      `GPA ${student.gpa.toFixed(2)} is below minimum ${department?.graduation_requirements.min_gpa}`
    );
  }

  return {
    eligible: missingRequirements.length === 0,
    missingRequirements,
  };
}

/**
 * Get graduation timeline estimate
 */
export function getGraduationTimeline(
  student: Student,
  data: AcademicData
): {
  estimatedGraduation: string;
  semestersRemaining: number;
  onTrack: boolean;
  riskFactors: string[];
} {
  const progress = calculateGraduationProgress(student, data);
  const riskFactors: string[] = [];

  // Calculate expected graduation semester
  const currentYear = 2024; // From academic year
  const semesterOffset = 8 - student.current_semester + progress.estimatedSemesters;
  const estimatedGradYear = currentYear + Math.ceil(semesterOffset / 2);
  const estimatedSeason = semesterOffset % 2 === 0 ? "Spring" : "Fall";
  const estimatedGraduation = `${estimatedSeason} ${estimatedGradYear}`;

  // Identify risk factors
  if (!progress.isOnTrack) {
    riskFactors.push("Behind on credit accumulation");
  }
  if (progress.gpaStatus === "below") {
    riskFactors.push("GPA below graduation requirement");
  }
  if (progress.remainingRequired.length > progress.estimatedSemesters * 3) {
    riskFactors.push("Many required courses remaining");
  }

  return {
    estimatedGraduation,
    semestersRemaining: progress.estimatedSemesters,
    onTrack: progress.isOnTrack && riskFactors.length === 0,
    riskFactors,
  };
}
